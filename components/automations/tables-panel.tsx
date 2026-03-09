"use client"

import { useState } from "react"
import {
  Table2,
  Columns3,
  ChevronRight,
  ChevronDown,
  Search,
  Eye,
  EyeOff,
  Filter,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  DatasetTable,
  DatasetColumn,
  SelectedColumn,
} from "@/lib/types"

interface TablesPanelProps {
  tables: DatasetTable[]
  columns: DatasetColumn[]
  selectedColumns: SelectedColumn[]
  onToggleColumn: (tableName: string, columnName: string) => void
  onAddFilter: (tableName: string, columnName: string, dataType: string) => void
  showHidden: boolean
  onToggleHidden: () => void
}

export function TablesPanel({
  tables,
  columns,
  selectedColumns,
  onToggleColumn,
  onAddFilter,
  showHidden,
  onToggleHidden,
}: TablesPanelProps) {
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const visibleTables = tables.filter((t) => {
    if (!showHidden && t.isHidden) return false
    if (search) {
      const searchLower = search.toLowerCase()
      const hasMatchingCol = columns.some(
        (c) =>
          c.tableName === t.name &&
          c.columnName.toLowerCase().includes(searchLower)
      )
      return (
        t.name.toLowerCase().includes(searchLower) || hasMatchingCol
      )
    }
    return true
  })

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const isColumnSelected = (tableName: string, columnName: string) =>
    selectedColumns.some(
      (c) => c.tableName === tableName && c.columnName === columnName
    )

  const getTableColumns = (tableName: string) =>
    columns.filter((c) => {
      if (c.tableName !== tableName) return false
      if (!showHidden && c.isHidden) return false
      if (search) {
        return c.columnName.toLowerCase().includes(search.toLowerCase())
      }
      return true
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Table2 className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">TABELAS</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {visibleTables.length}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onToggleHidden}
              >
                {showHidden ? (
                  <Eye className="size-3.5" />
                ) : (
                  <EyeOff className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showHidden ? "Ocultar itens escondidos" : "Mostrar itens escondidos"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar Tabela/Coluna..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 bg-muted/50 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-auto">
        <div className="space-y-0.5 px-1 pb-2">
          {visibleTables.map((table) => {
            const tableCols = getTableColumns(table.name)
            const isExpanded = expanded.has(table.name)

            return (
              <div key={table.name}>
                <button
                  onClick={() => toggleExpand(table.name)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <Table2 className="size-3.5 text-primary/70" />
                  <span
                    className={`truncate text-xs font-medium ${
                      table.isHidden ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {table.name}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {tableCols.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                    {tableCols.map((col) => (
                      <div
                        key={`${col.tableName}.${col.columnName}`}
                        className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent transition-colors"
                      >
                        <Checkbox
                          checked={isColumnSelected(col.tableName, col.columnName)}
                          onCheckedChange={() =>
                            onToggleColumn(col.tableName, col.columnName)
                          }
                          className="size-3.5"
                        />
                        <Columns3 className="size-3 text-muted-foreground" />
                        <span
                          className={`flex-1 truncate text-xs ${
                            col.isHidden
                              ? "text-muted-foreground italic"
                              : ""
                          }`}
                        >
                          {col.columnName}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {col.dataType}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() =>
                            onAddFilter(col.tableName, col.columnName, col.dataType)
                          }
                        >
                          <Filter className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {visibleTables.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nenhuma tabela encontrada
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
