"use client"

import { Filter, X, FilterX } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { QueryFilter } from "@/lib/types"

const OPERATORS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "Contem" },
  { value: "startswith", label: "Inicia com" },
]

interface FiltersPanelProps {
  filters: QueryFilter[]
  onUpdateFilter: (id: string, field: string, value: string) => void
  onRemoveFilter: (id: string) => void
  onClearAll: () => void
}

export function FiltersPanel({
  filters,
  onUpdateFilter,
  onRemoveFilter,
  onClearAll,
}: FiltersPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">FILTROS</h3>
        </div>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-6 text-xs text-destructive hover:text-destructive"
          >
            Limpar
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-auto">
        {filters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FilterX className="mb-2 size-8 opacity-40" />
            <p className="text-xs">Clique no icone de filtro</p>
            <p className="text-xs">nas colunas ou medidas</p>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {filters.map((filter) => (
              <div
                key={filter.id}
                className="rounded-lg border border-border bg-muted/30 p-2.5"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-primary">
                    {filter.tableName}[{filter.columnName}]
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => onRemoveFilter(filter.id)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
                <div className="flex gap-1.5">
                  <Select
                    value={filter.operator}
                    onValueChange={(v) =>
                      onUpdateFilter(filter.id, "operator", v)
                    }
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={filter.value}
                    onChange={(e) =>
                      onUpdateFilter(filter.id, "value", e.target.value)
                    }
                    placeholder="Valor..."
                    className="h-7 flex-1 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
