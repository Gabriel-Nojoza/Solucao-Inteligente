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
  requiresExplicitReady: boolean
  explicitReady: boolean
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
  scrollableSegmentationMode?:
  | "segments-only"
  | "overview-and-segments"
  | "full-page-scroll-steps"
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
  forceExpandScrollable?: boolean
  scrollableSegmentationMode?:
  | "segments-only"
  | "overview-and-segments"
  | "full-page-scroll-steps"
  autoGrowPageHeight?: boolean
  maxPageHeightMm?: number
}

type CdpSendOptions = {
  sessionId?: string
}

type SegmentMetadata = {
  width: number
  height: number
  scrollTop: number
  viewportHeight: number
  totalHeight?: number
}

type ScreenshotDocument = {
  segments: string[]
  metadata: SegmentMetadata[]
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
const MAX_CAPTURE_WIDTH = 8192
const MAX_CAPTURE_HEIGHT = 60000
const MAX_DEVICE_SCALE_FACTOR = 2
const MAX_SCREENSHOT_SCALE = 1.5

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseEnvNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clampCaptureDimension(value: number, max: number) {
  return Math.max(1, Math.min(Math.round(value), max))
}

function clampScale(value: number, max: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }

  return Math.min(value, max)
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

function cssPixelsToMillimeters(value: number) {
  return (value * MILLIMETERS_PER_INCH) / CSS_PIXELS_PER_INCH
}

function parseScreenshotDocument(screenshotPayload: Buffer): ScreenshotDocument {
  try {
    const parsed = JSON.parse(screenshotPayload.toString("utf-8")) as {
      segments?: string[]
      metadata?: SegmentMetadata[]
    }

    const segments = Array.isArray(parsed.segments) ? parsed.segments : []
    const metadata = Array.isArray(parsed.metadata) ? parsed.metadata : []

    if (segments.length > 0 && metadata.length > 0) {
      return { segments, metadata }
    }
  } catch {
    // Quando nao vier JSON segmentado, tratamos como uma imagem PNG unica.
  }

  const dimensions = parsePngDimensions(screenshotPayload)
  return {
    segments: [screenshotPayload.toString("base64")],
    metadata: [
      {
        width: dimensions.width,
        height: dimensions.height,
        scrollTop: 0,
        viewportHeight: dimensions.height,
      },
    ],
  }
}

export async function renderScreenshotPayloadsToPdf(
  screenshotPayloads: Buffer[],
  options?: Pick<
    ScreenshotToPdfOptions,
    | "pdfTimeoutMs"
    | "pageWidthMm"
    | "pageHeightMm"
    | "pageMarginMm"
    | "autoGrowPageHeight"
    | "maxPageHeightMm"
  >
) {
  const documents = screenshotPayloads.map((payload) => parseScreenshotDocument(payload))

  const pages = documents.flatMap((document) => {
    const rawPages = document.segments.map((segment, index) => ({
      segmentBase64: segment,
      info: document.metadata[index],
    }))

    return rawPages.map((page, index) => {
      const previous = index > 0 ? rawPages[index - 1] : null
      const scale = page.info.viewportHeight > 0 ? page.info.height / page.info.viewportHeight : 1
      const overlapScrollPx = previous
        ? Math.max(
          0,
          previous.info.scrollTop + previous.info.viewportHeight - page.info.scrollTop
        )
        : 0

      // Remove the rows that were already present in the previous scroll segment.
      const cropTopPx = Math.min(
        Math.max(0, page.info.height - 1),
        Math.round(overlapScrollPx * scale)
      )

      return {
        ...page,
        cropTopPx,
        visibleHeightPx: Math.max(
          1,
          Math.min(
            page.info.height - cropTopPx,
            Math.round(
              Math.max(
                1,
                Math.min(
                  page.info.viewportHeight,
                  (page.info.totalHeight ?? page.info.viewportHeight) - page.info.scrollTop
                ) - overlapScrollPx
              ) * scale
            )
          )
        ),
      }
    })
  })

  if (
    pages.length === 0 ||
    pages.some((page) => !page.info || !page.info.width || !page.info.height)
  ) {
    throw new Error("Nenhuma captura valida foi gerada para o relatorio")
  }

  const pageWidthMm = options?.pageWidthMm ?? 420
  let pageHeightMm = options?.pageHeightMm ?? 594
  const pageMarginMm = options?.pageMarginMm ?? 4
  const autoGrowPageHeight = options?.autoGrowPageHeight ?? false

  const pageWidthPx = millimetersToCssPixels(pageWidthMm)
  const pageMarginPx = millimetersToCssPixels(pageMarginMm)
  const contentWidthPx = Math.max(1, pageWidthPx - pageMarginPx * 2)

  const requiredContentHeightPx = pages.reduce((totalHeight, page) => {
    const renderedImageHeightPx = Math.max(
      1,
      Math.round((page.visibleHeightPx * contentWidthPx) / page.info.width)
    )

    return totalHeight + renderedImageHeightPx
  }, 0)

  const requiredPageHeightPx = requiredContentHeightPx + pageMarginPx * 2
  const requiredPageHeightMm =
    (requiredPageHeightPx * MILLIMETERS_PER_INCH) / CSS_PIXELS_PER_INCH
  const maxPageHeightMm = options?.maxPageHeightMm ?? 14400
  const safeSinglePageHeightMm = Math.min(maxPageHeightMm, 1200)
  const canUseSingleTallPage =
    autoGrowPageHeight && requiredPageHeightMm <= safeSinglePageHeightMm

  pageHeightMm = canUseSingleTallPage
    ? Math.min(maxPageHeightMm, Math.ceil(requiredPageHeightMm))
    : Math.min(maxPageHeightMm, Math.max(1, pageHeightMm))

  const pageHeightPx = millimetersToCssPixels(pageHeightMm)
  const pageContentHeightPx = Math.max(1, pageHeightPx - pageMarginPx * 2)

  const pageSlices = pages.map(({ segmentBase64, info, cropTopPx, visibleHeightPx }, index) => {
    const renderedImageWidthPx = contentWidthPx
    const renderedCropTopPx = Math.max(
      0,
      Math.round((cropTopPx * renderedImageWidthPx) / info.width)
    )
    const renderedVisibleHeightPx = Math.max(
      1,
      Math.round((visibleHeightPx * renderedImageWidthPx) / info.width)
    )

    return {
      segmentBase64,
      segmentIndex: index,
      renderedCropTopPx,
      renderedVisibleHeightPx,
    }
  })

  const paginatedSlices = canUseSingleTallPage
    ? [
        {
          pageHeightPx,
          slices: pageSlices,
        },
      ]
    : (() => {
        const laidOutPages: Array<{
          pageHeightPx: number
          slices: Array<{
            segmentBase64: string
            segmentIndex: number
            renderedCropTopPx: number
            renderedVisibleHeightPx: number
          }>
        }> = []

        let currentSlices: Array<{
          segmentBase64: string
          segmentIndex: number
          renderedCropTopPx: number
          renderedVisibleHeightPx: number
        }> = []
        let usedPageContentHeightPx = 0

        const flushPage = () => {
          if (currentSlices.length === 0) {
            return
          }

          laidOutPages.push({
            pageHeightPx,
            slices: currentSlices,
          })
          currentSlices = []
          usedPageContentHeightPx = 0
        }

        for (const slice of pageSlices) {
          let remainingHeightPx = slice.renderedVisibleHeightPx
          let currentCropTopPx = slice.renderedCropTopPx

          while (remainingHeightPx > 0) {
            const remainingPageHeightPx = Math.max(
              1,
              pageContentHeightPx - usedPageContentHeightPx
            )
            const chunkHeightPx = Math.min(remainingHeightPx, remainingPageHeightPx)

            currentSlices.push({
              segmentBase64: slice.segmentBase64,
              segmentIndex: slice.segmentIndex,
              renderedCropTopPx: currentCropTopPx,
              renderedVisibleHeightPx: chunkHeightPx,
            })

            usedPageContentHeightPx += chunkHeightPx
            remainingHeightPx -= chunkHeightPx
            currentCropTopPx += chunkHeightPx

            if (usedPageContentHeightPx >= pageContentHeightPx - 1) {
              flushPage()
            }
          }
        }

        flushPage()

        return laidOutPages.length > 0
          ? laidOutPages
          : [{ pageHeightPx, slices: pageSlices }]
      })()

  // We write one single @page for the whole content if we want a single page,
  // or we just define a default page size that fits the max height.
  const pageCss = `
    @page {
      size: ${pageWidthMm}mm ${pageHeightMm}mm;
      margin: 0;
    }
  `

  const pagesHtml = paginatedSlices
    .map(
      (pageLayout) => `
        <section
          class="pdf-page"
          style="width: ${pageWidthPx}px; min-height: ${pageLayout.pageHeightPx}px; padding: ${pageMarginPx}px;"
        >
          ${pageLayout.slices
            .map(
              (slice) => `
                <div class="slice" style="height: ${slice.renderedVisibleHeightPx}px;">
                  <img
                    src="data:image/png;base64,${escapeHtmlAttribute(slice.segmentBase64)}"
                    alt="Relatorio Power BI - segmento ${slice.segmentIndex + 1}"
                    style="transform: translateY(-${slice.renderedCropTopPx}px);"
                  />
                </div>
              `
            )
            .join("")}
        </section>
      `
    )
    .join("")

  const imageHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    ${pageCss}

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
      background: #ffffff;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: flex-start;
      break-after: page;
      page-break-after: always;
    }

    .pdf-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .slice {
      width: ${contentWidthPx}px;
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

async function openHtmlInNewPage(client: CdpClient, html: string) {
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

  const frameTreeResult = await client.send("Page.getFrameTree", {}, { sessionId })
  const frameId = String(
    (
      frameTreeResult.frameTree as
      | { frame?: { id?: string | null } | null }
      | undefined
    )?.frame?.id ?? ""
  )

  if (!frameId) {
    throw new Error("Nao foi possivel localizar o frame principal do navegador")
  }

  await client.send(
    "Page.setDocumentContent",
    {
      frameId,
      html,
    },
    { sessionId }
  )

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
  fn: (client: CdpClient, sessionId: string) => Promise<T>
) {
  const executablePath = await resolvePdfBrowserExecutable()
  const workspace = await createBrowserWorkspace("browser-pdf-", html)

  let chrome: ChromeLaunchResult | null = null
  let client: CdpClient | null = null

  try {
    chrome = await launchChromeWithDebugging(
      executablePath,
      workspace.profilePath,
      timeoutMs
    )

    client = await connectCdp(chrome.websocketUrl)
    const page = await openHtmlInNewPage(client, html)

    return await fn(client, page.sessionId)
  } finally {
    if (client) {
      await client.close().catch(() => { })
    }

    if (chrome) {
      await closeChrome(chrome.child).catch(() => { })
    }

    await cleanupBrowserWorkspace(workspace).catch(() => { })
  }
}

async function waitForDomReady(
  client: CdpClient,
  sessionId: string,
  virtualTimeBudgetMs: number
) {
  const timeoutAt = Date.now() + Math.max(1500, virtualTimeBudgetMs)
  let lastState: ScreenshotReadyState | null = null

  while (Date.now() <= timeoutAt) {
    const state = await client.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const readyState = document.readyState;
          const body = document.body;
          const documentElement = document.documentElement;
          const captureState = window.__REPORT_CAPTURE__ === true;
          const explicitReadyRaw = window.__REPORT_READY__;
          const explicitErrorRaw = window.__REPORT_ERROR__;
          const explicitReady =
            explicitReadyRaw === true ||
            (typeof explicitReadyRaw === 'string' && explicitReadyRaw.trim().length > 0);
          const explicitError =
            typeof explicitErrorRaw === 'string' && explicitErrorRaw.trim().length > 0
              ? explicitErrorRaw.trim()
              : null;
          const domReady = readyState === 'complete' || readyState === 'interactive';

          return {
            ready: captureState ? domReady && explicitReady && !explicitError : domReady,
            error: explicitError,
            requiresExplicitReady: captureState,
            explicitReady,
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

    const resultValue = (
      state.result as { value?: ScreenshotReadyState } | undefined
    )?.value

    lastState =
      resultValue ?? {
        ready: false,
        error: "Nao foi possivel ler o DOM do relatorio",
        scrollWidth: 0,
        scrollHeight: 0,
        requiresExplicitReady: false,
        explicitReady: false,
      }

    if (lastState.error || lastState.ready) {
      return lastState
    }

    await delay(500)
  }

  if (lastState?.requiresExplicitReady && !lastState.explicitReady) {
    return {
      ...lastState,
      ready: false,
      error:
        "O relatorio do Power BI nao terminou de renderizar antes do tempo limite da captura.",
    }
  }

  return (
    lastState ?? {
      ready: false,
      error: "Nao foi possivel ler o DOM do relatorio",
      scrollWidth: 0,
      scrollHeight: 0,
      requiresExplicitReady: false,
      explicitReady: false,
    }
  )
}

async function prepareScrollableSegments(
  client: CdpClient,
  sessionId: string
) {
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const previousTarget = document.querySelector('[data-report-scroll-target="1"]')
        if (previousTarget instanceof HTMLElement) {
          previousTarget.removeAttribute("data-report-scroll-target")
        }

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
            const textLength = (el.innerText || "").replace(/\s+/g, " ").trim().length

            if (rect.width < 260 || rect.height < 180 || textLength < 24) {
              return null
            }

            return {
              el,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              overflowHeight,
              rectTop: rect.top,
              rectLeft: rect.left,
              rectRight: rect.right,
              rectBottom: rect.bottom,
              rectWidth: rect.width,
              rectHeight: rect.height,
              area: rect.width * rect.height,
              textLength,
              textDensity: textLength / Math.max(rect.width * rect.height, 1),
              overflowRatio: overflowHeight / Math.max(el.clientHeight, 1),
            }
          })
          .filter(Boolean)

        const refinedCandidates = candidates.filter((candidate) => {
          return !candidates.some((other) => {
            if (other === candidate) return false
            if (!(candidate.el instanceof HTMLElement) || !(other.el instanceof HTMLElement)) {
              return false
            }
            if (!candidate.el.contains(other.el)) return false

            const comparableSize =
              other.rectWidth >= candidate.rectWidth * 0.52 &&
              other.rectHeight >= candidate.rectHeight * 0.3
            const keepsMostContent =
              other.textLength >= Math.max(32, candidate.textLength * 0.65)
            const hasComparableScroll =
              other.overflowHeight >= Math.max(120, candidate.overflowHeight * 0.3)
            const isMeaningfullyTighter =
              other.area <= candidate.area * 0.82 ||
              other.textDensity >= candidate.textDensity * 1.2

            return (
              comparableSize &&
              keepsMostContent &&
              hasComparableScroll &&
              isMeaningfullyTighter
            )
          })
        })

        const rankedCandidates = (refinedCandidates.length ? refinedCandidates : candidates).sort(
          (a, b) => {
            if (b.overflowRatio !== a.overflowRatio) {
              return b.overflowRatio - a.overflowRatio
            }
            if (b.textDensity !== a.textDensity) {
              return b.textDensity - a.textDensity
            }
            if (b.overflowHeight !== a.overflowHeight) {
              return b.overflowHeight - a.overflowHeight
            }
            if (a.area !== b.area) {
              return a.area - b.area
            }
            return b.textLength - a.textLength
          }
        )

        const target = rankedCandidates[0] || null

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

        target.el.setAttribute("data-report-scroll-target", "1")

        const baseRect = target.el.getBoundingClientRect()
        const clipPaddingX = 8
        const clipPaddingTop = 8
        const clipPaddingBottom = 12
        const clipLeft = Math.max(0, Math.floor(baseRect.left - clipPaddingX))
        const clipTop = Math.max(0, Math.floor(baseRect.top - clipPaddingTop))
        const clipRight = Math.min(
          window.innerWidth,
          Math.ceil(baseRect.right + clipPaddingX)
        )
        const clipBottom = Math.min(
          window.innerHeight,
          Math.ceil(baseRect.bottom + clipPaddingBottom)
        )

        const positions = []
        const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight)
        const visibleRatio = target.clientHeight / Math.max(target.scrollHeight, 1)
        const stepFactor =
          visibleRatio <= 0.22
            ? 0.08
            : visibleRatio <= 0.35
              ? 0.12
              : 0.16
        const step = Math.max(20, Math.floor(target.clientHeight * stepFactor))

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
            x: clipLeft,
            y: clipTop,
            width: Math.max(1, clipRight - clipLeft),
            height: Math.max(1, clipBottom - clipTop),
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

        const target = document.querySelector('[data-report-scroll-target="1"]')
        if (!target) return false

        target.scrollTop = ${Math.max(0, scrollTop)}
        target.dispatchEvent(new Event("scroll", { bubbles: true }))
        await sleep(4200)
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
        const target = document.querySelector('[data-report-scroll-target="1"]')
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

async function measureSegmentClip(
  client: CdpClient,
  sessionId: string,
  fallbackClip?: ClipBox
) {
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const target = document.querySelector('[data-report-scroll-target="1"]')
        if (!(target instanceof HTMLElement)) return null

        const baseRect = target.getBoundingClientRect()
        const minWidth = Math.max(24, baseRect.width * 0.04)
        const minHeight = 10
        let contentTop = baseRect.bottom
        let contentBottom = baseRect.top
        let foundMeaningfulContent = false

        const nodes = Array.from(target.querySelectorAll("*"))
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue

          const rect = node.getBoundingClientRect()
          if (rect.width < minWidth || rect.height < minHeight) continue

          const isVisible =
            rect.bottom > baseRect.top + 6 &&
            rect.top < baseRect.bottom - 6 &&
            rect.right > baseRect.left + 6 &&
            rect.left < baseRect.right - 6

          if (!isVisible) continue

          const textLength = (node.innerText || "").replace(/\\s+/g, " ").trim().length
          const hasGraphic =
            node.querySelector("svg, canvas, img") instanceof Element ||
            node.tagName === "SVG" ||
            node.tagName === "CANVAS" ||
            node.tagName === "IMG"

          if (textLength === 0 && !hasGraphic) continue

          foundMeaningfulContent = true
          contentTop = Math.min(contentTop, Math.max(rect.top, baseRect.top))
          contentBottom = Math.max(contentBottom, Math.min(rect.bottom, baseRect.bottom))
        }

        if (!foundMeaningfulContent) {
          contentTop = baseRect.top
          contentBottom = baseRect.bottom
        }

        const clipLeft = Math.max(0, Math.floor(baseRect.left - 8))
        const clipTop = Math.max(0, Math.floor(contentTop - 8))
        const clipRight = Math.min(window.innerWidth, Math.ceil(baseRect.right + 8))
        const clipBottom = Math.min(
          window.innerHeight,
          Math.max(clipTop + 1, Math.ceil(contentBottom + 12))
        )

        return {
          x: clipLeft,
          y: clipTop,
          width: Math.max(1, clipRight - clipLeft),
          height: Math.max(1, clipBottom - clipTop),
        }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    },
    { sessionId }
  )

  const measured = (result.result as { value?: ClipBox | null } | undefined)?.value ?? null
  if (!measured || !measured.width || !measured.height) {
    return fallbackClip
  }

  return measured
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
  const domReadyTimeoutMs = Math.max(4000, Math.min(timeoutMs, 240000))
  const captureWidth = clampCaptureDimension(
    options?.captureWidth ?? parseEnvNumber("REPORT_PDF_CAPTURE_WIDTH", 2560),
    MAX_CAPTURE_WIDTH
  )
  const captureHeight = clampCaptureDimension(
    options?.captureHeight ?? parseEnvNumber("REPORT_PDF_CAPTURE_HEIGHT", 1707),
    MAX_CAPTURE_HEIGHT
  )
  const deviceScaleFactor = clampScale(
    options?.deviceScaleFactor ??
    parseEnvNumber("REPORT_PDF_DEVICE_SCALE_FACTOR", 2),
    MAX_DEVICE_SCALE_FACTOR
  )
  const screenshotScale = clampScale(
    options?.screenshotScale ??
    parseEnvNumber("REPORT_PDF_SCREENSHOT_SCALE", 1),
    MAX_SCREENSHOT_SCALE
  )
  const scrollableSegmentationMode =
    options?.scrollableSegmentationMode ?? "segments-only"

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

    const lastState = await waitForDomReady(client, sessionId, domReadyTimeoutMs)

    if (!lastState.ready) {
      throw new Error(
        lastState.error || "O HTML do relatorio nao ficou pronto para captura"
      )
    }

    if (options?.forceExpandScrollable === false) {
      // Consulta a altura real do elemento .frame (definida pelo syncFrameToActivePage do Power BI)
      // em vez de usar contentSize que pode incluir overflow de iframes ou area de min-height.
      const frameHeightResult = await client.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const frame = document.querySelector('.frame');
            if (frame) {
              return { frameHeight: frame.offsetHeight, frameWidth: frame.offsetWidth };
            }
            return { frameHeight: 0, frameWidth: 0 };
          })()`,
          returnByValue: true,
        },
        { sessionId }
      )
      const frameSize = (frameHeightResult.result as { value?: { frameHeight?: number; frameWidth?: number } } | undefined)?.value

      const layoutMetrics = await client.send("Page.getLayoutMetrics", {}, { sessionId })
      const contentSize = layoutMetrics.contentSize as
        | { width?: number; height?: number }
        | undefined

      const fullWidth = Math.max(
        captureWidth,
        Math.ceil(contentSize?.width ?? lastState.scrollWidth ?? captureWidth)
      )
      // Usa a altura do elemento .frame (altura real do relatório Power BI),
      // ignorando min-height da página e overflow de iframes.
      const frameHeight = frameSize?.frameHeight && frameSize.frameHeight > 100 ? frameSize.frameHeight : 0
      const fullHeight = Math.max(
        920,
        frameHeight || Math.ceil(contentSize?.height ?? lastState.scrollHeight ?? captureHeight)
      )
      const safeFullHeight = Math.min(fullHeight, 60000)

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

      await delay(3000)

      // Captura com clip exato para a largura/altura do conteúdo real, evitando área em branco.
      const screenshotClip = {
        x: 0,
        y: 0,
        width: fullWidth,
        height: safeFullHeight,
        scale: 1,
      }

      const screenshot = await client.send(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: screenshotClip,
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
      // Tenta obter a altura real do .frame (definida pelo syncFrameToActivePage do Power BI)
      const frameHeightResultFallback = await client.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const frame = document.querySelector('.frame');
            if (frame) return { frameHeight: frame.offsetHeight, frameWidth: frame.offsetWidth };
            return { frameHeight: 0, frameWidth: 0 };
          })()`,
          returnByValue: true,
        },
        { sessionId }
      )
      const frameSizeFallback = (frameHeightResultFallback.result as { value?: { frameHeight?: number; frameWidth?: number } } | undefined)?.value

      const layoutMetrics = await client.send("Page.getLayoutMetrics", {}, { sessionId })
      const contentSize = layoutMetrics.contentSize as
        | { width?: number; height?: number }
        | undefined

      const fullWidth = Math.max(
        captureWidth,
        Math.ceil(contentSize?.width ?? lastState.scrollWidth ?? captureWidth)
      )
      const frameHeightFallback = frameSizeFallback?.frameHeight && frameSizeFallback.frameHeight > 100 ? frameSizeFallback.frameHeight : 0
      const fullHeight = Math.max(
        920,
        frameHeightFallback || Math.ceil(contentSize?.height ?? lastState.scrollHeight ?? captureHeight)
      )
      const safeFullHeight = Math.min(fullHeight, 60000)

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

      await delay(3000)

      const fallbackClip = {
        x: 0,
        y: 0,
        width: fullWidth,
        height: safeFullHeight,
        scale: 1,
      }

      const screenshot = await client.send(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: fallbackClip,
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
    const segmentMetadata: SegmentMetadata[] = []

    if (
      scrollableSegmentationMode === "overview-and-segments" ||
      scrollableSegmentationMode === "full-page-scroll-steps"
    ) {
      const overviewPng = await captureViewportPng(
        client,
        sessionId,
        captureWidth,
        captureHeight,
        deviceScaleFactor,
        screenshotScale
      )

      const overviewDimensions = parsePngDimensions(overviewPng)
      segmentBuffers.push(overviewPng)
      segmentMetadata.push({
        width: overviewDimensions.width,
        height: overviewDimensions.height,
        scrollTop: 0,
        viewportHeight: overviewDimensions.height,
        totalHeight: overviewDimensions.height,
      })
    }

    const scrollPositions =
      scrollableSegmentationMode === "overview-and-segments" ||
        scrollableSegmentationMode === "full-page-scroll-steps"
        ? positions.filter((scrollTop) => scrollTop > 0)
        : positions

    for (const scrollTop of scrollPositions) {
      await scrollSegmentTarget(client, sessionId, scrollTop)
      const dynamicClip =
        scrollableSegmentationMode === "full-page-scroll-steps"
          ? undefined
          : await measureSegmentClip(client, sessionId, clip)

      const png = await captureViewportPng(
        client,
        sessionId,
        captureWidth,
        captureHeight,
        deviceScaleFactor,
        screenshotScale,
        dynamicClip
      )

      segmentBuffers.push(png)

      const dimensions = parsePngDimensions(png)
      segmentMetadata.push({
        width: dimensions.width,
        height: dimensions.height,
        scrollTop,
        viewportHeight,
        totalHeight: Number(segmentation.totalHeight || viewportHeight),
      })
    }

    await restoreSegmentTarget(client, sessionId, originalScrollTop)

    if (
      segmentBuffers.length === 1 &&
      (scrollableSegmentationMode === "overview-and-segments" ||
        scrollableSegmentationMode === "full-page-scroll-steps")
    ) {
      return segmentBuffers[0]
    }

    const payload = {
      segments: segmentBuffers.map((buffer) => buffer.toString("base64")),
      metadata: segmentMetadata,
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
    forceExpandScrollable: options?.forceExpandScrollable ?? true,
    scrollableSegmentationMode: options?.scrollableSegmentationMode,
  })
  return renderScreenshotPayloadsToPdf([screenshotPayload], options)
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
    await cleanupBrowserWorkspace(workspace).catch(() => { })
  }
}
