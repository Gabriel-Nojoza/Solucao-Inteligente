"use client"

import { Filter, X, FilterX, Plus, Search, Sparkles } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FilterValueField } from "@/components/automations/filter-value-field"
import { isDateLikeDataType } from "@/lib/quick-filters"
import type { QueryFilter } from "@/lib/types"

interface FiltersPanelProps {
  quickFilters: Array<{
    key: string
    label: string
    description: string
    mapped: boolean
    dataType: string
    activeCount: number
  }>
  onAddQuickFilter: (key: string) => void
  filters: QueryFilter[]
  datasetId: string
  executionDatasetId?: string
  executionWorkspaceId?: string | null
  autoOpenFilterSignal?: string | null
  onUpdateFilter: (id: string, field: string, value: string) => void
  onRemoveFilter: (id: string) => void
  onClearAll: () => void
}

export function FiltersPanel({
  quickFilters,
  onAddQuickFilter,
  filters,
  datasetId,
  executionDatasetId,
  executionWorkspaceId,
  autoOpenFilterSignal,
  onUpdateFilter,
  onRemoveFilter,
  onClearAll,
}: FiltersPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
            <Filter className="size-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">FILTROS</h3>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              Refinar consulta
            </p>
          </div>
          {filters.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {filters.length}
            </span>
          )}
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
        <div className="space-y-3 p-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
                <Sparkles className="size-3.5 text-primary" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Filtros Rapidos
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Atalhos para os filtros mais usados
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {quickFilters.map((quickFilter) => (
                <button
                  key={quickFilter.key}
                  type="button"
                  onClick={() => onAddQuickFilter(quickFilter.key)}
                  disabled={!quickFilter.mapped}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    quickFilter.mapped
                      ? "border-border bg-background/60 hover:border-primary/40 hover:bg-accent/60"
                      : "cursor-not-allowed border-dashed border-border/60 bg-background/20 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-primary">
                      {quickFilter.label}
                    </span>

                    {quickFilter.activeCount > 0 && (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {quickFilter.activeCount}
                      </span>
                    )}

                    <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {quickFilter.mapped ? quickFilter.dataType : "Sem campo"}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Plus className="size-3" />
                    <span>{quickFilter.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
                <Search className="size-3.5 text-primary" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Filtros Ativos
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Ajuste operadores e valores da consulta
                </p>
              </div>
            </div>

            {filters.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/30 px-4 py-8 text-center text-muted-foreground">
                <FilterX className="mb-2 size-8 opacity-40" />
                <p className="text-xs font-medium">Nenhum filtro ativo</p>
                <p className="mt-1 text-[11px]">
                  Use os filtros rapidos acima ou clique no funil ao lado da coluna.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filters.map((filter) => {
                  const isDateFilter = isDateLikeDataType(filter.dataType)

                  return (
                    <div
                      key={filter.id}
                      className="rounded-xl border border-border bg-background/50 p-3 shadow-sm"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-primary">
                            {filter.columnName}
                          </span>
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                            {filter.tableName}
                          </span>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => onRemoveFilter(filter.id)}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>

                      {isDateFilter ? (
                        <div className="space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Data inicial
                              </span>
                              <Input
                                type="date"
                                value={filter.value}
                                onChange={(e) =>
                                  onUpdateFilter(filter.id, "value", e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Data final
                              </span>
                              <Input
                                type="date"
                                value={filter.valueTo ?? filter.value}
                                onChange={(e) =>
                                  onUpdateFilter(filter.id, "valueTo", e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>

                          <p className="text-[10px] text-muted-foreground">
                            Deixe uma das datas vazia para usar intervalo aberto.
                          </p>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <FilterValueField
                            filter={filter}
                            datasetId={datasetId}
                            executionDatasetId={executionDatasetId}
                            executionWorkspaceId={executionWorkspaceId}
                            autoOpenSignal={
                              autoOpenFilterSignal?.startsWith(`${filter.id}:`)
                                ? autoOpenFilterSignal
                                : null
                            }
                            onUpdateFilter={onUpdateFilter}
                          />
                        </div>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Tipo: {filter.dataType}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
