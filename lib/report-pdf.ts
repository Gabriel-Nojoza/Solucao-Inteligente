import { execFile, spawn, exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import puppeteer from "puppeteer-core"

const execFileAsync = promisify(execFile)

class CaptureTimeoutError extends Error {}

// Mata a árvore de processos inteira (node worker + Chrome + subprocessos do Chrome).
// Necessário porque matar só o processo node com SIGKILL deixa o Chrome órfão rodando
// indefinidamente na VPS — foi essa a causa da cascata de "ERR_INSUFFICIENT_RESOURCES" /
// "Failed to launch the browser process" observada quando muitos Chromes travados se
// acumulam depois de timeouts.
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    exec(`taskkill /PID ${pid} /T /F`, () => {})
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

// Roda o worker de captura em processo filho isolado, garantindo que o grupo de
// processos inteiro (incluindo o Chrome lançado pelo worker) seja encerrado tanto em
// timeout quanto ao final normal da execução — evita Chromes órfãos acumulando na VPS.
function runIsolatedWorker(workerPath: string, envVar: string, payload: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [workerPath], {
      env: { ...process.env, [envVar]: payload },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ""
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killProcessTree(child.pid)
    }, timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.once("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    child.once("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Rede de segurança: garante que nenhum Chrome sobreviva ao worker, mesmo em saída normal
      if (child.pid) killProcessTree(child.pid)

      if (timedOut) {
        reject(new CaptureTimeoutError(`Timeout apos ${timeoutMs}ms`))
        return
      }
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks))
      } else {
        reject(new Error(stderr.trim() || `Processo de captura saiu com codigo ${code}`))
      }
    })
  })
}

// Limita capturas simultâneas para evitar sobrecarga de CPU com múltiplos Chromes
const MAX_CONCURRENT_CAPTURES = 3
// Tempo maximo esperando na fila por um "slot" livre. Sem isso, sob carga alta
// (muitos relatorios pedindo captura ao mesmo tempo), uma requisicao podia
// ficar esperando indefinidamente e estourar o timeout do n8n (10 min) ou o
// auto-expire dos dispatch_logs (5 min) sem nenhum erro claro.
const CAPTURE_QUEUE_TIMEOUT_MS = 3 * 60 * 1000
let _activeCaptures = 0
const _captureQueue: Array<{ resolve: () => void; entry: { done: boolean } }> = []

function acquireCaptureSemaphore(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (_activeCaptures < MAX_CONCURRENT_CAPTURES) {
      _activeCaptures++
      resolve()
      return
    }

    const entry = { done: false }
    const resolveEntry = () => { entry.done = true; resolve() }
    _captureQueue.push({ resolve: resolveEntry, entry })

    setTimeout(() => {
      if (entry.done) return
      const idx = _captureQueue.findIndex((q) => q.entry === entry)
      if (idx !== -1) _captureQueue.splice(idx, 1)
      entry.done = true
      reject(new Error(
        `Fila de captura de relatorios cheia ha mais de ${CAPTURE_QUEUE_TIMEOUT_MS / 60000} minutos - tente novamente.`
      ))
    }, CAPTURE_QUEUE_TIMEOUT_MS)
  })
}

function releaseCaptureSemaphore(): void {
  const next = _captureQueue.shift()
  if (next) {
    next.resolve()
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
    const stdout = await runIsolatedWorker(workerPath, "CHROME_CAPTURE_INPUT", captureInput, 120_000)
    return Buffer.from(stdout.toString("utf8"), "base64")
  } catch (err: any) {
    if (err instanceof CaptureTimeoutError) {
      throw new Error(
        "Tempo limite ao capturar screenshot via Chrome (120s) — o relatório não renderizou. Verifique autenticação e acesso no Power BI."
      )
    }
    if (err?.message) {
      throw new Error(`Falha ao capturar screenshot: ${err.message}`)
    }
    throw err
  } finally {
    releaseCaptureSemaphore()
  }
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
  const workerPath = path.join(process.cwd(), "scripts", "chrome-capture-pdf.js")
  const captureInput = JSON.stringify({
    embedUrl: input.embedUrl,
    embedToken: input.embedToken,
    reportId: input.reportId,
    pageName: input.pageName ?? null,
    pageNames: input.pageNames ?? null,
    viewportWidth: input.viewportWidth ?? 559,
    viewportHeight: input.viewportHeight ?? 397,
    tokenType: input.tokenType ?? "Embed",
    pdfFormat: "A6",
  })

  const timeoutMs = input.timeoutMs ?? 120_000
  await acquireCaptureSemaphore()
  try {
    console.log("[captureReportAsPdf] iniciando processo filho isolado", {
      reportId: input.reportId,
      tokenType: input.tokenType,
    })
    const stdout = await runIsolatedWorker(workerPath, "CHROME_CAPTURE_PDF_INPUT", captureInput, timeoutMs)
    return Buffer.from(stdout.toString("utf8"), "base64")
  } catch (err: any) {
    if (err instanceof CaptureTimeoutError) {
      throw new Error(
        `Tempo limite ao capturar PDF via Chrome (${Math.round(timeoutMs / 1000)}s) — o relatório não renderizou. Verifique autenticação e acesso no Power BI.`
      )
    }
    if (err?.message) {
      throw new Error(`Falha ao capturar PDF: ${err.message}`)
    }
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
