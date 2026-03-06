"use client"

import { useState } from "react"
import { Calculator, Search, Info } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
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
  onToggleMeasure: (tableName: string, measureName: string) => void
}

export function MeasuresPanel({
  measures,
  selectedMeasures,
  onToggleMeasure,
}: MeasuresPanelProps) {
  const [search, setSearch] = useState("")

  const filteredMeasures = measures.filter((m) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      m.measureName.toLowerCase().includes(s) ||
      m.tableName.toLowerCase().includes(s)
    )
  })

  const isMeasureSelected = (tableName: string, measureName: string) =>
    selectedMeasures.some(
      (m) => m.tableName === tableName && m.measureName === measureName
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Calculator className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">MEDIDAS</h3>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {measures.length}
        </span>
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
          {filteredMeasures.map((measure) => (
            <div
              key={`${measure.tableName}.${measure.measureName}`}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
            >
              <Checkbox
                checked={isMeasureSelected(
                  measure.tableName,
                  measure.measureName
                )}
                onCheckedChange={() =>
                  onToggleMeasure(measure.tableName, measure.measureName)
                }
                className="size-3.5"
              />
              <Calculator className="size-3 text-chart-2" />
              <span className="flex-1 truncate text-xs font-medium">
                {measure.measureName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {measure.tableName}
              </span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Info className="size-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    className="max-w-xs font-mono text-xs"
                  >
                    {measure.expression || "Sem expressao"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ))}

          {filteredMeasures.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nenhuma medida encontrada
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
