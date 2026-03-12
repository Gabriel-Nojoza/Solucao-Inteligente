"use client"

import { useState } from "react"
import {
  Settings2,
  Copy,
  Play,
  FileDown,
  ChevronDown,
  ChevronRight,
  TableIcon,
  Loader2,
  X,
  Terminal,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  SelectedColumn,
  SelectedMeasure,
  DAXQueryResult,
} from "@/lib/types"
import { toast } from "sonner"

interface ResultsPanelProps {
  selectedColumns: SelectedColumn[]
  selectedMeasures: SelectedMeasure[]
  daxQuery: string
  result: DAXQueryResult | null
  reportHtml: string | null
  isExecuting: boolean
  onExecute: () => void
  onGeneratePdf: () => void
  onRemoveColumn: (tableName: string, columnName: string) => void
  onRemoveMeasure: (tableName: string, measureName: string) => void
}

export function ResultsPanel({
  selectedColumns,
  selectedMeasures,
  daxQuery,
  result,
  reportHtml,
  isExecuting,
  onExecute,
  onGeneratePdf,
  onRemoveColumn,
  onRemoveMeasure,
}: ResultsPanelProps) {
  const [showDax, setShowDax] = useState(true)
  const totalItems = selectedColumns.length + selectedMeasures.length

  const copyDax = async () => {
    try {
      await navigator.clipboard.writeText(daxQuery)
      toast.success("DAX copiado para a area de transferencia")
    } catch {
      toast.error("Nao foi possivel copiar automaticamente neste navegador.")
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Selected items */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">ITENS SELECIONADOS</h3>
          </div>
          <Badge variant="secondary" className="text-xs">
            {totalItems}
          </Badge>
        </div>

        {totalItems === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhum item selecionado
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {selectedColumns.map((c) => (
              <Badge
                key={`col-${c.tableName}.${c.columnName}`}
                variant="outline"
                className="gap-1 text-[10px]"
              >
                {c.tableName}.{c.columnName}
                <button
                  onClick={() => onRemoveColumn(c.tableName, c.columnName)}
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
            {selectedMeasures.map((m) => (
              <Badge
                key={`msr-${m.tableName}.${m.measureName}`}
                className="gap-1 bg-chart-2/15 text-[10px] text-chart-2 hover:bg-chart-2/25"
              >
                {m.measureName}
                <button
                  onClick={() => onRemoveMeasure(m.tableName, m.measureName)}
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* DAX Query */}
      <div className="border-b border-border">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowDax(!showDax)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setShowDax((prev) => !prev)
            }
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
        >
          {showDax ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <span className="text-xs font-semibold text-muted-foreground">
            DAX QUERY
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                copyDax()
              }}
              className="h-5 gap-1 text-[10px] text-primary"
              disabled={!daxQuery || daxQuery.startsWith("--")}
            >
              <Copy className="size-3" />
              COPY
            </Button>
          </div>
        </div>
        {showDax && (
          <div className="px-3 pb-2">
            <pre className="rounded-lg bg-muted/50 p-3 text-xs font-mono leading-relaxed text-primary overflow-x-auto whitespace-pre-wrap">
              {daxQuery || "-- Selecione campos para gerar DAX"}
            </pre>
          </div>
        )}
      </div>

      {/* Execute button */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          size="sm"
          onClick={onExecute}
          disabled={isExecuting || !daxQuery || daxQuery.startsWith("--")}
          className="h-7 gap-1.5 text-xs"
        >
          {isExecuting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Play className="size-3" />
          )}
          {isExecuting ? "Executando..." : "Executar Query"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onGeneratePdf}
          disabled={!reportHtml || !result || result.rows.length === 0}
          className="h-7 gap-1.5 text-xs"
        >
          <FileDown className="size-3" />
          Gerar PDF
        </Button>
        {result && (
          <span className="text-xs text-muted-foreground">
            {result.rows.length} linha(s) retornada(s)
          </span>
        )}
      </div>

      {/* Results */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <TableIcon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">RESULTADOS</h3>
        </div>

        {result ? (
          <ScrollArea className="flex-1">
            <div className="px-1 pb-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead
                        key={col.name}
                        className="h-8 whitespace-nowrap text-xs font-semibold"
                      >
                        {col.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.slice(0, 100).map((row, idx) => (
                    <TableRow key={idx}>
                      {result.columns.map((col) => (
                        <TableCell
                          key={col.name}
                          className="h-7 whitespace-nowrap text-xs"
                        >
                          {String(row[col.name] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {result.rows.length > 100 && (
                <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                  Mostrando 100 de {result.rows.length} linhas
                </p>
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
            <Terminal className="mb-2 size-10 opacity-30" />
            <p className="text-xs font-medium uppercase tracking-wider">
              No Data / Waiting Execution
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
