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

async function createBrowserWorkspace(prefix: string, html: string): Promise<BrowserWorkspace> {
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

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number
) {
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
  browserExecutable: string,
  profilePath: string,
  timeoutMs: number
): Promise<ChromeLaunchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      browserExecutable,
      [
        ...getCommonBrowserArgs(profilePath),
        "--remote-debugging-port=0",
        "about:blank",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    )

    let settled = false
    let stderr = ""
    let stdout = ""

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const handleChunk = (chunk: string) => {
      const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (!match?.[1]) {
        return
      }

      finish(() => {
        resolve({
          child,
          websocketUrl: match[1],
        })
      })
    }

    const timeout = setTimeout(() => {
      finish(() => {
        child.kill()
        reject(
          new Error(
            stderr.trim() ||
            stdout.trim() ||
            "Tempo limite ao iniciar o navegador para captura"
          )
        )
      })
    }, timeoutMs)

    child.stdout.on("data", (buffer) => {
      const text = buffer.toString()
      stdout += text
      handleChunk(text)
    })

    child.stderr.on("data", (buffer) => {
      const text = buffer.toString()
      stderr += text
      handleChunk(text)
    })

    child.once("error", (error) => {
      finish(() => reject(error))
    })

    child.once("exit", (code) => {
      if (settled) {
        return
      }

      finish(() => {
        reject(
          new Error(
            stderr.trim() ||
            stdout.trim() ||
            `O navegador encerrou antes da captura (codigo ${code ?? "desconhecido"})`
          )
        )
      })
    })
  })
}

function parseMessageData(data: unknown) {
  if (typeof data === "string") {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf-8")
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text()
  }

  return ""
}

class CdpConnection {
  private socket: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void
      reject: (reason?: unknown) => void
    }
  >()
  private eventListeners = new Set<(message: CdpMessage) => void>()

  private constructor(socket: WebSocket) {
    this.socket = socket
  }

  static async connect(websocketUrl: string) {
    const socket = new WebSocket(websocketUrl)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Tempo limite ao conectar ao navegador headless"))
      }, 15000)

      socket.addEventListener("open", () => {
        clearTimeout(timeout)
        resolve()
      })

      socket.addEventListener("error", () => {
        clearTimeout(timeout)
        reject(new Error("Nao foi possivel conectar ao navegador headless"))
      })
    })

    const connection = new CdpConnection(socket)
    connection.attachListeners()
    return connection
  }

  private attachListeners() {
    this.socket.addEventListener("message", async (event) => {
      const raw = await parseMessageData(event.data)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as CdpMessage

      if (parsed.id) {
        const pending = this.pending.get(parsed.id)
        if (!pending) {
          return
        }

        this.pending.delete(parsed.id)

        if (parsed.error?.message) {
          pending.reject(new Error(parsed.error.message))
          return
        }

        pending.resolve(parsed.result ?? {})
        return
      }

      for (const listener of this.eventListeners) {
        listener(parsed)
      }
    })

    this.socket.addEventListener("close", () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error("Conexao com o navegador foi encerrada"))
      }

      this.pending.clear()
    })
  }

  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        })
      )
    })
  }

  waitForEvent(
    method: string,
    options?: {
      sessionId?: string
      timeoutMs?: number
      predicate?: (message: CdpMessage) => boolean
    }
  ) {
    return new Promise<CdpMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Tempo limite aguardando evento ${method}`))
      }, options?.timeoutMs ?? 15000)

      const listener = (message: CdpMessage) => {
        if (message.method !== method) {
          return
        }

        if (options?.sessionId && message.sessionId !== options.sessionId) {
          return
        }

        if (options?.predicate && !options.predicate(message)) {
          return
        }

        cleanup()
        resolve(message)
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.eventListeners.delete(listener)
      }

      this.eventListeners.add(listener)
    })
  }

  close() {
    this.socket.close()
  }
}

async function closeChromeProcess(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) {
    return
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill()
      resolve()
    }, 3000)

    child.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })

    child.kill()
  })
}

async function renderHtmlToPng(
  html: string,
  options?: {
    timeoutMs?: number
    waitForReadyTimeoutMs?: number
    viewportWidth?: number
    viewportHeight?: number
    deviceScaleFactor?: number
  }
) {
  const workspace = await createBrowserWorkspace("si-report-shot-", html)
  let connection: CdpConnection | null = null
  let child: ChildProcess | null = null

  try {
    const browserExecutable = await resolvePdfBrowserExecutable()
    const launch = await launchChromeWithDebugging(
      browserExecutable,
      workspace.profilePath,
      options?.timeoutMs ?? 30000
    )

    child = launch.child
    connection = await CdpConnection.connect(launch.websocketUrl)

    const createTargetResult = await connection.send("Target.createTarget", {
      url: "about:blank",
    })
    const targetId = String(createTargetResult.targetId ?? "")

    if (!targetId) {
      throw new Error("Nao foi possivel criar pagina temporaria para captura")
    }

    const attachResult = await connection.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })
    const sessionId = String(attachResult.sessionId ?? "")

    if (!sessionId) {
      throw new Error("Nao foi possivel anexar a pagina temporaria para captura")
    }

    await Promise.all([
      connection.send("Page.enable", {}, sessionId),
      connection.send("Runtime.enable", {}, sessionId),
      connection.send("Network.enable", {}, sessionId),
      connection.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: options?.viewportWidth ?? 1600,
          height: options?.viewportHeight ?? 1100,
          mobile: false,
          deviceScaleFactor: options?.deviceScaleFactor ?? 2,
        },
        sessionId
      ),
      connection.send(
        "Emulation.setDefaultBackgroundColorOverride",
        { color: { r: 255, g: 255, b: 255, a: 1 } },
        sessionId
      ),
    ])

    const loadEvent = connection.waitForEvent("Page.loadEventFired", {
      sessionId,
      timeoutMs: options?.waitForReadyTimeoutMs ?? 70000,
    })

    await connection.send(
      "Page.navigate",
      {
        url: pathToFileURL(workspace.htmlPath).toString(),
      },
      sessionId
    )

    await loadEvent

    const startTime = Date.now()
    const maxWaitMs = options?.waitForReadyTimeoutMs ?? 70000
    let lastState: ScreenshotReadyState | null = null

    while (Date.now() - startTime < maxWaitMs) {
      const evaluateResult = await connection.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const root = document.documentElement
            const body = document.body
            return {
              ready: Boolean(window.__REPORT_READY__),
              error: typeof window.__REPORT_ERROR__ === "string" ? window.__REPORT_ERROR__ : null,
              scrollWidth: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, root?.clientWidth || 0),
              scrollHeight: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, root?.clientHeight || 0)
            }
          })()`,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId
      )

      const state = (evaluateResult.result as { value?: ScreenshotReadyState } | undefined)
        ?.value

      if (state) {
        lastState = state
      }

      if (state?.error) {
        throw new Error(state.error)
      }

      if (state?.ready) {
        await delay(1500)
        break
      }

      await delay(1000)
    }

    if (!lastState?.ready) {
      throw new Error(
        lastState?.error ||
        "O relatorio do Power BI nao terminou de renderizar a tempo para gerar o PDF"
      )
    }

    const metricsResult = await connection.send("Page.getLayoutMetrics", {}, sessionId)
    const contentSize = metricsResult.contentSize as
      | { width?: number; height?: number }
      | undefined
    const width = Math.ceil(
      Math.max(
        contentSize?.width ?? 0,
        lastState.scrollWidth || 0,
        options?.viewportWidth ?? 1600
      )
    )
    const height = Math.ceil(
      Math.max(
        contentSize?.height ?? 0,
        lastState.scrollHeight || 0,
        options?.viewportHeight ?? 1100
      )
    )

    const screenshotResult = await connection.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width,
          height,
          scale: 1,
        },
      },
      sessionId
    )

    const pngBase64 = String(screenshotResult.data ?? "")
    if (!pngBase64) {
      throw new Error("O navegador nao retornou a captura do relatorio")
    }

    await connection.send("Target.closeTarget", { targetId })
    return Buffer.from(pngBase64, "base64")
  } finally {
    connection?.close()
    if (child) {
      await closeChromeProcess(child)
    }
    await cleanupBrowserWorkspace(workspace)
  }
}

export async function renderHtmlToPdf(
  html: string,
  options?: {
    timeoutMs?: number
    virtualTimeBudgetMs?: number
  }
) {
  const workspace = await createBrowserWorkspace("si-report-pdf-", html)
  const pdfPath = path.join(workspace.workingDir, "report.pdf")

  try {
    const browserExecutable = await resolvePdfBrowserExecutable()

    await runProcess(
      browserExecutable,
      [
        ...getCommonBrowserArgs(workspace.profilePath),
        "--print-to-pdf-no-header",
        `--virtual-time-budget=${options?.virtualTimeBudgetMs ?? 30000}`,
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(workspace.htmlPath).toString(),
      ],
      options?.timeoutMs ?? 60000
    )

    const pdf = await fs.readFile(pdfPath)
    if (!pdf.length) {
      throw new Error("O navegador gerou um PDF vazio")
    }

    return pdf
  } finally {
    await cleanupBrowserWorkspace(workspace)
  }
}

export async function renderHtmlScreenshotToPdf(
  html: string,
  options?: {
    screenshotTimeoutMs?: number
    waitForReadyTimeoutMs?: number
    viewportWidth?: number
    viewportHeight?: number
    deviceScaleFactor?: number
    pdfTimeoutMs?: number
    pageWidthMm?: number
    pageHeightMm?: number
    pageMarginMm?: number
  }
) {
  const screenshot = await renderHtmlToPng(html, {
    timeoutMs: options?.screenshotTimeoutMs ?? 40000,
    waitForReadyTimeoutMs: options?.waitForReadyTimeoutMs ?? 70000,
    viewportWidth: options?.viewportWidth ?? 3200,
    viewportHeight: options?.viewportHeight ?? 2400,
    deviceScaleFactor: options?.deviceScaleFactor ?? 2,
  })

  const pageWidthMm = options?.pageWidthMm ?? 594
  const pageHeightMm = options?.pageHeightMm ?? 420
  const pageMarginMm = options?.pageMarginMm ?? 2
  const { width: imageWidthPx, height: imageHeightPx } = parsePngDimensions(
    screenshot
  )
  const pageWidthPx = millimetersToCssPixels(pageWidthMm)
  const pageHeightPx = millimetersToCssPixels(pageHeightMm)
  const pageMarginPx = millimetersToCssPixels(pageMarginMm)
  const contentWidthPx = pageWidthPx - pageMarginPx * 2
  const contentHeightPx = pageHeightPx - pageMarginPx * 2

  if (contentWidthPx <= 0 || contentHeightPx <= 0) {
    throw new Error("O tamanho configurado para a pagina do PDF e invalido")
  }

  const widthScale = contentWidthPx / imageWidthPx
  const heightScale = contentHeightPx / imageHeightPx
  const imageScale = Math.max(0.01, Math.min(widthScale, heightScale))

  const renderedImageWidthPx = Math.max(
    1,
    Math.round(imageWidthPx * imageScale)
  )

  const renderedImageHeightPx = Math.max(
    1,
    Math.round(imageHeightPx * imageScale)
  )

  const resolvedPageHeightMm = pageHeightMm
  const resolvedPageHeightPx = millimetersToCssPixels(resolvedPageHeightMm)
  const resolvedContentHeightPx = Math.max(
    1,
    resolvedPageHeightPx - pageMarginPx * 2
  )

  const imageHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page {
      size: ${pageWidthMm}mm ${resolvedPageHeightMm}mm;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background: #ffffff;
      overflow: hidden;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .slice {
      width: ${contentWidthPx}px;
      height: ${resolvedContentHeightPx}px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    .pdf-page {
      width: ${pageWidthPx}px;
      height: ${resolvedPageHeightPx}px;
      padding: ${pageMarginPx}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      overflow: hidden;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    img {
      display: block;
      width: ${renderedImageWidthPx}px;
      height: ${renderedImageHeightPx}px;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      image-rendering: auto;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <section class="pdf-page">
    <img src="data:image/png;base64,${screenshot.toString("base64")}" alt="Relatorio Power BI" />
  </section>
</body>
</html>`

  return renderHtmlToPdf(imageHtml, {
    timeoutMs: options?.pdfTimeoutMs ?? 60000,
    virtualTimeBudgetMs: 3000,
  })
}
