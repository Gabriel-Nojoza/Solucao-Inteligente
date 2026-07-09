import { execFile } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import puppeteer from "puppeteer-core"

const execFileAsync = promisify(execFile)

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
}): Promise<Buffer> {
  const executablePath = await findChromePath()
  const width = input.viewportWidth ?? 900
  const height = input.viewportHeight ?? 1100
  const powerBiClientJs = loadPowerBiClientJs()

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #fff; width: ${width}px; height: ${height}px; }
    #pbi-container { width: ${width}px; height: ${height}px; }
  </style>
</head>
<body>
  <div id="pbi-container"></div>
  <script>${powerBiClientJs}</script>
  <script>
    window._pbiRendered = false;
    window._pbiError = null;

    var models = window['powerbi-client'].models;
    var container = document.getElementById('pbi-container');
    var config = {
      type: 'report',
      id: ${JSON.stringify(input.reportId)},
      embedUrl: ${JSON.stringify(input.embedUrl)},
      accessToken: ${JSON.stringify(input.embedToken)},
      tokenType: models.TokenType.Embed,
      ${input.pageName ? `pageName: ${JSON.stringify(input.pageName)},` : ""}
      settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false,
        background: models.BackgroundType.Default,
      },
    };

    var report = window['powerbi'].embed(container, config);

    report.on('rendered', function() {
      // Extra delay so custom visuals finish painting
      setTimeout(function() { window._pbiRendered = true; }, 2000);
    });

    report.on('error', function(event) {
      window._pbiError = JSON.stringify(event.detail);
      window._pbiRendered = true;
    });
  </script>
</body>
</html>`

  const maxAttempts = 2
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
    const tmpHtmlPath = path.join(os.tmpdir(), `pbi_capture_${Date.now()}_${attempt}.html`)
    try {
      await fs.promises.writeFile(tmpHtmlPath, html, "utf-8")

      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--allow-file-access-from-files",
        ],
        timeout: 90000,
      })

      const page = await browser.newPage()
      await page.setViewport({ width, height, deviceScaleFactor: 2 })
      await page.goto(`file://${tmpHtmlPath}`, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForFunction("window._pbiRendered === true", { timeout: 90000 })

      const element = await page.$("#pbi-container")
      if (!element) throw new Error("Container do Power BI nao encontrado na pagina")

      const screenshot = await element.screenshot({ type: "png" })
      return Buffer.from(screenshot)
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        console.warn(`[captureReportScreenshot] Tentativa ${attempt} falhou, retentando...`, err)
      }
    } finally {
      if (browser) await browser.close().catch(() => {})
      await fs.promises.unlink(tmpHtmlPath).catch(() => {})
    }
  }

  throw lastError
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
