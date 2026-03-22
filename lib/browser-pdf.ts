import { spawn, type ChildProcess } from "child_process"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const BROWSER_ENV_KEYS = [
  "REPORT_PDF_BROWSER_PATH",
  "PDF_BROWSER_PATH",
  "CHROME_PATH",
  "GOOGLE_CHROME_BIN",
  "PUPPETEER_EXECUTABLE_PATH",
]

const COMMON_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]

const PATH_BROWSER_CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  "msedge",
  "microsoft-edge",
]

type BrowserWorkspace = {
  workingDir: string
  htmlPath: string
  profilePath: string
}

type ChromeLaunchResult = {
  child: ChildProcess
  websocketUrl: string
}

type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
  sessionId?: string
}

type ScreenshotReadyState = {
  ready: boolean
  error: string | null
  scrollWidth: number
  scrollHeight: number
}

type PdfRenderOptions = {
  timeoutMs?: number
  virtualTimeBudgetMs?: number
  pageWidthMm?: number
  pageHeightMm?: number
  marginMm?: number
  landscape?: boolean
  scale?: number
  printBackground?: boolean
}

type PngRenderOptions = {
  timeoutMs?: number
  captureWidth?: number
  captureHeight?: number
  deviceScaleFactor?: number
  screenshotScale?: number
  forceExpandScrollable?: boolean
}

type ScreenshotToPdfOptions = {
  pngTimeoutMs?: number
  pdfTimeoutMs?: number
  pageWidthMm?: number
  pageHeightMm?: number
  pageMarginMm?: number
  captureWidth?: number
  captureHeight?: number
  deviceScaleFactor?: number
  screenshotScale?: number
}

type CdpSendOptions = {
  sessionId?: string
}

const PNG_SIGNATURE = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
])

const CSS_PIXELS_PER_INCH = 96
const MILLIMETERS_PER_INCH = 25.4

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseEnvNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parsePngDimensions(png: Buffer) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("A captura do relatorio nao retornou um PNG valido")
  }

  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)

  if (!width || !height) {
    throw new Error("Nao foi possivel ler o tamanho da captura do relatorio")
  }

  return { width, height }
}

function millimetersToCssPixels(value: number) {
  return Math.max(
    1,
    Math.round((value * CSS_PIXELS_PER_INCH) / MILLIMETERS_PER_INCH)
  )
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findExecutableOnPath(command: string) {
  const pathValue = process.env.PATH || ""
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean)
  const extEntries =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""]

  for (const entry of pathEntries) {
    const hasExtension = /\.[^./\\]+$/.test(command)
    const suffixes = hasExtension ? [""] : extEntries

    for (const suffix of suffixes) {
      const candidate = path.join(entry, `${command}${suffix}`)
      if (await pathExists(candidate)) {
        return candidate
      }
    }
  }

  return null
}

export async function resolvePdfBrowserExecutable() {
  for (const key of BROWSER_ENV_KEYS) {
    const configured = process.env[key]?.trim()
    if (configured && (await pathExists(configured))) {
      return configured
    }
  }

  for (const candidate of PATH_BROWSER_CANDIDATES) {
    const resolved = await findExecutableOnPath(candidate)
    if (resolved) {
      return resolved
    }
  }

  for (const candidate of COMMON_BROWSER_PATHS) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(
    "Nao encontrei Chrome ou Edge para gerar PDF. Instale o navegador no servidor ou configure REPORT_PDF_BROWSER_PATH."
  )
}

async function createBrowserWorkspace(
  prefix: string,
  html: string
): Promise<BrowserWorkspace> {
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const htmlPath = path.join(workingDir, "report.html")
  const profilePath = path.join(workingDir, "profile")

  await fs.mkdir(profilePath, { recursive: true })
  await fs.writeFile(htmlPath, html, "utf-8")

  return {
    workingDir,
    htmlPath,
    profilePath,
  }
}

async function cleanupBrowserWorkspace(workspace: BrowserWorkspace) {
  await fs.rm(workspace.workingDir, { recursive: true, force: true })
}

function getCommonBrowserArgs(profilePath: string) {
  return [
    "--headless",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    ...(process.platform === "linux"
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : []),
    `--user-data-dir=${profilePath}`,
  ]
}

function runProcess(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let finished = false

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill()
      reject(new Error("Tempo limite ao gerar PDF no navegador"))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.once("error", (error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      reject(error)
    })

    child.once("exit", (code) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `Falha ao executar o navegador para gerar PDF (codigo ${code ?? "desconhecido"})`
        )
      )
    })
  })
}

async function launchChromeWithDebugging(
  executablePath: string,
  htmlUrl: string,
  profilePath: string,
  timeoutMs: number
): Promise<ChromeLaunchResult> {
  return new Promise((resolve, reject) => {
    const args = [
      ...getCommonBrowserArgs(profilePath),
      "--remote-debugging-port=0",
      "about:blank",
    ]

    const child = spawn(executablePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let finished = false
    let stdout = ""
    let stderr = ""

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill()
      reject(new Error("Tempo limite ao iniciar o navegador para captura"))
    }, timeoutMs)

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      stderr += text

      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/i)
      if (!match || finished) return

      finished = true
      clearTimeout(timeout)

      resolve({
        child,
        websocketUrl: match[1],
      })
    }

    child.stdout.on("data", handleOutput)
    child.stderr.on("data", handleOutput)

    child.once("error", (error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      reject(error)
    })

    child.once("exit", (code) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `Falha ao iniciar o navegador para captura (codigo ${code ?? "desconhecido"})`
        )
      )
    })
  })
}

class CdpClient {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void
      reject: (error: Error) => void
    }
  >()

  private sessions = new Map<
    string,
    Map<string, Array<(params: Record<string, unknown>) => void>>
  >()

  private rootListeners = new Map<
    string,
    Array<(params: Record<string, unknown>) => void>
  >()

  constructor(ws: WebSocket) {
    this.ws = ws

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : event.data.toString()
      const message = JSON.parse(raw) as CdpMessage

      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id)
        if (!pending) return

        this.pending.delete(message.id)

        if (message.error?.message) {
          pending.reject(new Error(message.error.message))
          return
        }

        pending.resolve(message.result ?? {})
        return
      }

      if (!message.method) return

      if (message.sessionId) {
        const sessionListeners = this.sessions.get(message.sessionId)
        const listeners = sessionListeners?.get(message.method) ?? []
        for (const listener of listeners) {
          listener(message.params ?? {})
        }
        return
      }

      const rootListeners = this.rootListeners.get(message.method) ?? []
      for (const listener of rootListeners) {
        listener(message.params ?? {})
      }
    })

    ws.addEventListener("close", () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error("A conexao com o navegador foi encerrada"))
      }
      this.pending.clear()
    })
  }

  send(
    method: string,
    params?: Record<string, unknown>,
    options?: CdpSendOptions
  ) {
    const id = this.nextId++
    const payload: Record<string, unknown> = {
      id,
      method,
    }

    if (params) payload.params = params
    if (options?.sessionId) payload.sessionId = options.sessionId

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }

  on(
    method: string,
    listener: (params: Record<string, unknown>) => void,
    sessionId?: string
  ) {
    const store = sessionId
      ? this.sessions.get(sessionId) ?? new Map<string, Array<(params: Record<string, unknown>) => void>>()
      : this.rootListeners

    if (sessionId && !this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, store as Map<string, Array<(params: Record<string, unknown>) => void>>)
    }

    const listeners = store.get(method) ?? []
    listeners.push(listener)
    store.set(method, listeners)

    return () => {
      const current = store.get(method) ?? []
      const next = current.filter((item) => item !== listener)
      if (next.length > 0) {
        store.set(method, next)
      } else {
        store.delete(method)
      }
    }
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
  }
}

async function connectCdp(websocketUrl: string) {
  const ws = new WebSocket(websocketUrl)

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Tempo limite ao conectar no Chrome DevTools Protocol"))
    }, 15000)

    ws.addEventListener("open", () => {
      clearTimeout(timeout)
      resolve()
    })

    ws.addEventListener("error", () => {
      clearTimeout(timeout)
      reject(new Error("Falha ao conectar no Chrome DevTools Protocol"))
    })
  })

  return new CdpClient(ws)
}

async function closeChrome(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) return

  child.kill("SIGTERM")
  await delay(500)

  if (child.exitCode === null && !child.killed) {
    child.kill("SIGKILL")
  }
}

async function openHtmlInNewPage(
  client: CdpClient,
  htmlUrl: string
) {
  const targetResult = await client.send("Target.createTarget", {
    url: "about:blank",
    width: 1280,
    height: 720,
    newWindow: false,
    background: true,
  })

  const targetId = String(targetResult.targetId)
  if (!targetId) {
    throw new Error("Nao foi possivel criar a pagina do navegador")
  }

  const attachResult = await client.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })

  const sessionId = String(attachResult.sessionId)
  if (!sessionId) {
    throw new Error("Nao foi possivel conectar a pagina do navegador")
  }

  await client.send("Page.enable", {}, { sessionId })
  await client.send("Runtime.enable", {}, { sessionId })
  await client.send("DOM.enable", {}, { sessionId })
  await client.send("Network.enable", {}, { sessionId })

  const navigateResult = await client.send(
    "Page.navigate",
    { url: htmlUrl },
    { sessionId }
  )

  if (!navigateResult.frameId) {
    throw new Error("Nao foi possivel abrir o HTML temporario no navegador")
  }

  await waitForPageLoad(client, sessionId, 30000)

  return {
    sessionId,
    targetId,
  }
}

async function waitForPageLoad(
  client: CdpClient,
  sessionId: string,
  timeoutMs: number
) {
  await new Promise<void>((resolve, reject) => {
    let resolved = false

    const cleanupLoad = client.on(
      "Page.loadEventFired",
      () => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        cleanupLoad()
        resolve()
      },
      sessionId
    )

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      cleanupLoad()
      reject(new Error("Tempo limite ao carregar o HTML no navegador"))
    }, timeoutMs)
  })

  await delay(400)
}

async function withBrowserPage<T>(
  html: string,
  timeoutMs: number,
  fn: (client: CdpClient, sessionId: string, htmlUrl: string) => Promise<T>
) {
  const executablePath = await resolvePdfBrowserExecutable()
  const workspace = await createBrowserWorkspace("browser-pdf-", html)
  const htmlUrl = pathToFileURL(workspace.htmlPath).toString()

  let chrome: ChromeLaunchResult | null = null
  let client: CdpClient | null = null

  try {
    chrome = await launchChromeWithDebugging(
      executablePath,
      htmlUrl,
      workspace.profilePath,
      timeoutMs
    )

    client = await connectCdp(chrome.websocketUrl)
    const page = await openHtmlInNewPage(client, htmlUrl)

    return await fn(client, page.sessionId, htmlUrl)
  } finally {
    if (client) {
      await client.close().catch(() => {})
    }

    if (chrome) {
      await closeChrome(chrome.child).catch(() => {})
    }

    await cleanupBrowserWorkspace(workspace).catch(() => {})
  }
}

async function waitForDomReady(
  client: CdpClient,
  sessionId: string,
  virtualTimeBudgetMs: number
) {
  await delay(Math.max(300, Math.min(virtualTimeBudgetMs, 5000)))

  const state = await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const readyState = document.readyState;
        const body = document.body;
        const documentElement = document.documentElement;

        return {
          ready: readyState === 'complete' || readyState === 'interactive',
          error: null,
          scrollWidth: Math.max(
            body?.scrollWidth || 0,
            documentElement?.scrollWidth || 0
          ),
          scrollHeight: Math.max(
            body?.scrollHeight || 0,
            documentElement?.scrollHeight || 0
          )
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )
  const resultValue = (state.result as { value?: ScreenshotReadyState} | undefined)?.value

  return resultValue ?? {
    ready: false,
    error: "Nao foi possivel ler o DOM do relatorio",
    scrollWidth: 0,
    scrollHeight: 0,
  } as ScreenshotReadyState
}

async function expandScrollableAreas(client: CdpClient, sessionId: string) {
  await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const all = Array.from(document.querySelectorAll('*'));

        for (const el of all) {
          if (!(el instanceof HTMLElement)) continue;

          const style = window.getComputedStyle(el);
          const hasScrollY =
            (style.overflowY === 'auto' ||
              style.overflowY === 'scroll' ||
              style.overflow === 'auto' ||
              style.overflow === 'scroll') &&
            el.scrollHeight > el.clientHeight + 8;

          const hasScrollX =
            (style.overflowX === 'auto' ||
              style.overflowX === 'scroll' ||
              style.overflow === 'auto' ||
              style.overflow === 'scroll') &&
            el.scrollWidth > el.clientWidth + 8;

          if (hasScrollY || hasScrollX) {
            el.style.setProperty('overflow', 'visible', 'important');
            el.style.setProperty('overflow-y', 'visible', 'important');
            el.style.setProperty('overflow-x', 'visible', 'important');
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('max-width', 'none', 'important');

            if (hasScrollY) {
              el.style.setProperty('height', el.scrollHeight + 'px', 'important');
            }

            if (hasScrollX) {
              el.style.setProperty('width', el.scrollWidth + 'px', 'important');
            }
          }
        }

        document.documentElement.style.setProperty('overflow', 'visible', 'important');
        document.body.style.setProperty('overflow', 'visible', 'important');

        return true;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )

  await delay(1200)
}

export async function renderHtmlToPdf(
  html: string,
  options?: PdfRenderOptions
) {
  const timeoutMs = options?.timeoutMs ?? 60000
  const virtualTimeBudgetMs = options?.virtualTimeBudgetMs ?? 3000
  const pageWidthMm = options?.pageWidthMm ?? 420
  const pageHeightMm = options?.pageHeightMm ?? 594
  const marginMm = options?.marginMm ?? 0
  const scale = options?.scale ?? 1
  const printBackground = options?.printBackground ?? true

  return withBrowserPage(html, timeoutMs, async (client, sessionId) => {
    const lastState = await waitForDomReady(client, sessionId, virtualTimeBudgetMs)

    if (!lastState.ready) {
      throw new Error(lastState.error || "O HTML do relatorio nao ficou pronto para gerar o PDF")
    }

    await client.send(
      "Emulation.setEmulatedMedia",
      {
        media: "print",
      },
      { sessionId }
    )

    const pdf = await client.send(
      "Page.printToPDF",
      {
        printBackground,
        preferCSSPageSize: true,
        paperWidth: pageWidthMm / MILLIMETERS_PER_INCH,
        paperHeight: pageHeightMm / MILLIMETERS_PER_INCH,
        marginTop: marginMm / MILLIMETERS_PER_INCH,
        marginBottom: marginMm / MILLIMETERS_PER_INCH,
        marginLeft: marginMm / MILLIMETERS_PER_INCH,
        marginRight: marginMm / MILLIMETERS_PER_INCH,
        landscape: options?.landscape ?? false,
        scale,
      },
      { sessionId }
    )

    const data = String(pdf.data || "")
    if (!data) {
      throw new Error("O navegador nao retornou o PDF do relatorio")
    }

    return Buffer.from(data, "base64")
  })
}

export async function renderHtmlToPng(
  html: string,
  options?: PngRenderOptions
) {
  const timeoutMs = options?.timeoutMs ?? 60000
  const captureWidth =
    options?.captureWidth ?? parseEnvNumber("REPORT_PDF_CAPTURE_WIDTH", 2560)
  const captureHeight =
    options?.captureHeight ?? parseEnvNumber("REPORT_PDF_CAPTURE_HEIGHT", 1707)
  const deviceScaleFactor =
    options?.deviceScaleFactor ??
    parseEnvNumber("REPORT_PDF_DEVICE_SCALE_FACTOR", 3)
  const screenshotScale =
    options?.screenshotScale ??
    parseEnvNumber("REPORT_PDF_SCREENSHOT_SCALE", 3.5)

  return withBrowserPage(html, timeoutMs, async (client, sessionId) => {
    await client.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: captureWidth,
        height: captureHeight,
        deviceScaleFactor,
        mobile: false,
        scale: screenshotScale,
      },
      { sessionId }
    )

    const lastState = await waitForDomReady(client, sessionId, 4000)

    if (!lastState.ready) {
      throw new Error(lastState.error || "O HTML do relatorio nao ficou pronto para captura")
    }

    if (options?.forceExpandScrollable !== false) {
      await expandScrollableAreas(client, sessionId)
    }

    const layoutMetrics = await client.send(
      "Page.getLayoutMetrics",
      {},
      { sessionId }
    )

    const contentSize = layoutMetrics.contentSize as
      | { width?: number; height?: number; x?: number; y?: number }
      | undefined

    const fullWidth = Math.max(
      captureWidth,
      Math.ceil(contentSize?.width ?? lastState.scrollWidth ?? captureWidth)
    )
    const fullHeight = Math.max(
      captureHeight,
      Math.ceil(contentSize?.height ?? lastState.scrollHeight ?? captureHeight)
    )

    await client.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: fullWidth,
        height: Math.min(fullHeight, 16384),
        deviceScaleFactor,
        mobile: false,
        scale: screenshotScale,
      },
      { sessionId }
    )

    await delay(400)

    const screenshot = await client.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: fullWidth,
          height: fullHeight,
          scale: 1,
        },
      },
      { sessionId }
    )

    const data = String(screenshot.data || "")
    if (!data) {
      throw new Error("O navegador nao retornou a captura do relatorio")
    }

    return Buffer.from(data, "base64")
  })
}

export async function renderHtmlScreenshotToPdf(
  html: string,
  options?: ScreenshotToPdfOptions
) {
  const screenshot = await renderHtmlToPng(html, {
    timeoutMs: options?.pngTimeoutMs ?? 60000,
    captureWidth: options?.captureWidth,
    captureHeight: options?.captureHeight,
    deviceScaleFactor: options?.deviceScaleFactor,
    screenshotScale: options?.screenshotScale,
    forceExpandScrollable: true,
  })

  const pageWidthMm = options?.pageWidthMm ?? 420
  const pageHeightMm = options?.pageHeightMm ?? 594
  const pageMarginMm = options?.pageMarginMm ?? 8

  const pageWidthPx = millimetersToCssPixels(pageWidthMm)
  const pageHeightPx = millimetersToCssPixels(pageHeightMm)
  const pageMarginPx = millimetersToCssPixels(pageMarginMm)
  const contentWidthPx = Math.max(1, pageWidthPx - pageMarginPx * 2)
  const contentHeightPx = Math.max(1, pageHeightPx - pageMarginPx * 2)

  const screenshotDimensions = parsePngDimensions(screenshot)
  const renderedImageWidthPx = contentWidthPx
  const renderedImageHeightPx = Math.max(
    1,
    Math.round(
      (screenshotDimensions.height * renderedImageWidthPx) / screenshotDimensions.width
    )
  )

  const totalSlices = Math.max(
    1,
    Math.ceil(renderedImageHeightPx / contentHeightPx)
  )

  const base64 = screenshot.toString("base64")

  const pagesHtml = Array.from({ length: totalSlices }, (_, index) => {
    const offsetY = index * contentHeightPx

    return `
      <section class="pdf-page">
        <div class="slice">
          <img
            src="data:image/png;base64,${escapeHtmlAttribute(base64)}"
            alt="Relatorio Power BI"
            style="transform: translateY(-${offsetY}px);"
          />
        </div>
      </section>
    `
  }).join("")

  const imageHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page {
      size: ${pageWidthMm}mm ${pageHeightMm}mm;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      margin: 0;
      padding: 0;
      background: #ffffff;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    body {
      background: #ffffff;
    }

    .pdf-page {
      width: ${pageWidthPx}px;
      height: ${pageHeightPx}px;
      padding: ${pageMarginPx}px;
      background: #ffffff;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }

    .pdf-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .slice {
      width: ${contentWidthPx}px;
      height: ${contentHeightPx}px;
      overflow: hidden;
      position: relative;
      flex: 0 0 auto;
    }

    img {
      display: block;
      width: ${renderedImageWidthPx}px;
      height: ${renderedImageHeightPx}px;
      max-width: none;
      max-height: none;
      object-fit: contain;
      image-rendering: auto;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`

  return renderHtmlToPdf(imageHtml, {
    timeoutMs: options?.pdfTimeoutMs ?? 60000,
    virtualTimeBudgetMs: 3000,
    pageWidthMm,
    pageHeightMm,
    marginMm: 0,
    printBackground: true,
  })
}

export async function renderHtmlToPdfViaCli(
  html: string,
  options?: PdfRenderOptions
) {
  const executablePath = await resolvePdfBrowserExecutable()
  const timeoutMs = options?.timeoutMs ?? 60000
  const workspace = await createBrowserWorkspace("browser-pdf-cli-", html)
  const outputPath = path.join(workspace.workingDir, "report.pdf")
  const htmlUrl = pathToFileURL(workspace.htmlPath).toString()

  try {
    const args = [
      ...getCommonBrowserArgs(workspace.profilePath),
      `--print-to-pdf=${outputPath}`,
      htmlUrl,
    ]

    await runProcess(executablePath, args, timeoutMs)
    return await fs.readFile(outputPath)
  } finally {
    await cleanupBrowserWorkspace(workspace).catch(() => {})
  }
}