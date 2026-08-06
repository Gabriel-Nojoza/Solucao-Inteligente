'use strict'
// Worker isolado para captura de screenshot via Chrome.
// Roda em processo filho separado — se Chrome travar, o processo pai mata este via SIGKILL
// sem afetar o event loop do Next.js.
const puppeteer = require('puppeteer-core')
const http = require('http')
const fs = require('fs')
const path = require('path')

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

async function main() {
  const input = JSON.parse(process.env.CHROME_CAPTURE_INPUT || '{}')
  const {
    embedUrl,
    embedToken,
    reportId,
    pageName,
    viewportWidth = 1280,
    viewportHeight = 1600,
    deviceScaleFactor = 2,
    tokenType = 'Embed',
  } = input

  const executablePath = findChromePath()
  const powerBiClientJs = loadPowerBiClientJs()

  const tokenTypeJs = tokenType === 'Aad'
    ? 'models.TokenType.Aad'
    : 'models.TokenType.Embed'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #fff; width: ${viewportWidth}px; height: ${viewportHeight}px; }
    #pbi-container { width: ${viewportWidth}px; height: ${viewportHeight}px; }
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
    report.on('rendered', function() { setTimeout(function() { window._pbiRendered = true; }, 3000); });
    report.on('error', function(event) { window._pbiError = JSON.stringify(event.detail); window._pbiRendered = true; });
  </script>
</body>
</html>`

  const localServer = await serveHtmlLocally(html)
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    timeout: 90000,
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor })
    await page.goto(localServer.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForFunction('window._pbiRendered === true', { timeout: 90000 })

    const pbiError = await page.evaluate(() => window._pbiError).catch(() => null)
    if (pbiError) throw new Error('Power BI render error: ' + pbiError)

    const element = await page.$('#pbi-container')
    if (!element) throw new Error('Container Power BI nao encontrado na pagina')

    const screenshot = await element.screenshot({ type: 'png' })
    process.stdout.write(Buffer.from(screenshot).toString('base64'))
    process.exit(0)
  } finally {
    await browser.close().catch(() => {})
    await localServer.close().catch(() => {})
  }
}

main().catch(err => {
  process.stderr.write(err && err.message ? err.message : String(err))
  process.exit(1)
})
