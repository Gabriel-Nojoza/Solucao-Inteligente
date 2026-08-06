import { execFile } from "child_process"
import * as http from "http"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import puppeteer from "puppeteer-core"
import { PDFDocument } from "pdf-lib"

const execFileAsync = promisify(execFile)

// Limita capturas simultâneas para evitar sobrecarga de CPU com múltiplos Chromes
const MAX_CONCURRENT_CAPTURES = 1
let _activeCaptures = 0
const _captureQueue: Array<() => void> = []

function acquireCaptureSemaphore(): Promise<void> {
  return new Promise((resolve) => {
    if (_activeCaptures < MAX_CONCURRENT_CAPTURES) {
      _activeCaptures++
      resolve()
    } else {
      _captureQueue.push(() => { _activeCaptures++; resolve() })
    }
  })
}

function releaseCaptureSemaphore(): void {
  const next = _captureQueue.shift()
  if (next) {
    next()
  } else {
    _activeCaptures--
  }
}

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
]

async function findChromePath(): Promise<string> {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(
    "Nao foi possivel encontrar o Chrome ou Edge instalado. Instale o Google Chrome e tente novamente."
  )
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function isValidPngFile(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, "r")
    const header = Buffer.alloc(8)
    const { bytesRead } = await fd.read(header, 0, 8, 0)
    await fd.close()
    return bytesRead === 8 && header.equals(PNG_MAGIC)
  } catch {
    return false
  }
}

async function runGhostscript(args: string[]): Promise<void> {
  await execFileAsync("gs", args).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      throw new Error("Ghostscript (gs) nao encontrado. Instale com: apt-get install -y ghostscript")
    }
    throw err
  })
}

export async function pdfToPng(pdfBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir()
  const id = `pbi_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const tmpPdf = path.join(tmpDir, `${id}.pdf`)
  const tmpPng = path.join(tmpDir, `${id}.png`)

  const baseArgs = ["-dNOPAUSE", "-dBATCH", "-sDEVICE=png16m", "-r150", "-dFirstPage=1", "-dLastPage=1"]

  try {
    await fs.promises.writeFile(tmpPdf, pdfBuffer)

    // Try with CropBox first (removes black borders around the report)
    await runGhostscript([...baseArgs, "-dUseCropBox", `-sOutputFile=${tmpPng}`, tmpPdf])

    if (!(await isValidPngFile(tmpPng))) {
      // CropBox produced an invalid PNG (PDF has no CropBox) — retry without it
      fs.unlink(tmpPng, () => {})
      await runGhostscript([...baseArgs, `-sOutputFile=${tmpPng}`, tmpPdf])
    }

    if (!fs.existsSync(tmpPng)) {
      throw new Error("Ghostscript nao gerou o arquivo PNG esperado")
    }

    return await fs.promises.readFile(tmpPng)
  } finally {
    fs.unlink(tmpPdf, () => {})
    fs.unlink(tmpPng, () => {})
  }
}

async function serveHtmlLocally(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}

function loadPowerBiClientJs(): string {
  const localPath = path.join(process.cwd(), "public", "powerbi-client.min.js")
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, "utf-8")
  }
  throw new Error("powerbi-client.min.js nao encontrado em public/. Adicione o arquivo ao repositorio.")
}

export async function captureReportScreenshot(input: {
  embedUrl: string
  embedToken: string
  reportId: string
  pageName?: string | null
  viewportWidth?: number
  viewportHeight?: number
  deviceScaleFactor?: number
  tokenType?: "Embed" | "Aad"
}): Promise<Buffer> {
  const workerPath = path.join(process.cwd(), "scripts", "chrome-capture.js")
  const captureInput = JSON.stringify({
    embedUrl: input.embedUrl,
    embedToken: input.embedToken,
    reportId: input.reportId,
    pageName: input.pageName ?? null,
    viewportWidth: input.viewportWidth ?? 1280,
    viewportHeight: input.viewportHeight ?? 1600,
    deviceScaleFactor: input.deviceScaleFactor ?? 2,
    tokenType: input.tokenType ?? "Embed",
  })

  await acquireCaptureSemaphore()
  try {
    console.log("[captureReportScreenshot] iniciando processo filho isolado", {
      reportId: input.reportId,
      tokenType: input.tokenType,
    })
    const { stdout } = await execFileAsync("node", [workerPath], {
      timeout: 120_000,
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env, CHROME_CAPTURE_INPUT: captureInput },
      killSignal: "SIGKILL",
      encoding: "utf8",
    } as any)
    return Buffer.from(String(stdout), "base64")
  } catch (err: any) {
    const stderr = err.stderr ?? ""
    const killed = err.killed === true || err.signal === "SIGKILL"
    if (killed) {
      throw new Error(
        "Tempo limite ao capturar screenshot via Chrome (120s) — o relatório não renderizou. Verifique autenticação e acesso no Power BI."
      )
    }
    if (stderr) {
      throw new Error(`Falha ao capturar screenshot: ${stderr.trim()}`)
    }
    throw err
  } finally {
    releaseCaptureSemaphore()
  }
}

async function injectPrintColorAdjust(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const s = document.createElement("style")
      s.textContent =
        "* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }"
      ;(document.head ?? document.documentElement)?.appendChild(s)
    }).catch(() => {})
  }
}

async function captureSinglePagePdf(page: any, format: string): Promise<Buffer> {
  await injectPrintColorAdjust(page)
  const pdf = await page.pdf({
    format,
    landscape: true,
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  })
  return Buffer.from(pdf)
}

export async function captureReportAsPdf(input: {
  embedUrl: string
  embedToken: string
  reportId: string
  pageName?: string | null
  pageNames?: string[] | null
  viewportWidth?: number
  viewportHeight?: number
  tokenType?: "Embed" | "Aad"
  timeoutMs?: number
}): Promise<Buffer> {
  const overallTimeoutMs = input.timeoutMs ?? 120_000
  const executablePath = await findChromePath()
  // A6 landscape em 96dpi: 148mm × 105mm → 559 × 397px
  const width = input.viewportWidth ?? 559
  const height = input.viewportHeight ?? 397
  const powerBiClientJs = loadPowerBiClientJs()
  const pdfFormat = "A6"

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0; size: A6 landscape; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { width: ${width}px; height: ${height}px; overflow: hidden; max-height: ${height}px; }
    body { overflow: hidden; background: #fff; width: ${width}px; height: ${height}px; max-height: ${height}px; }
    #pbi-container { width: ${width}px; height: ${height}px; overflow: hidden; }
  </style>
</head>
<body>
  <div id="pbi-container"></div>
  <script>${powerBiClientJs}</script>
  <script>
    window._pbiRendered = false;
    window._pbiError = null;
    window._pbiReport = null;
    window._pbiPages = null; // null = ainda carregando, [] = falhou, ['name',...] = ok

    var models = window['powerbi-client'].models;
    var container = document.getElementById('pbi-container');
    var config = {
      type: 'report',
      id: ${JSON.stringify(input.reportId)},
      embedUrl: ${JSON.stringify(input.embedUrl)},
      accessToken: ${JSON.stringify(input.embedToken)},
      tokenType: ${input.tokenType === "Aad" ? "models.TokenType.Aad" : "models.TokenType.Embed"},
      ${input.pageName ? `pageName: ${JSON.stringify(input.pageName)},` : ""}
      settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false,
        background: models.BackgroundType.Default,
        layoutType: models.LayoutType.Custom,
        customLayout: {
          displayOption: models.DisplayOption.FitToPage,
        },
      },
    };

    var report = window['powerbi'].embed(container, config);
    window._pbiReport = report;

    report.on('loaded', function() {
      report.getPages().then(function(pages) {
        var visible = pages.filter(function(p) { return p.visibility === 0; }).map(function(p) { return p.name; });
        window._pbiPages = visible;
        console.log('[PBI] pages loaded:', JSON.stringify(visible));
      }).catch(function(err) {
        console.log('[PBI] getPages error:', err && err.message ? err.message : String(err));
        window._pbiPages = [];
      });
    });

    report.on('rendered', function() {
      setTimeout(function() { window._pbiRendered = true; }, 5000);
    });

    report.on('error', function(event) {
      window._pbiError = JSON.stringify(event.detail);
      window._pbiPages = [];
      window._pbiRendered = true;
    });
  </script>
</body>
</html>`

  await acquireCaptureSemaphore()

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let activeBrowserPdf: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  const doCapture = async (): Promise<Buffer> => {
    const localServer = await serveHtmlLocally(html)
    activeBrowserPdf = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--force-color-profile=srgb",
      ],
      timeout: 30000,
    })
    const browser = activeBrowserPdf

    try {
      const page = await browser.newPage()
      await page.setViewport({ width, height, deviceScaleFactor: 1 })

      page.on("console", (msg) => {
        console.log(`[Chrome] ${msg.type()}: ${msg.text()}`)
      })
      page.on("pageerror", (err: unknown) => {
        console.error(`[Chrome pageerror]: ${err instanceof Error ? err.message : String(err)}`)
      })

      await page.goto(localServer.url, { waitUntil: "domcontentloaded", timeout: 15000 })

      try {
        await page.waitForFunction("window._pbiRendered === true", { timeout: 60000 })
      } catch {
        const pbiError = await page.evaluate(() => (window as any)._pbiError ?? null).catch(() => null)
        if (pbiError) throw new Error(`Power BI erro ao renderizar: ${pbiError}`)
        throw new Error("Tempo esgotado aguardando renderização do Power BI (60s) — verifique autenticação e se o relatório está acessível no Power BI")
      }

    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 2000))

    // Determina quais páginas capturar
    // Se pageName foi especificado → só essa página
    // Se pageNames foi especificado com múltiplas → essas páginas
    // Se nenhum foi especificado → busca todas as páginas visíveis do relatório
    let pagesToCapture: string[] | null = null

    if (input.pageName) {
      pagesToCapture = null // já está na página certa, captura direto
    } else if (input.pageNames && input.pageNames.length > 1) {
      pagesToCapture = input.pageNames
    } else if (!input.pageName && (!input.pageNames || input.pageNames.length === 0)) {
      // Aguarda _pbiPages ser preenchido pelo evento 'loaded'
      await page.waitForFunction("Array.isArray(window._pbiPages)", { timeout: 15000 }).catch(() => {})

      let allPages = await page.evaluate(() => (window as any)._pbiPages ?? null).catch(() => null) as string[] | null

      // Fallback: chama getPages() diretamente se o evento 'loaded' nao preencheu _pbiPages
      if (!Array.isArray(allPages) || allPages.length === 0) {
        console.log("[Chrome] _pbiPages nao disponivel via loaded — chamando getPages() diretamente")
        allPages = await page.evaluate(() => {
          const rpt = (window as any)._pbiReport
          if (!rpt || typeof rpt.getPages !== "function") return []
          return rpt.getPages().then((pages: any[]) =>
            pages.filter((p: any) => p.visibility === 0).map((p: any) => ({ name: p.name, displayName: p.displayName }))
          )
        }).then((items: any) => (Array.isArray(items) ? items.map((i: any) => (typeof i === "string" ? i : i.name)) : [])).catch(() => [])
      }

      console.log(`[Chrome] páginas detectadas: ${JSON.stringify(allPages)}`)
      if (Array.isArray(allPages) && allPages.length > 1) pagesToCapture = allPages
    }

    // Captura página única
    if (!pagesToCapture) {
      console.log(`[Chrome] captureReportAsPdf: pagina unica — pageName=${input.pageName ?? "null"} pageNames=${JSON.stringify(input.pageNames ?? null)}`)
      return await captureSinglePagePdf(page, pdfFormat)
    }

    // Captura múltiplas páginas e mescla
    console.log(`[Chrome] captureReportAsPdf: multi-pagina — capturando ${pagesToCapture.length} paginas: ${JSON.stringify(pagesToCapture)}`)
    const pagePdfs: Buffer[] = []

    for (let i = 0; i < pagesToCapture.length; i++) {
      const pbiPageName = pagesToCapture[i]

      if (i > 0) {
        // Navega para a próxima página e aguarda re-render
        await page.evaluate((name: string) => {
          ;(window as any)._pbiRendered = false
          ;(window as any)._pbiReport.setPage(name)
        }, pbiPageName)

        try {
          await page.waitForFunction("window._pbiRendered === true", { timeout: 60000 })
        } catch {
          console.warn(`[Chrome] Timeout aguardando render da página ${pbiPageName}`)
        }
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {})
        await new Promise((r) => setTimeout(r, 2000))
      }

      const pdfBuf = await captureSinglePagePdf(page, pdfFormat)
      pagePdfs.push(pdfBuf)
      console.log(`[Chrome] Página ${i + 1}/${pagesToCapture.length} capturada`)
    }

    // Mescla todos os PDFs num único documento
    const merged = await PDFDocument.create()
    for (const pdfBuf of pagePdfs) {
      const doc = await PDFDocument.load(pdfBuf)
      const copied = await merged.copyPages(doc, doc.getPageIndices())
      copied.forEach((p) => merged.addPage(p))
    }
    const mergedBytes = await merged.save()
    return Buffer.from(mergedBytes)
    } finally {
      await browser.close().catch(() => {})
      await localServer.close().catch(() => {})
    }
  }

  try {
    const result = await Promise.race([
      doCapture(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const pid = activeBrowserPdf?.process()?.pid
          activeBrowserPdf?.close().catch(() => {})
          if (pid) setTimeout(() => { try { process.kill(pid, "SIGKILL") } catch {} }, 1000)
          reject(new Error(
            `Tempo limite ao capturar relatório via Chrome (${Math.round(overallTimeoutMs / 1000)}s) — o relatório não renderizou. Verifique autenticação e acesso no Power BI.`
          ))
        }, overallTimeoutMs)
      }),
    ])
    clearTimeout(timeoutHandle!)
    return result
  } catch (err) {
    clearTimeout(timeoutHandle!)
    throw err
  } finally {
    releaseCaptureSemaphore()
  }
}

export async function buildPdfFromHtml(html: string): Promise<Buffer> {
  const executablePath = await findChromePath()

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    timeout: 90000,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "load" })
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
