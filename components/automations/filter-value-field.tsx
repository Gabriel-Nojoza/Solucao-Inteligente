"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isDateLikeDataType } from "@/lib/quick-filters"
import { cn } from "@/lib/utils"
import type { QueryFilter } from "@/lib/types"

type FilterOptionsResponse = {
  options: string[]
  truncated: boolean
}

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Erro ao carregar opcoes do filtro")
  }

  return data as FilterOptionsResponse
}

function getInputType(dataType: string) {
  const normalized = dataType.toLowerCase()
  if (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number")
  ) {
    return "number"
  }
  return "text"
}

interface FilterValueFieldProps {
  filter: QueryFilter
  datasetId: string
  executionDatasetId?: string
  executionWorkspaceId?: string | null
  autoOpenSignal?: string | null
  onUpdateFilter: (id: string, field: string, value: string) => void
}

export function FilterValueField({
  filter,
  datasetId,
  executionDatasetId,
  executionWorkspaceId,
  autoOpenSignal,
  onUpdateFilter,
}: FilterValueFieldProps) {
  const [open, setOpen] = useState(false)
  const canLoadOptions = Boolean(datasetId) && !isDateLikeDataType(filter.dataType)
  const optionsUrl = useMemo(() => {
    if (!canLoadOptions) {
      return null
    }

    const params = new URLSearchParams({
      datasetId,
      tableName: filter.tableName,
      columnName: filter.columnName,
      dataType: filter.dataType,
    })

    if (executionDatasetId) {
      params.set("executionDatasetId", executionDatasetId)
    }

    if (executionWorkspaceId) {
      params.set("executionWorkspaceId", executionWorkspaceId)
    }

    return `/api/powerbi/filter-options?${params.toString()}`
  }, [
    canLoadOptions,
    datasetId,
    executionDatasetId,
    executionWorkspaceId,
    filter.columnName,
    filter.dataType,
    filter.tableName,
  ])
  const { data, error, isLoading } = useSWR(optionsUrl, fetcher, {
    revalidateOnFocus: false,
  })

  useEffect(() => {
    if (!autoOpenSignal || !canLoadOptions) {
      return
    }

    setOpen(true)
  }, [autoOpenSignal, canLoadOptions])

  const options = data?.options ?? []
  const showOptionsPicker = canLoadOptions && (isLoading || options.length > 0)

  if (!showOptionsPicker) {
    return (
      <div className="space-y-1">
        <Input
          type={getInputType(filter.dataType)}
          value={filter.value}
          onChange={(e) => onUpdateFilter(filter.id, "value", e.target.value)}
          placeholder="Valor..."
          className="h-8 flex-1 text-xs"
        />
        {error ? (
          <p className="text-[10px] text-muted-foreground">
            Nao foi possivel carregar a lista. Digite manualmente.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-full justify-between px-2 text-xs font-normal"
          >
            <span className="truncate text-left">
              {filter.value || (isLoading ? "Carregando opcoes..." : "Selecionar opcao")}
            </span>
            {isLoading ? (
              <Loader2 className="ml-2 size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Buscar ${filter.columnName}...`} />
            <CommandList>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Carregando opcoes...
                </div>
              ) : (
                <>
                  <CommandEmpty>Nenhuma opcao encontrada.</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => {
                          onUpdateFilter(filter.id, "value", option)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            filter.value === option ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="truncate">{option}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Input
        type={getInputType(filter.dataType)}
        value={filter.value}
        onChange={(e) => onUpdateFilter(filter.id, "value", e.target.value)}
        placeholder="Ou digite manualmente"
        className="h-8 flex-1 text-xs"
      />

      {data?.truncated ? (
        <p className="text-[10px] text-muted-foreground">
          Mostrando as primeiras 200 opcoes disponiveis.
        </p>
      ) : null}
    </div>
  )
}
