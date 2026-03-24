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
  reportPending?: boolean
  reportReady?: boolean
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

type SegmentMetadata = {
  width: number
  height: number
  scrollTop: number
  viewportHeight: number
}

type ClipBox = {
  x: number
  y: number
  width: number
  height: number
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
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
      const raw =
        typeof event.data === "string" ? event.data : event.data.toString()
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
      ? this.sessions.get(sessionId) ??
        new Map<string, Array<(params: Record<string, unknown>) => void>>()
      : this.rootListeners

    if (sessionId && !this.sessions.has(sessionId)) {
      this.sessions.set(
        sessionId,
        store as Map<string, Array<(params: Record<string, unknown>) => void>>
      )
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
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
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

async function openHtmlInNewPage(client: CdpClient, htmlUrl: string) {
  const targetResult = await client.send("Target.createTarget", {
    url: "about:blank",
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
  const maxWaitMs = Math.max(1000, Math.min(virtualTimeBudgetMs, 45000))
  const pollIntervalMs = 500
  const startedAt = Date.now()
  let latestState: ScreenshotReadyState = {
    ready: false,
    error: null,
    scrollWidth: 0,
    scrollHeight: 0,
  }

  while (Date.now() - startedAt <= maxWaitMs) {
    const state = await client.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const readyState = document.readyState;
          const body = document.body;
          const documentElement = document.documentElement;
          const reportPending = window.__REPORT_PENDING__ === true;
          const reportReady = Boolean(window.__REPORT_READY__);
          const reportError =
            typeof window.__REPORT_ERROR__ === "string" &&
            window.__REPORT_ERROR__.trim()
              ? window.__REPORT_ERROR__.trim()
              : null;

          return {
            ready:
              (readyState === "complete" || readyState === "interactive") &&
              (!reportPending || reportReady || Boolean(reportError)),
            error: reportError,
            reportPending,
            reportReady,
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

    latestState =
      (state.result as { value?: ScreenshotReadyState } | undefined)?.value ?? {
        ready: false,
        error: "Nao foi possivel ler o DOM do relatorio",
        scrollWidth: 0,
        scrollHeight: 0,
      }

    if (latestState.ready) {
      return latestState
    }

    await delay(pollIntervalMs)
  }

  return latestState
}

async function prepareScrollableSegments(
  client: CdpClient,
  sessionId: string
) {
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const elements = Array.from(document.querySelectorAll("*"))
          .filter((el) => el instanceof HTMLElement)

        const candidates = elements
          .map((el) => {
            const style = window.getComputedStyle(el)
            const canScrollY =
              (style.overflowY === "auto" ||
                style.overflowY === "scroll" ||
                style.overflow === "auto" ||
                style.overflow === "scroll") &&
              el.scrollHeight > el.clientHeight + 20

            if (!canScrollY) return null

            const rect = el.getBoundingClientRect()
            const overflowHeight = el.scrollHeight - el.clientHeight

            return {
              canScrollY,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              overflowHeight,
              rectTop: rect.top,
              rectLeft: rect.left,
              rectWidth: rect.width,
              rectHeight: rect.height,
              area: rect.width * rect.height,
              textLength: (el.innerText || "").length,
            }
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.overflowHeight !== a.overflowHeight) {
              return b.overflowHeight - a.overflowHeight
            }
            if (b.rectHeight !== a.rectHeight) {
              return b.rectHeight - a.rectHeight
            }
            return b.area - a.area
          })

        const target = candidates[0] || null

        if (!target) {
          return {
            mode: "single",
            viewportHeight: window.innerHeight,
            totalHeight: Math.max(
              document.body?.scrollHeight || 0,
              document.documentElement?.scrollHeight || 0
            ),
          }
        }

        const positions = []
        const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight)
        const step = Math.max(120, Math.floor(target.clientHeight * 0.55))

        for (let y = 0; y <= maxScrollTop; y += step) {
          positions.push(Math.min(y, maxScrollTop))
        }

        if (!positions.length || positions[positions.length - 1] !== maxScrollTop) {
          positions.push(maxScrollTop)
        }

        return {
          mode: "segmented",
          viewportHeight: target.clientHeight,
          totalHeight: target.scrollHeight,
          positions: Array.from(new Set(positions)),
          clip: {
            x: Math.max(0, Math.floor(target.rectLeft)),
            y: Math.max(0, Math.floor(target.rectTop)),
            width: Math.max(1, Math.floor(target.rectWidth)),
            height: Math.max(1, Math.floor(target.rectHeight)),
          },
        }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )

  return (result.result as { value?: Record<string, unknown> } | undefined)?.value ?? null
}

async function scrollSegmentTarget(
  client: CdpClient,
  sessionId: string,
  scrollTop: number
) {
  await client.send(
    "Runtime.evaluate",
    {
      expression: `async (() => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

        const elements = Array.from(document.querySelectorAll("*"))
          .filter((el) => el instanceof HTMLElement)

        const candidates = elements
          .map((el) => {
            const style = window.getComputedStyle(el)
            const canScrollY =
              (style.overflowY === "auto" ||
                style.overflowY === "scroll" ||
                style.overflow === "auto" ||
                style.overflow === "scroll") &&
              el.scrollHeight > el.clientHeight + 20

            if (!canScrollY) return null

            const rect = el.getBoundingClientRect()
            const overflowHeight = el.scrollHeight - el.clientHeight

            return {
              el,
              overflowHeight,
              rectHeight: rect.height,
              area: rect.width * rect.height,
            }
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.overflowHeight !== a.overflowHeight) {
              return b.overflowHeight - a.overflowHeight
            }
            if (b.rectHeight !== a.rectHeight) {
              return b.rectHeight - a.rectHeight
            }
            return b.area - a.area
          })

        const target = candidates[0]?.el || null
        if (!target) return false

        target.scrollTop = ${Math.max(0, scrollTop)}
        target.dispatchEvent(new Event("scroll", { bubbles: true }))
        await sleep(1200)
        return true
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )
}

async function restoreSegmentTarget(
  client: CdpClient,
  sessionId: string,
  scrollTop: number
) {
  await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const elements = Array.from(document.querySelectorAll("*"))
          .filter((el) => el instanceof HTMLElement)

        const candidates = elements
          .map((el) => {
            const style = window.getComputedStyle(el)
            const canScrollY =
              (style.overflowY === "auto" ||
                style.overflowY === "scroll" ||
                style.overflow === "auto" ||
                style.overflow === "scroll") &&
              el.scrollHeight > el.clientHeight + 20

            if (!canScrollY) return null

            const rect = el.getBoundingClientRect()
            const overflowHeight = el.scrollHeight - el.clientHeight

            return {
              el,
              overflowHeight,
              rectHeight: rect.height,
              area: rect.width * rect.height,
            }
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.overflowHeight !== a.overflowHeight) {
              return b.overflowHeight - a.overflowHeight
            }
            if (b.rectHeight !== a.rectHeight) {
              return b.rectHeight - a.rectHeight
            }
            return b.area - a.area
          })

        const target = candidates[0]?.el || null
        if (!target) return false

        target.scrollTop = ${Math.max(0, scrollTop)}
        return true
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )
}

async function captureViewportPng(
  client: CdpClient,
  sessionId: string,
  width: number,
  height: number,
  deviceScaleFactor: number,
  screenshotScale: number,
  clip?: ClipBox
) {
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
      scale: screenshotScale,
    },
    { sessionId }
  )

  await delay(700)

  const screenshot = await client.send(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: clip
        ? {
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            scale: 1,
          }
        : {
            x: 0,
            y: 0,
            width,
            height,
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

    if (lastState.error) {
      throw new Error(lastState.error)
    }

    if (!lastState.ready) {
      throw new Error(
        lastState.error || "O HTML do relatorio nao ficou pronto para gerar o PDF"
      )
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

    if (lastState.error) {
      throw new Error(lastState.error)
    }

    if (!lastState.ready) {
      throw new Error(
        lastState.error || "O HTML do relatorio nao ficou pronto para captura"
      )
    }

    if (options?.forceExpandScrollable === false) {
      const layoutMetrics = await client.send("Page.getLayoutMetrics", {}, { sessionId })
      const contentSize = layoutMetrics.contentSize as
        | { width?: number; height?: number }
        | undefined

      const fullWidth = Math.max(
        captureWidth,
        Math.ceil(contentSize?.width ?? lastState.scrollWidth ?? captureWidth)
      )
      const fullHeight = Math.max(
        captureHeight,
        Math.ceil(contentSize?.height ?? lastState.scrollHeight ?? captureHeight)
      )
      const safeFullHeight = Math.min(fullHeight, 30000)

      await client.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: fullWidth,
          height: safeFullHeight,
          deviceScaleFactor,
          mobile: false,
          scale: screenshotScale,
        },
        { sessionId }
      )

      await delay(700)

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
            height: safeFullHeight,
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
    }

    const segmentation = await prepareScrollableSegments(client, sessionId)

    if (!segmentation || segmentation.mode !== "segmented") {
      const layoutMetrics = await client.send("Page.getLayoutMetrics", {}, { sessionId })
      const contentSize = layoutMetrics.contentSize as
        | { width?: number; height?: number }
        | undefined

      const fullWidth = Math.max(
        captureWidth,
        Math.ceil(contentSize?.width ?? lastState.scrollWidth ?? captureWidth)
      )
      const fullHeight = Math.max(
        captureHeight,
        Math.ceil(contentSize?.height ?? lastState.scrollHeight ?? captureHeight)
      )
      const safeFullHeight = Math.min(fullHeight, 30000)

      await client.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: fullWidth,
          height: safeFullHeight,
          deviceScaleFactor,
          mobile: false,
          scale: screenshotScale,
        },
        { sessionId }
      )

      await delay(700)

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
            height: safeFullHeight,
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
    }

    const positions = Array.isArray(segmentation.positions)
      ? (segmentation.positions as number[])
      : []

    const viewportHeight = Number(segmentation.viewportHeight || captureHeight)
    const originalScrollTop = 0
    const clip = segmentation.clip as ClipBox | undefined

    const segmentBuffers: Buffer[] = []

    for (const scrollTop of positions) {
      await scrollSegmentTarget(client, sessionId, scrollTop)

      const png = await captureViewportPng(
        client,
        sessionId,
        captureWidth,
        captureHeight,
        deviceScaleFactor,
        screenshotScale,
        clip
      )

      segmentBuffers.push(png)
    }

    await restoreSegmentTarget(client, sessionId, originalScrollTop)

    const metadata: SegmentMetadata[] = segmentBuffers.map((buffer, index) => {
      const dimensions = parsePngDimensions(buffer)
      return {
        width: dimensions.width,
        height: dimensions.height,
        scrollTop: positions[index] ?? 0,
        viewportHeight,
      }
    })

    const payload = {
      segments: segmentBuffers.map((buffer) => buffer.toString("base64")),
      metadata,
    }

    return Buffer.from(JSON.stringify(payload), "utf-8")
  })
}

export async function renderHtmlScreenshotToPdf(
  html: string,
  options?: ScreenshotToPdfOptions
) {
  const screenshotPayload = await renderHtmlToPng(html, {
    timeoutMs: options?.pngTimeoutMs ?? 60000,
    captureWidth: options?.captureWidth,
    captureHeight: options?.captureHeight,
    deviceScaleFactor: options?.deviceScaleFactor,
    screenshotScale: options?.screenshotScale,
    forceExpandScrollable: true,
  })

  let segments: string[] = []
  let metadata: SegmentMetadata[] = []

  try {
    const parsed = JSON.parse(screenshotPayload.toString("utf-8")) as {
      segments?: string[]
      metadata?: SegmentMetadata[]
    }

    segments = Array.isArray(parsed.segments) ? parsed.segments : []
    metadata = Array.isArray(parsed.metadata) ? parsed.metadata : []
  } catch {
    segments = [screenshotPayload.toString("base64")]
    const dimensions = parsePngDimensions(screenshotPayload)
    metadata = [
      {
        width: dimensions.width,
        height: dimensions.height,
        scrollTop: 0,
        viewportHeight: dimensions.height,
      },
    ]
  }

  if (!segments.length || !metadata.length) {
    throw new Error("Nenhuma captura valida foi gerada para o relatorio")
  }

  const pageWidthMm = options?.pageWidthMm ?? 420
  const pageHeightMm = options?.pageHeightMm ?? 594
  const pageMarginMm = options?.pageMarginMm ?? 8

  const pageWidthPx = millimetersToCssPixels(pageWidthMm)
  const pageHeightPx = millimetersToCssPixels(pageHeightMm)
  const pageMarginPx = millimetersToCssPixels(pageMarginMm)
  const contentWidthPx = Math.max(1, pageWidthPx - pageMarginPx * 2)
  const contentHeightPx = Math.max(1, pageHeightPx - pageMarginPx * 2)

  const pagesHtml = segments
    .map((segmentBase64, index) => {
      const info = metadata[index]
      const renderedImageWidthPx = contentWidthPx
      const renderedImageHeightPx = Math.max(
        1,
        Math.round((info.height * renderedImageWidthPx) / info.width)
      )

      const localSlices = Math.max(
        1,
        Math.ceil(renderedImageHeightPx / contentHeightPx)
      )

      return Array.from({ length: localSlices }, (_, sliceIndex) => {
        const offsetY = sliceIndex * contentHeightPx

        return `
          <section class="pdf-page">
            <div class="slice">
              <img
                src="data:image/png;base64,${escapeHtmlAttribute(segmentBase64)}"
                alt="Relatorio Power BI - segmento ${index + 1}"
                style="transform: translateY(-${offsetY}px);"
              />
            </div>
          </section>
        `
      }).join("")
    })
    .join("")

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
      width: ${contentWidthPx}px;
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
