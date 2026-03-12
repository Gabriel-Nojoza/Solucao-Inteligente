"use client"

import { useEffect, useState } from "react"
import {
  Table2,
  Columns3,
  ChevronRight,
  ChevronDown,
  Search,
  Eye,
  EyeOff,
  Filter,
  Link2,
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
  QueryFilter,
} from "@/lib/types"

interface TablesPanelProps {
  tables: DatasetTable[]
  columns: DatasetColumn[]
  selectedColumns: SelectedColumn[]
  filters: QueryFilter[]
  activeTableName?: string | null
  onToggleColumn: (tableName: string, columnName: string) => void
  onAddFilter: (tableName: string, columnName: string, dataType: string) => void
  onActivateTable: (tableName: string) => void
  showHidden: boolean
  onToggleHidden: () => void
}

export function TablesPanel({
  tables,
  columns,
  selectedColumns,
  filters,
  activeTableName,
  onToggleColumn,
  onAddFilter,
  onActivateTable,
  showHidden,
  onToggleHidden,
}: TablesPanelProps) {
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activeTableName) return

    setExpanded((prev) => {
      if (prev.has(activeTableName)) return prev
      const next = new Set(prev)
      next.add(activeTableName)
      return next
    })
  }, [activeTableName])

  const visibleTables = tables.filter((table) => {
    if (!showHidden && table.isHidden) return false
    if (search) {
      const normalizedSearch = search.toLowerCase()
      const hasMatchingColumn = columns.some(
        (column) =>
          column.tableName === table.name &&
          column.columnName.toLowerCase().includes(normalizedSearch)
      )
      return table.name.toLowerCase().includes(normalizedSearch) || hasMatchingColumn
    }
    return true
  })

  const toggleExpand = (tableName: string) => {
    onActivateTable(tableName)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(tableName)) next.delete(tableName)
      else next.add(tableName)
      return next
    })
  }

  const isColumnSelected = (tableName: string, columnName: string) =>
    selectedColumns.some(
      (column) => column.tableName === tableName && column.columnName === columnName
    )

  const hasFilter = (tableName: string, columnName: string) =>
    filters.some(
      (filter) => filter.tableName === tableName && filter.columnName === columnName
    )

  const getTableColumns = (tableName: string) =>
    columns.filter((column) => {
      if (column.tableName !== tableName) return false
      if (!showHidden && column.isHidden) return false
      if (search) {
        return column.columnName.toLowerCase().includes(search.toLowerCase())
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
                {showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
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
            const tableColumns = getTableColumns(table.name)
            const isExpanded = expanded.has(table.name)
            const isActive = activeTableName === table.name

            return (
              <div key={table.name}>
                <button
                  onClick={() => toggleExpand(table.name)}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    isActive ? "bg-primary/10 text-primary" : "hover:bg-accent"
                  }`}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <Table2 className={`size-3.5 ${isActive ? "text-primary" : "text-primary/70"}`} />
                  <span
                    className={`truncate text-xs font-medium ${
                      table.isHidden ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {table.name}
                  </span>
                  {isActive && <Link2 className="size-3 text-primary" />}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {tableColumns.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                    {tableColumns.map((column) => (
                      <div
                        key={`${column.tableName}.${column.columnName}`}
                        className={`group flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
                          isActive ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent"
                        }`}
                      >
                        <Checkbox
                          checked={isColumnSelected(column.tableName, column.columnName)}
                          onCheckedChange={() => {
                            onActivateTable(column.tableName)
                            onToggleColumn(column.tableName, column.columnName)
                          }}
                          className="size-3.5"
                        />
                        <Columns3 className="size-3 text-muted-foreground" />
                        <span
                          className={`flex-1 truncate text-xs ${
                            column.isHidden ? "text-muted-foreground italic" : ""
                          }`}
                        >
                          {column.columnName}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{column.dataType}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`size-6 shrink-0 rounded-sm border border-transparent transition-colors hover:border-border ${
                            hasFilter(column.tableName, column.columnName)
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "text-muted-foreground/80"
                          }`}
                          onClick={() => {
                            onActivateTable(column.tableName)
                            onAddFilter(column.tableName, column.columnName, column.dataType)
                          }}
                          title="Adicionar filtro"
                        >
                          <Filter className="size-3.5" />
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
