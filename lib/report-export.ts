import { describePrimaryDateFilter } from "@/lib/query-filters"
import type { QueryFilter } from "@/lib/types"
import { BRAND_LOGO_PATH, BRAND_NAME } from "@/lib/branding"

export interface ReportColumn {
  name: string
  dataType?: string
}

export interface ReportResult {
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
}

export interface ReportDocumentInput {
  title: string
  subtitle?: string | null
  generatedAt?: Date
  selectedItems?: string[]
  filters?: QueryFilter[]
  brandLogoUrl?: string
  result: ReportResult
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "Sim" : "Nao"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  if (value instanceof Date) return value.toLocaleString("pt-BR")
  return String(value)
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value)
}

export function buildCsvContent(result: ReportResult): string {
  if (!result.columns.length) return ""

  const escapeCsv = (value: unknown) => `"${formatCellValue(value).replace(/"/g, '""')}"`
  const header = result.columns.map((column) => escapeCsv(column.name)).join(",")
  const rows = result.rows.map((row) =>
    result.columns.map((column) => escapeCsv(row[column.name])).join(",")
  )

  return [header, ...rows].join("\n")
}

export function buildTextReport(result: ReportResult, maxRows = 100): string {
  if (!result.columns.length) return "Nenhum dado retornado."

  const rows = result.rows.slice(0, maxRows)
  const headers = result.columns.map((column) => column.name)
  const values = rows.map((row) => result.columns.map((column) => formatCellValue(row[column.name])))
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...values.map((row) => row[index]?.length ?? 0))
  )

  const renderRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index], " ")).join(" | ")

  const separator = widths.map((width) => "-".repeat(width)).join("-+-")
  const lines = [renderRow(headers), separator, ...values.map(renderRow)]

  if (result.rows.length > maxRows) {
    lines.push("")
    lines.push(`... ${result.rows.length - maxRows} linha(s) omitida(s)`)
  }

  return lines.join("\n")
}

export function buildHtmlReport({
  title,
  subtitle,
  generatedAt,
  selectedItems,
  filters = [],
  brandLogoUrl = BRAND_LOGO_PATH,
  result,
}: ReportDocumentInput): string {
  const generated = (generatedAt ?? new Date()).toLocaleString("pt-BR")
  const filteredPeriod = describePrimaryDateFilter(filters)
  const columns = result.columns
  const rows = result.rows
  const totalRecords = formatCount(rows.length)
  const selectedBadges =
    selectedItems && selectedItems.length > 0
      ? selectedItems
          .map(
            (item) =>
              `<span class="pill">${escapeHtml(item)}</span>`
          )
          .join("")
      : ""

  const tableHead = columns
    .map((column) => `<th>${escapeHtml(column.name)}</th>`)
    .join("")

  const tableBody = rows.length
    ? rows
        .map((row) => {
          const cells = columns
            .map((column) => `<td>${escapeHtml(formatCellValue(row[column.name])) || "&nbsp;"}</td>`)
            .join("")
          return `<tr>${cells}</tr>`
        })
        .join("")
    : `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty">Nenhum dado retornado.</td></tr>`

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --card: #ffffff;
      --text: #101828;
      --muted: #475467;
      --line: #d0d5dd;
      --accent: #2563eb;
      --accent-soft: #dbeafe;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      background: linear-gradient(180deg, #eff4ff 0%, var(--bg) 100%);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    .card {
      max-width: 1120px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 20px 45px rgba(16, 24, 40, 0.08);
    }
    .hero {
      padding: 28px 32px 20px;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
      color: #ffffff;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
    }
    .brand-row img {
      width: 54px;
      height: 54px;
      object-fit: contain;
    }
    .brand-copy {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .brand-copy strong {
      font-size: 16px;
      line-height: 1.1;
    }
    .brand-copy span {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.72);
    }
    .hero h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
    }
    .hero p {
      margin: 8px 0 0;
      color: rgba(255,255,255,0.82);
      font-size: 14px;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 20px 32px;
      border-bottom: 1px solid var(--line);
      background: #f8fafc;
    }
    .meta-card {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 12px;
      padding: 12px 14px;
    }
    .meta-card span {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meta-card strong {
      font-size: 15px;
    }
    .meta-card small {
      display: block;
      margin-top: 4px;
      font-size: 11px;
      color: var(--muted);
    }
    .selected {
      padding: 18px 32px 0;
    }
    .selected span.label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .pill-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--text);
    }
    .content {
      padding: 24px 32px 32px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    th {
      background: var(--accent-soft);
      color: #1d4ed8;
      font-weight: 700;
    }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    .empty {
      text-align: center;
      color: var(--muted);
      padding: 28px;
    }
    .footer {
      padding: 18px 32px 28px;
      color: var(--muted);
      font-size: 12px;
    }
    @media print {
      body { padding: 0; background: #fff; }
      .card { box-shadow: none; border-radius: 0; }
    }
    @media (max-width: 720px) {
      .meta {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <div class="brand-row">
        <img src="${escapeHtml(brandLogoUrl)}" alt="${escapeHtml(BRAND_NAME)}" />
        <div class="brand-copy">
          <strong>${escapeHtml(BRAND_NAME)}</strong>
          <span>Relatório automatizado</span>
        </div>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle || "Relatorio gerado automaticamente a partir da automacao.")}</p>
    </div>
    <div class="meta">
      <div class="meta-card">
        <span>${filteredPeriod ? "Periodo" : "Gerado em"}</span>
        <strong>${escapeHtml(filteredPeriod?.value ?? generated)}</strong>
        ${
          filteredPeriod
            ? `<small>${escapeHtml(filteredPeriod.label)}</small>`
            : ""
        }
      </div>
      <div class="meta-card">
        <span>Total</span>
        <strong>${totalRecords}</strong>
        <small>${rows.length === 1 ? "1 registro retornado" : `${totalRecords} registros retornados`}</small>
      </div>
    </div>
    ${
      selectedBadges
        ? `<div class="selected">
      <span class="label">Itens selecionados</span>
      <div class="pill-list">${selectedBadges}</div>
    </div>`
        : ""
    }
    <div class="content">
      <table>
        <thead>
          <tr>${tableHead}</tr>
        </thead>
        <tbody>
          ${tableBody}
        </tbody>
      </table>
    </div>
    <div class="footer">
      ${escapeHtml(BRAND_NAME)} | Conteudo pronto para envio por N8N e conversao para PDF quando necessario.
    </div>
  </div>
</body>
</html>`
}
