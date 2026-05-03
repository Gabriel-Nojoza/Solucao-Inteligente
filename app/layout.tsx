import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import {
  BRAND_APPLE_ICON_PATH,
  BRAND_APP_ICON_192_PATH,
  BRAND_APP_ICON_512_PATH,
  BRAND_NAME,
  BRAND_SUBTITLE,
} from "@/lib/branding"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: `${BRAND_NAME} - ${BRAND_SUBTITLE}`,
  description: `Sistema de automacao de envio de relatorios Power BI via N8N e WhatsApp da ${BRAND_NAME}`,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: BRAND_APP_ICON_192_PATH, sizes: "192x192", type: "image/png" },
      { url: BRAND_APP_ICON_512_PATH, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: BRAND_APPLE_ICON_PATH, sizes: "180x180", type: "image/png" }],
    shortcut: [BRAND_APP_ICON_192_PATH],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a2e" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
