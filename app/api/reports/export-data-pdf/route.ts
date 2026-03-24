import { NextRequest, NextResponse } from "next/server"
import { renderHtmlScreenshotToPdf } from "@/lib/browser-pdf"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()

        const datasetId = body.datasetId
        const query = body.query

        if (!datasetId || !query) {
            return NextResponse.json(
                { error: "datasetId e query obrigatorios" },
                { status: 400 }
            )
        }

        const token = await getAccessToken()

        const result = await executeDAXQuery(
            token,
            datasetId,
            query
        )

        const rows = result.rows || []

        if (!rows.length) {
            return NextResponse.json(
                { error: "Sem dados" },
                { status: 400 }
            )
        }

        const columns = Object.keys(rows[0] || {})

        const html = `
<html>
<head>
<meta charset="utf-8"/>
<style>
body {
  font-family: Arial;
  font-size: 10px;
}

table {
  border-collapse: collapse;
  width: 100%;
}

td, th {
  border: 1px solid #000;
  padding: 2px;
}
</style>
</head>
<body>

<h2>Relatorio</h2>

<table>
<thead>
<tr>
${columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}
</tr>
</thead>

<tbody>
${rows.map(r => `
<tr>
${columns.map(c => `<td>${escapeHtml(r[c])}</td>`).join("")}
</tr>
`).join("")}
</tbody>

</table>

</body>
</html>
`

        const pdf = await renderHtmlScreenshotToPdf(html, {
            pageWidthMm: 420,
            pageHeightMm: 297,
            pageMarginMm: 6,
            deviceScaleFactor: 2,
        })

        return new NextResponse(pdf, {
            headers: {
                "Content-Type": "application/pdf",
            },
        })
    } catch (err) {
        console.error(err)

        return NextResponse.json(
            { error: "Erro ao gerar PDF" },
            { status: 500 }
        )
    }
}
