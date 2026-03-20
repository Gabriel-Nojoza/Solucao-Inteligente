import { chromium } from "playwright"

export type AppPdfProfile = "desktop" | "mobile"

function getPreset(profile: AppPdfProfile) {
  if (profile === "mobile") {
    return {
      viewport: { width: 430, height: 1600 },
      scale: 1,
      width: "320mm",
      height: "480mm",
      margin: {
        top: "4mm",
        right: "4mm",
        bottom: "4mm",
        left: "4mm",
      },
    }
  }

  return {
    viewport: { width: 1600, height: 2200 },
    scale: 1,
    width: "320mm",
    height: "520mm",
    margin: {
      top: "4mm",
      right: "4mm",
      bottom: "4mm",
      left: "4mm",
    },
  }
}

export async function exportAppReportPdf(input: {
  url: string
  pdfProfile?: AppPdfProfile
  waitForSelector?: string
}) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  try {
    const preset = getPreset(input.pdfProfile ?? "desktop")
    const page = await browser.newPage({
      viewport: preset.viewport,
      deviceScaleFactor: 1.5,
    })

    await page.goto(input.url, {
      waitUntil: "networkidle",
      timeout: 120000,
    })

    if (input.waitForSelector) {
      await page.waitForSelector(input.waitForSelector, {
        timeout: 90000,
      })
    }

    await page.emulateMedia({ media: "screen" })

    await page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        @page {
          size: ${preset.width} ${preset.height};
          margin: 0;
        }
      `,
    })

    await page.waitForTimeout(3000)

    return await page.pdf({
      printBackground: true,
      width: preset.width,
      height: preset.height,
      margin: preset.margin,
      preferCSSPageSize: false,
      scale: preset.scale,
      timeout: 120000,
    })
  } finally {
    await browser.close()
  }
}
