'use strict'
// Worker isolado para captura de PDF via Chrome.
// Roda em processo filho separado — se Chrome travar, o processo pai mata via SIGKILL
// sem afetar o event loop do Next.js.
const puppeteer = require('puppeteer-core')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { PDFDocument } = require('pdf-lib')

// Timeout de espera pelo evento "rendered" do Power BI. Sob CPU roubada (throttle
// de host), a renderizacao ainda progride, so mais devagar — subir isso evita
// falhar cedo demais. Ajustavel por env sem precisar mexer no codigo de novo.
const PBI_RENDER_TIMEOUT_MS = Number(process.env.PBI_RENDER_TIMEOUT_MS) || 120000

// Detecta a caixa de conteudo de cada pagina do PDF via Ghostscript (device bbox)
// e recorta o branco em volta (CropBox + MediaBox). Usado quando o relatorio
// Power BI tem canvas maior que a tabela — sem isso o PDF sai com metade da
// folha em branco e o conteudo minusculo.
function getPdfBBoxes(pdfPath) {
  return new Promise((resolve) => {
    execFile('gs', ['-dNOPAUSE', '-dBATCH', '-dSAFER', '-q', '-sDEVICE=bbox', pdfPath], (_err, stdout, stderr) => {
      const out = `${stderr || ''}${stdout || ''}`
      const boxes = []
      const re = /%%HiResBoundingBox:\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/g
      let m
      while ((m = re.exec(out))) boxes.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])])
      resolve(boxes)
    })
  })
}

// Recorte por porcentagem fixa de cada borda. Deterministico — bom para
// relatorios com layout sempre igual (tabela no topo, resto vazio) em que o
// autocrop falha por causa de elementos decorativos (barra lateral etc).
async function cropPdfByPercent(pdfBuffer, crop) {
  try {
    const pct = (v) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 && n < 95 ? n / 100 : 0
    }
    const l = pct(crop.left_pct)
    const r = pct(crop.right_pct)
    const t = pct(crop.top_pct)
    const b = pct(crop.bottom_pct)
    if (l + r + t + b === 0) return pdfBuffer

    const doc = await PDFDocument.load(pdfBuffer)
    for (const page of doc.getPages()) {
      const mb = page.getMediaBox()
      const x0 = mb.x + mb.width * l
      const y0 = mb.y + mb.height * b // origem do PDF e no canto inferior esquerdo
      const w = mb.width * (1 - l - r)
      const h = mb.height * (1 - t - b)
      if (w > 20 && h > 20) {
        page.setCropBox(x0, y0, w, h)
        page.setMediaBox(x0, y0, w, h)
      }
    }
    return Buffer.from(await doc.save())
  } catch (e) {
    return pdfBuffer
  }
}

// Pergunta ao Power BI a posicao exata dos visuais de DADOS na pagina ativa
// (ignora shapes/imagens decorativas como a barra lateral) e devolve a caixa de
// conteudo como fracao do viewport (= fracao da folha do PDF, ja considerando a
// escala/centralizacao do FitToPage).
async function getSmartContentBox(page, vpW, vpH) {
  return page.evaluate(async (vpW, vpH) => {
    try {
      const rpt = window._pbiReport
      if (!rpt) return null
      const pages = await rpt.getPages()
      const active = pages.find(p => p.isActive) || pages.find(p => p.visibility === 0) || pages[0]
      if (!active) return null
      let size = active.defaultSize
      if (!size || !size.width || !size.height) size = { width: 1280, height: 720 }

      const visuals = await active.getVisuals()
      const skip = new Set(['shape', 'image', 'textbox', 'actionButton', 'basicShape',
        'bookmarkNavigator', 'pageNavigator'])
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0
      for (const v of visuals) {
        if (!v.layout || skip.has(v.type)) continue
        n++
        x0 = Math.min(x0, v.layout.x || 0)
        y0 = Math.min(y0, v.layout.y || 0)
        x1 = Math.max(x1, (v.layout.x || 0) + (v.layout.width || 0))
        y1 = Math.max(y1, (v.layout.y || 0) + (v.layout.height || 0))
      }
      if (!n || !isFinite(x0)) return null

      // FitToPage: canvas (size) escalado pra caber em vpW x vpH, centralizado
      const scale = Math.min(vpW / size.width, vpH / size.height)
      const ox = (vpW - size.width * scale) / 2
      const oy = (vpH - size.height * scale) / 2
      const clamp = v => Math.max(0, Math.min(1, v))
      return {
        left: clamp((ox + x0 * scale) / vpW),
        top: clamp((oy + y0 * scale) / vpH),
        right: clamp((ox + x1 * scale) / vpW),
        bottom: clamp((oy + y1 * scale) / vpH),
      }
    } catch (e) { return null }
  }, vpW, vpH).catch(() => null)
}

// Recorta cada pagina do PDF para a caixa de conteudo (fracoes top-left) medida
// no Power BI. boxes[i] === null pula a pagina.
async function cropPdfToBoxes(pdfBuffer, boxes) {
  try {
    const doc = await PDFDocument.load(pdfBuffer)
    const pages = doc.getPages()
    const PAD = 0.012 // ~1.2% de folga em volta
    pages.forEach((page, i) => {
      const b = boxes[i]
      if (!b) return
      const mb = page.getMediaBox()
      const l = Math.max(0, b.left - PAD)
      const r = Math.min(1, b.right + PAD)
      const t = Math.max(0, b.top - PAD)
      const bot = Math.min(1, b.bottom + PAD)
      const w = mb.width * (r - l)
      const h = mb.height * (bot - t)
      const x = mb.x + mb.width * l
      const y = mb.y + mb.height * (1 - bot) // PDF: origem no canto inferior esquerdo
      if (w > 20 && h > 20 && (w < mb.width - 2 || h < mb.height - 2)) {
        page.setCropBox(x, y, w, h)
        page.setMediaBox(x, y, w, h)
      }
    })
    return Buffer.from(await doc.save())
  } catch (e) {
    return pdfBuffer
  }
}

async function cropPdfWhitespace(pdfBuffer) {
  const tmp = path.join(os.tmpdir(), `crop_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
  try {
    fs.writeFileSync(tmp, pdfBuffer)
    const boxes = await getPdfBBoxes(tmp)
    if (!boxes.length) return pdfBuffer

    const doc = await PDFDocument.load(pdfBuffer)
    const pages = doc.getPages()
    const PAD = 6 // pontos de margem em volta do conteudo

    pages.forEach((page, i) => {
      const bb = boxes[i] || boxes[boxes.length - 1]
      if (!bb) return
      const mb = page.getMediaBox()
      const x0 = Math.max(mb.x, bb[0] - PAD)
      const y0 = Math.max(mb.y, bb[1] - PAD)
      const x1 = Math.min(mb.x + mb.width, bb[2] + PAD)
      const y1 = Math.min(mb.y + mb.height, bb[3] + PAD)
      const w = x1 - x0
      const h = y1 - y0
      // so recorta se sobrou conteudo real (evita PDF vazio se o bbox falhar)
      if (w > 20 && h > 20 && (w < mb.width - 2 || h < mb.height - 2)) {
        page.setCropBox(x0, y0, w, h)
        page.setMediaBox(x0, y0, w, h)
      }
    })

    return Buffer.from(await doc.save())
  } catch (e) {
    return pdfBuffer // qualquer falha: devolve o PDF original
  } finally {
    fs.unlink(tmp, () => {})
  }
}

const CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

function findChromePath() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p
  }
  throw new Error('Chrome nao encontrado. Instale o Google Chrome e tente novamente.')
}

function loadPowerBiClientJs() {
  const localPath = path.join(process.cwd(), 'public', 'powerbi-client.min.js')
  return fs.readFileSync(localPath, 'utf-8')
}

function serveHtmlLocally(html) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise(r => server.close(() => r())),
      })
    })
  })
}

async function injectPrintColorAdjust(page) {
  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const s = document.createElement('style')
      s.textContent = '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }'
      ;(document.head ?? document.documentElement)?.appendChild(s)
    }).catch(() => {})
  }
}

// Altura (px) do conteudo de dados renderizado sob FitToWidth, para a folha do
// PDF ter exatamente o tamanho do relatorio (sem branco embaixo).
async function measureFitWidthHeight(page, vpW) {
  return page.evaluate(async (vpW) => {
    try {
      const rpt = window._pbiReport
      if (!rpt) return null
      const pages = await rpt.getPages()
      const active = pages.find(p => p.isActive) || pages.find(p => p.visibility === 0) || pages[0]
      let size = active && active.defaultSize
      if (!size || !size.width || !size.height) size = { width: 1280, height: 720 }
      const visuals = active ? await active.getVisuals() : []
      const skip = new Set(['shape', 'image', 'textbox', 'actionButton', 'basicShape',
        'bookmarkNavigator', 'pageNavigator'])
      let y1 = 0
      for (const v of visuals) {
        if (!v.layout || skip.has(v.type)) continue
        y1 = Math.max(y1, (v.layout.y || 0) + (v.layout.height || 0))
      }
      if (!y1) y1 = size.height
      return Math.ceil(y1 * (vpW / size.width))
    } catch (e) { return null }
  }, vpW).catch(() => null)
}

async function captureSinglePagePdf(page, pdfOpts) {
  await injectPrintColorAdjust(page)
  const pdf = await page.pdf({
    ...pdfOpts,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  })
  return Buffer.from(pdf)
}

async function main() {
  const input = JSON.parse(process.env.CHROME_CAPTURE_PDF_INPUT || '{}')
  const {
    embedUrl,
    embedToken,
    reportId,
    pageName,
    pageNames,
    viewportWidth = 559,
    viewportHeight = 397,
    tokenType = 'Embed',
    pdfFormat = 'A6',
    landscape = true,
    pageWidthMm = null,
    pageHeightMm = null,
    autocrop = false,
    crop = null,
    fit = null,
  } = input

  // fit=width: relatorio preenche a LARGURA da folha (colunas legiveis) e a
  // folha fica alta o quanto o conteudo precisar — sem encolher nem cortar.
  const fitWidth = fit === 'width'

  // Tamanho de pagina customizado tem prioridade sobre o formato A-series.
  const useCustomSize = Number(pageWidthMm) > 0 && Number(pageHeightMm) > 0
  // (com fit=width o page.pdf usa width/height explicitos e ignora o @page)
  const pageSizeCss = fitWidth
    ? `${viewportWidth}px ${viewportHeight}px`
    : useCustomSize
      ? `${pageWidthMm}mm ${pageHeightMm}mm`
      : `${pdfFormat} ${landscape ? 'landscape' : 'portrait'}`
  // Container alto quando fit=width, pra o Power BI renderizar mais linhas sem
  // scroll interno. Limitado a ~4800px: acima disso o Chrome com swiftshader
  // estoura memoria e a conexao cai ("Connection Closed"). Relatorio maior que
  // isso e cortado no fim, mas nao derruba o browser.
  const FIT_WIDTH_MAX_PX = 4800
  const pbiContainerHeightPx = fitWidth ? FIT_WIDTH_MAX_PX : viewportHeight
  let pdfOpts = fitWidth
    ? { width: `${viewportWidth}px`, height: `${viewportHeight}px` } // recalculado apos render
    : useCustomSize
      ? { width: `${pageWidthMm}mm`, height: `${pageHeightMm}mm` }
      : { format: pdfFormat, landscape: landscape !== false }

  const executablePath = findChromePath()
  const powerBiClientJs = loadPowerBiClientJs()
  const tokenTypeJs = tokenType === 'Aad' ? 'models.TokenType.Aad' : 'models.TokenType.Embed'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0; size: ${pageSizeCss}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { width: ${viewportWidth}px; height: ${pbiContainerHeightPx}px; overflow: hidden; max-height: ${pbiContainerHeightPx}px; }
    body { overflow: hidden; background: #fff; width: ${viewportWidth}px; height: ${pbiContainerHeightPx}px; max-height: ${pbiContainerHeightPx}px; }
    #pbi-container { width: ${viewportWidth}px; height: ${pbiContainerHeightPx}px; overflow: hidden; }
  </style>
</head>
<body>
  <div id="pbi-container"></div>
  <script>${powerBiClientJs}</script>
  <script>
    window._pbiRendered = false;
    window._pbiError = null;
    window._pbiReport = null;
    window._pbiPages = null;

    var models = window['powerbi-client'].models;
    var container = document.getElementById('pbi-container');
    var config = {
      type: 'report',
      id: ${JSON.stringify(reportId)},
      embedUrl: ${JSON.stringify(embedUrl)},
      accessToken: ${JSON.stringify(embedToken)},
      tokenType: ${tokenTypeJs},
      ${pageName ? `pageName: ${JSON.stringify(pageName)},` : ''}
      settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false,
        background: models.BackgroundType.Default,
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: ${fitWidth ? 'models.DisplayOption.FitToWidth' : 'models.DisplayOption.FitToPage'} },
      },
    };

    var report = window['powerbi'].embed(container, config);
    window._pbiReport = report;

    report.on('loaded', function() {
      report.getPages().then(function(pages) {
        var visible = pages.filter(function(p) { return p.visibility === 0; }).map(function(p) { return p.name; });
        window._pbiPages = visible;
      }).catch(function() {
        window._pbiPages = [];
      });
    });

    report.on('rendered', function() {
      setTimeout(function() { window._pbiRendered = true; }, 8000);
    });

    report.on('error', function(event) {
      window._pbiError = JSON.stringify(event.detail);
      window._pbiPages = [];
      window._pbiRendered = true;
    });
  </script>
</body>
</html>`

  const localServer = await serveHtmlLocally(html)
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-webgl', '--ignore-gpu-blocklist'],
    timeout: 30000,
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewportWidth, height: pbiContainerHeightPx, deviceScaleFactor: 1 })

    await page.goto(localServer.url, { waitUntil: 'domcontentloaded', timeout: 15000 })

    try {
      await page.waitForFunction('window._pbiRendered === true', { timeout: PBI_RENDER_TIMEOUT_MS })
    } catch {
      const pbiError = await page.evaluate(() => window._pbiError ?? null).catch(() => null)
      if (pbiError) throw new Error('Power BI erro ao renderizar: ' + pbiError)
      throw new Error(`Tempo esgotado aguardando renderizacao do Power BI (${Math.round(PBI_RENDER_TIMEOUT_MS / 1000)}s) — verifique autenticacao e se o relatorio esta acessivel no Power BI`)
    }

    await page.waitForNetworkIdle({ idleTime: 2500, timeout: 20000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 4000))

    let pagesToCapture = null

    if (pageName) {
      pagesToCapture = null
    } else if (pageNames && pageNames.length > 1) {
      pagesToCapture = pageNames
    } else if (!pageName && (!pageNames || pageNames.length === 0)) {
      await page.waitForFunction('Array.isArray(window._pbiPages)', { timeout: 15000 }).catch(() => {})

      let allPages = await page.evaluate(() => window._pbiPages ?? null).catch(() => null)

      if (!Array.isArray(allPages) || allPages.length === 0) {
        allPages = await page.evaluate(() => {
          const rpt = window._pbiReport
          if (!rpt || typeof rpt.getPages !== 'function') return []
          return rpt.getPages().then(pages =>
            pages.filter(p => p.visibility === 0).map(p => ({ name: p.name }))
          )
        }).then(items => Array.isArray(items) ? items.map(i => typeof i === 'string' ? i : i.name) : []).catch(() => [])
      }

      if (Array.isArray(allPages) && allPages.length > 1) pagesToCapture = allPages
    }

    let pdfBuffer
    const contentBoxes = [] // caixa de conteudo por pagina (para autocrop)

    // Sob fit=width, a folha do PDF tem a altura real do relatorio (medida por pagina).
    const optsForCurrentPage = async () => {
      if (!fitWidth) return pdfOpts
      const h = await measureFitWidthHeight(page, viewportWidth)
      const finalH = h && h > 120 ? Math.min(h + 24, FIT_WIDTH_MAX_PX - 40) : viewportHeight
      return { width: `${viewportWidth}px`, height: `${finalH}px` }
    }

    if (!pagesToCapture) {
      if (autocrop) contentBoxes.push(await getSmartContentBox(page, viewportWidth, viewportHeight))
      pdfBuffer = await captureSinglePagePdf(page, await optsForCurrentPage())
    } else {
      const pagePdfs = []

      for (let i = 0; i < pagesToCapture.length; i++) {
        const pbiPageName = pagesToCapture[i]

        if (i > 0) {
          await page.evaluate(name => {
            window._pbiRendered = false
            window._pbiReport.setPage(name)
          }, pbiPageName)

          try {
            await page.waitForFunction('window._pbiRendered === true', { timeout: PBI_RENDER_TIMEOUT_MS })
          } catch {
            // continua com pagina possivelmente nao renderizada
          }
          await page.waitForNetworkIdle({ idleTime: 2000, timeout: 15000 }).catch(() => {})
          await new Promise(r => setTimeout(r, 3000))
        }

        if (autocrop) contentBoxes.push(await getSmartContentBox(page, viewportWidth, viewportHeight))
        pagePdfs.push(await captureSinglePagePdf(page, await optsForCurrentPage()))
      }

      const merged = await PDFDocument.create()
      for (const buf of pagePdfs) {
        const doc = await PDFDocument.load(buf)
        const copied = await merged.copyPages(doc, doc.getPageIndices())
        copied.forEach(p => merged.addPage(p))
      }
      pdfBuffer = Buffer.from(await merged.save())
    }

    if (crop && typeof crop === 'object') {
      pdfBuffer = await cropPdfByPercent(pdfBuffer, crop)
    }
    if (autocrop) {
      if (contentBoxes.some(Boolean)) {
        // corte preciso pela posicao dos visuais no Power BI
        pdfBuffer = await cropPdfToBoxes(pdfBuffer, contentBoxes)
      } else {
        // fallback: bbox via Ghostscript
        pdfBuffer = await cropPdfWhitespace(pdfBuffer)
      }
    }

    try { fs.writeFileSync('/root/last_capture.pdf', pdfBuffer) } catch (e) {}

    // Validacao basica de integridade — um PDF valido comeca com "%PDF-" e
    // termina com o marcador "%%EOF". Se estiver truncado/corrompido, falha
    // aqui para que o chamador tente novamente em vez de mandar um arquivo
    // quebrado pro cliente.
    const headerOk = pdfBuffer.subarray(0, 5).toString('latin1') === '%PDF-'
    const tailSlice = pdfBuffer.subarray(Math.max(0, pdfBuffer.length - 1024)).toString('latin1')
    const tailOk = tailSlice.includes('%%EOF')
    if (!headerOk || !tailOk || pdfBuffer.length < 1024) {
      try { fs.writeFileSync(`/root/bad_pdf_${Date.now()}.pdf`, pdfBuffer) } catch (e) {}
      throw new Error(`PDF gerado parece invalido/truncado (headerOk=${headerOk}, tailOk=${tailOk}, bytes=${pdfBuffer.length})`)
    }

    await new Promise((resolve, reject) => {
      process.stdout.write(pdfBuffer.toString('base64'), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  } finally {
    // Limpeza com teto de tempo: browser.close() pode travar indefinidamente
    // se o Chrome ficou wedged. Se estourar 5s, seguimos — o processo pai
    // ainda mata o process group inteiro (runIsolatedWorker/killProcessTree).
    await Promise.race([
      (async () => {
        await browser.close().catch(() => {})
        await localServer.close().catch(() => {})
      })(),
      new Promise(r => setTimeout(r, 5000)),
    ])
  }
}

// Rede de seguranca: se algo pendurar o event loop, sai antes do SIGKILL
// do pai (CAPTURE_WORKER_TIMEOUT_MS em lib/report-pdf.ts, ~210s) para nao
// deixar Chrome reparentado no init. Precisa ser MAIOR que o wait de render
// (PBI_RENDER_TIMEOUT_MS) + folga pra gerar/recortar o PDF, senao mata cedo demais.
setTimeout(() => process.exit(3), PBI_RENDER_TIMEOUT_MS + 60000).unref()

main()
  .then(() => process.exit(0)) // output ja foi escrito e drenado dentro de main()
  .catch(err => {
    process.stderr.write(err && err.message ? err.message : String(err))
    process.exit(1)
  })
