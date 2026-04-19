"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface DataTableResultProps {
  columns: Array<{ name: string; dataType: string }>
  rows: Array<Record<string, unknown>>
  maxVisibleRows?: number
}

function formatCellValue(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return "—"

  const type = dataType.toLowerCase()

  if (
    type.includes("int") ||
    type.includes("double") ||
    type.includes("decimal") ||
    type.includes("number") ||
    type.includes("currency")
  ) {
    const num = Number(value)
    if (!isNaN(num)) {
      return num.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    }
  }

  if (type.includes("date") || type.includes("time")) {
    try {
      const date = new Date(String(value))
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString("pt-BR")
      }
    } catch {
      // não é data
    }
  }

  return String(value)
}

export function DataTableResult({
  columns,
  rows,
  maxVisibleRows = 10,
}: DataTableResultProps) {
  const [expanded, setExpanded] = useState(false)

  const visibleRows = expanded ? rows : rows.slice(0, maxVisibleRows)
  const hasMore = rows.length > maxVisibleRows
  const hasManyColumns = columns.length >= 4

  if (columns.length === 0 || rows.length === 0) return null

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-background text-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col.name}
                  title={col.name}
                  className={cn(
                    "px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground align-top break-words",
                    hasManyColumns ? "max-w-[120px]" : "max-w-[180px]"
                  )}
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  "border-b border-border/50 transition-colors",
                  rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20",
                  "hover:bg-muted/40"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.name}
                    title={String(formatCellValue(row[col.name], col.dataType))}
                    className={cn(
                      "px-2 py-1.5 text-[11px] text-foreground align-top break-words",
                      (col.dataType.toLowerCase().includes("int") ||
                        col.dataType.toLowerCase().includes("double") ||
                        col.dataType.toLowerCase().includes("decimal") ||
                        col.dataType.toLowerCase().includes("number") ||
                        col.dataType.toLowerCase().includes("currency")) &&
                        "text-right tabular-nums break-normal"
                    )}
                  >
                    {formatCellValue(row[col.name], col.dataType)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            {expanded
              ? `${rows.length} linhas`
              : `Mostrando ${maxVisibleRows} de ${rows.length} linhas`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                Ver todas
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
