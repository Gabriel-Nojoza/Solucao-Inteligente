import path from "node:path"
import { fileURLToPath } from "node:url"

// Raiz do projeto fixa nesta pasta. Sem isso, se houver outro package-lock.json
// numa pasta acima (ex.: C:\Users\gabri), o Next trata a pasta do usuario
// inteira como o projeto e o build falha.
const raizDoProjeto = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: raizDoProjeto,
  turbopack: { root: raizDoProjeto },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ]
  },
}

export default nextConfig
