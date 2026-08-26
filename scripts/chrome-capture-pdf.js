'use strict'
// Worker isolado para captura de PDF via Chrome.
// Roda em processo filho separado — se Chrome travar, o processo pai mata via SIGKILL
// sem afetar o event loop do Next.js.
const puppeteer = require('puppeteer-core')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('pdf-lib')

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

async function captureSinglePagePdf(page, format) {
  await injectPrintColorAdjust(page)
  const pdf = await page.pdf({
    format,
    landscape: true,
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
  } = input

  const executablePath = findChromePath()
  const powerBiClientJs = loadPowerBiClientJs()
  const tokenTypeJs = tokenType === 'Aad' ? 'models.TokenType.Aad' : 'models.TokenType.Embed'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0; size: A6 landscape; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { width: ${viewportWidth}px; height: ${viewportHeight}px; overflow: hidden; max-height: ${viewportHeight}px; }
    body { overflow: hidden; background: #fff; width: ${viewportWidth}px; height: ${viewportHeight}px; max-height: ${viewportHeight}px; }
    #pbi-container { width: ${viewportWidth}px; height: ${viewportHeight}px; overflow: hidden; }
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
        customLayout: { displayOption: models.DisplayOption.FitToPage },
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
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 })

    await page.goto(localServer.url, { waitUntil: 'domcontentloaded', timeout: 15000 })

    try {
      await page.waitForFunction('window._pbiRendered === true', { timeout: 60000 })
    } catch {
      const pbiError = await page.evaluate(() => window._pbiError ?? null).catch(() => null)
      if (pbiError) throw new Error('Power BI erro ao renderizar: ' + pbiError)
      throw new Error('Tempo esgotado aguardando renderizacao do Power BI (60s) — verifique autenticacao e se o relatorio esta acessivel no Power BI')
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

    if (!pagesToCapture) {
      pdfBuffer = await captureSinglePagePdf(page, pdfFormat)
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
            await page.waitForFunction('window._pbiRendered === true', { timeout: 60000 })
          } catch {
            // continua com pagina possivelmente nao renderizada
          }
          await page.waitForNetworkIdle({ idleTime: 2000, timeout: 15000 }).catch(() => {})
          await new Promise(r => setTimeout(r, 3000))
        }

        pagePdfs.push(await captureSinglePagePdf(page, pdfFormat))
      }

      const merged = await PDFDocument.create()
      for (const buf of pagePdfs) {
        const doc = await PDFDocument.load(buf)
        const copied = await merged.copyPages(doc, doc.getPageIndices())
        copied.forEach(p => merged.addPage(p))
      }
      pdfBuffer = Buffer.from(await merged.save())
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
    await browser.close().catch(() => {})
    await localServer.close().catch(() => {})
  }
}

main().catch(err => {
  process.stderr.write(err && err.message ? err.message : String(err))
  process.exit(1)
})
