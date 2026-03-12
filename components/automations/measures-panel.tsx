"use client"

import { useMemo, useState } from "react"
import { Calculator, Search, Info, Link2, ListTree } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { DatasetMeasure, SelectedMeasure } from "@/lib/types"

interface MeasuresPanelProps {
  measures: DatasetMeasure[]
  selectedMeasures: SelectedMeasure[]
  linkedTableNames?: string[]
  onToggleMeasure: (tableName: string, measureName: string) => void
}

export function MeasuresPanel({
  measures,
  selectedMeasures,
  linkedTableNames = [],
  onToggleMeasure,
}: MeasuresPanelProps) {
  const [search, setSearch] = useState("")
  const [showAllMeasures, setShowAllMeasures] = useState(false)

  const normalizedLinkedTables = useMemo(
    () => [...new Set(linkedTableNames.filter(Boolean))],
    [linkedTableNames]
  )

  const visibleMeasures = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    const searchedMeasures = measures.filter((measure) => {
      if (!normalizedSearch) return true
      return (
        measure.measureName.toLowerCase().includes(normalizedSearch) ||
        measure.tableName.toLowerCase().includes(normalizedSearch)
      )
    })

    const sortedMeasures = [...searchedMeasures].sort((left, right) => {
      const leftLinked = normalizedLinkedTables.includes(left.tableName) ? 0 : 1
      const rightLinked = normalizedLinkedTables.includes(right.tableName) ? 0 : 1

      if (leftLinked !== rightLinked) return leftLinked - rightLinked
      if (left.tableName !== right.tableName) {
        return left.tableName.localeCompare(right.tableName)
      }
      return left.measureName.localeCompare(right.measureName)
    })

    if (showAllMeasures || normalizedLinkedTables.length === 0) {
      return sortedMeasures
    }

    return sortedMeasures.filter((measure) =>
      normalizedLinkedTables.includes(measure.tableName)
    )
  }, [measures, normalizedLinkedTables, search, showAllMeasures])

  const connectedMeasuresCount = measures.filter((measure) =>
    normalizedLinkedTables.includes(measure.tableName)
  ).length

  const isMeasureSelected = (tableName: string, measureName: string) =>
    selectedMeasures.some(
      (measure) =>
        measure.tableName === tableName && measure.measureName === measureName
    )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Calculator className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">MEDIDAS</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {visibleMeasures.length}
          </span>
        </div>

        {normalizedLinkedTables.length > 0 ? (
          <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                <Link2 className="size-3" />
                Medidas conectadas a tabela
              </div>
              <Button
                type="button"
                variant={showAllMeasures ? "outline" : "secondary"}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setShowAllMeasures((prev) => !prev)}
              >
                {showAllMeasures ? "Mostrar conectadas" : "Mostrar todas"}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {normalizedLinkedTables.map((tableName) => (
                <span
                  key={tableName}
                  className="rounded-md border border-primary/20 bg-background/60 px-2 py-0.5 text-[10px] text-primary"
                >
                  {tableName}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {showAllMeasures
                ? `${connectedMeasuresCount} medida(s) conectada(s) em ${measures.length} total.`
                : `${connectedMeasuresCount} medida(s) conectada(s) disponivel(is).`}
            </p>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
            <ListTree className="size-3" />
            Selecione uma coluna para conectar a lista de medidas a uma tabela.
          </div>
        )}
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar Medida..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 bg-muted/50 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-auto">
        <div className="space-y-0.5 px-1 pb-2">
          {visibleMeasures.map((measure) => {
            const isConnected = normalizedLinkedTables.includes(measure.tableName)

            return (
              <div
                key={`${measure.tableName}.${measure.measureName}`}
                className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
                  isConnected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent"
                }`}
              >
                <Checkbox
                  checked={isMeasureSelected(measure.tableName, measure.measureName)}
                  onCheckedChange={() =>
                    onToggleMeasure(measure.tableName, measure.measureName)
                  }
                  className="size-3.5"
                />
                <Calculator className="size-3 text-chart-2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{measure.measureName}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{measure.tableName}</span>
                    {normalizedLinkedTables.length > 0 && (
                      <span
                        className={`rounded px-1 py-0.5 ${
                          isConnected
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isConnected ? "conectada" : "fora do contexto"}
                      </span>
                    )}
                  </div>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="opacity-0 transition-opacity group-hover:opacity-100">
                        <Info className="size-3 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs font-mono text-xs">
                      {measure.expression || "Sem expressao"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )
          })}

          {visibleMeasures.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nenhuma medida encontrada para o contexto atual
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
