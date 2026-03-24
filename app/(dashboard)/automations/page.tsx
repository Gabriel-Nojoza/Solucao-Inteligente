"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import {
  Workflow,
  Loader2,
  AlertCircle,
  Database,
  ListFilter,
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { TablesPanel } from "@/components/automations/tables-panel"
import { MeasuresPanel } from "@/components/automations/measures-panel"
import { FiltersPanel } from "@/components/automations/filters-panel"
import { ResultsPanel } from "@/components/automations/results-panel"
import { SaveAutomationDialog } from "@/components/automations/save-automation-dialog"
import { SavedAutomationsList } from "@/components/automations/saved-automations-list"
import { DispatchDialog } from "@/components/automations/dispatch-dialog"
import { ScheduleDialog } from "@/components/automations/schedule-dialog"
import { buildDAXQuery } from "@/lib/dax-builder"
import { createId } from "@/lib/id"
import {
  buildQuickFilters,
  getDefaultFilterValue,
  getDefaultFilterValueTo,
} from "@/lib/quick-filters"
import { toast } from "sonner"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useBotContactSync } from "@/hooks/use-bot-contact-sync"
import type {
  Workspace,
  Contact,
  SelectedColumn,
  SelectedMeasure,
  QueryFilter,
  DatasetTable,
  DatasetColumn,
  DatasetMeasure,
  DAXQueryResult,
} from "@/lib/types"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar dados")
  }

  return data
}

export default function AutomationsPage() {
  const lastExecutedSignatureRef = useRef("")
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState("builder")
  const [selectedWorkspace, setSelectedWorkspace] = useState("")
  const [selectedDataset, setSelectedDataset] = useState("")
  const [selectedExecutionDataset, setSelectedExecutionDataset] = useState("")
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([])
  const [selectedMeasures, setSelectedMeasures] = useState<SelectedMeasure[]>([])
  const [activeTableName, setActiveTableName] = useState<string | null>(null)
  const [filters, setFilters] = useState<QueryFilter[]>([])
  const [autoOpenFilterSignal, setAutoOpenFilterSignal] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [result, setResult] = useState<DAXQueryResult | null>(null)
  const [reportHtml, setReportHtml] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [savingExecutionDataset, setSavingExecutionDataset] = useState(false)
  const [importingScannerCatalog, setImportingScannerCatalog] = useState(false)
  const [importingWorkspaceScannerCatalog, setImportingWorkspaceScannerCatalog] =
    useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { data: rawWorkspaces } = useSWR("/api/workspaces", fetcher)
  const { data: rawContacts } = useSWR("/api/contacts", fetcher)
  const { data: stats } = useSWR<{ n8nConfigured?: boolean }>("/api/stats", fetcher)
  const { data: botQrConfig } = useSWR<{
    status?: "starting" | "awaiting_qr" | "connected" | "reconnecting" | "offline" | "error"
    jid?: string | null
    phone_number?: string | null
    connected_at?: string | null
  }>("/api/bot/qr", fetcher)

  const workspaces: Workspace[] = Array.isArray(rawWorkspaces) ? rawWorkspaces : []
  const contacts: Contact[] = Array.isArray(rawContacts) ? rawContacts : []
  useBotContactSync(botQrConfig)
  const canShowContacts = botQrConfig?.status === "connected"

  const selectedWs = workspaces.find((w) => w.id === selectedWorkspace)
  const pbiWorkspaceId = selectedWs?.pbi_workspace_id

  const {
    data: rawDatasets,
    isLoading: loadingDatasets,
    error: datasetsError,
  } = useSWR(
    pbiWorkspaceId ? `/api/powerbi/datasets?workspaceId=${pbiWorkspaceId}` : null,
    fetcher
  )

  const datasets = Array.isArray(rawDatasets) ? rawDatasets : []

  const {
    data: fixedCatalogPayload,
    isLoading: loadingFixedCatalog,
    mutate: mutateFixedCatalog,
  } = useSWR<{
    catalog: {
      tables: DatasetTable[]
      columns: DatasetColumn[]
      measures: DatasetMeasure[]
    } | null
    updated_at: string | null
    execution_dataset_id: string | null
    execution_workspace_id: string | null
    execution_dataset_name: string | null
  }>(
    selectedDataset ? `/api/automations/catalog?datasetId=${selectedDataset}` : null,
    fetcher
  )

  const fixedCatalog = fixedCatalogPayload?.catalog ?? null
  const hasFixedCatalogData = !!(
    fixedCatalog &&
    ((fixedCatalog.tables?.length ?? 0) > 0 ||
      (fixedCatalog.columns?.length ?? 0) > 0 ||
      (fixedCatalog.measures?.length ?? 0) > 0)
  )

  const {
    data: metadata,
    isLoading: loadingMetadata,
    error: metadataError,
  } = useSWR<{
    tables: DatasetTable[]
    columns: DatasetColumn[]
    measures: DatasetMeasure[]
  }>(
    selectedDataset &&
      pbiWorkspaceId &&
      fixedCatalogPayload !== undefined &&
      !hasFixedCatalogData
      ? `/api/powerbi/metadata?datasetId=${selectedDataset}&workspaceId=${pbiWorkspaceId}`
      : null,
    fetcher
  )

  const effectiveMetadata = hasFixedCatalogData ? fixedCatalog : metadata

  const isLoadingSchema =
    !!selectedDataset && (loadingFixedCatalog || (!hasFixedCatalogData && loadingMetadata))

  const schemaError =
    !hasFixedCatalogData && !loadingFixedCatalog ? metadataError : null

  const tables = useMemo(() => {
    if (effectiveMetadata?.tables?.length) return effectiveMetadata.tables

    const tableMap = new Map<string, DatasetTable>()

    for (const column of effectiveMetadata?.columns || []) {
      if (!column.tableName || tableMap.has(column.tableName)) continue
      tableMap.set(column.tableName, {
        name: column.tableName,
        isHidden: false,
      })
    }

    for (const measure of effectiveMetadata?.measures || []) {
      if (!measure.tableName || tableMap.has(measure.tableName)) continue
      tableMap.set(measure.tableName, {
        name: measure.tableName,
        isHidden: false,
      })
    }

    return [...tableMap.values()]
  }, [effectiveMetadata])

  const columns = effectiveMetadata?.columns || []
  const measures = effectiveMetadata?.measures || []

  const linkedTableNames = useMemo(() => {
    const fromColumns = selectedColumns.map((column) => column.tableName)
    const fromFilters = filters.map((filter) => filter.tableName)
    const fromMeasures = selectedMeasures.map((measure) => measure.tableName)
    const linked = [...fromColumns, ...fromFilters, ...fromMeasures]

    if (linked.length > 0) {
      return [...new Set(linked)]
    }

    return activeTableName ? [activeTableName] : []
  }, [activeTableName, filters, selectedColumns, selectedMeasures])

  useEffect(() => {
    if (!selectedDataset) {
      setSelectedExecutionDataset("")
      return
    }

    setSelectedExecutionDataset(
      fixedCatalogPayload?.execution_dataset_id || selectedDataset
    )
  }, [selectedDataset, fixedCatalogPayload?.execution_dataset_id])

  const quickFilters = useMemo(() => {
    return buildQuickFilters(columns, filters)
  }, [columns, filters])

  const daxQuery = useMemo(
    () =>
      buildDAXQuery({
        columns: selectedColumns,
        measures: selectedMeasures,
        filters,
        limit: 100,
      }),
    [selectedColumns, selectedMeasures, filters]
  )

  const hasQuery =
    typeof daxQuery === "string" &&
    daxQuery.trim().length > 0 &&
    !daxQuery.startsWith("--")

  const activateTable = useCallback((tableName: string) => {
    setActiveTableName(tableName)
  }, [])

  const toggleColumn = useCallback((tableName: string, columnName: string) => {
    setActiveTableName(tableName)

    setSelectedColumns((prev) => {
      const exists = prev.some(
        (c) => c.tableName === tableName && c.columnName === columnName
      )

      if (exists) {
        return prev.filter(
          (c) => !(c.tableName === tableName && c.columnName === columnName)
        )
      }

      return [...prev, { tableName, columnName }]
    })
  }, [])

  const toggleMeasure = useCallback((tableName: string, measureName: string) => {
    setActiveTableName(tableName)

    setSelectedMeasures((prev) => {
      const exists = prev.some(
        (m) => m.tableName === tableName && m.measureName === measureName
      )

      if (exists) {
        return prev.filter(
          (m) => !(m.tableName === tableName && m.measureName === measureName)
        )
      }

      return [...prev, { tableName, measureName }]
    })
  }, [])

  const addFilter = useCallback(
    (tableName: string, columnName: string, dataType: string) => {
      const existingFilter = filters.find(
        (filter) =>
          filter.tableName === tableName && filter.columnName === columnName
      )

      if (existingFilter) {
        setAutoOpenFilterSignal(`${existingFilter.id}:${Date.now()}`)
        return
      }

      const nextFilterId = createId("filter")
      setAutoOpenFilterSignal(`${nextFilterId}:${Date.now()}`)

      setFilters((prev) => [
        ...prev,
        {
          id: nextFilterId,
          tableName,
          columnName,
          operator: "eq",
          value: getDefaultFilterValue(dataType),
          valueTo: getDefaultFilterValueTo(dataType),
          dataType,
        },
      ])
    },
    [filters]
  )

  const addQuickFilter = useCallback(
    (key: string) => {
      const quickFilter = quickFilters.find((item) => item.key === key)

      if (!quickFilter?.mapped || !quickFilter.tableName || !quickFilter.columnName) {
        toast.error("Esse filtro rapido ainda nao tem uma coluna correspondente no dataset")
        return
      }

      addFilter(quickFilter.tableName, quickFilter.columnName, quickFilter.dataType)
    },
    [addFilter, quickFilters]
  )

  const updateFilter = useCallback((id: string, field: string, value: string) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }, [])

  const removeFilter = useCallback((id: string) => {
    setAutoOpenFilterSignal((current) =>
      current?.startsWith(`${id}:`) ? null : current
    )
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const executeQuery = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!selectedDataset) {
        toast.error("Selecione um dataset")
        return
      }

      if (!hasQuery) {
        toast.error("Monte uma query valida antes de executar")
        return
      }

      setIsExecuting(true)

      try {
        const res = await fetch("/api/powerbi/execute-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: selectedDataset,
            executionDatasetId: selectedExecutionDataset || selectedDataset,
            executionWorkspaceId: pbiWorkspaceId || "",
            query: daxQuery,
            filters,
            selectedColumns,
            selectedMeasures,
            limit: 100,
            reportTitle: "Resultado da Query",
            selectedItems: [
              ...selectedColumns.map(
                (column) => `${column.tableName}.${column.columnName}`
              ),
              ...selectedMeasures.map((measure) => measure.measureName),
            ],
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error)
        }

        setResult({
          columns: data.columns || [],
          rows: data.rows || [],
        })

        setReportHtml(data.report?.html || null)

        if (!options?.silent) {
          toast.success(`Query executada: ${data.rows?.length || 0} linhas`)
        }
      } catch (error) {
        setReportHtml(null)
        toast.error(error instanceof Error ? error.message : "Erro ao executar query")
      } finally {
        setIsExecuting(false)
      }
    },
    [
      daxQuery,
      filters,
      hasQuery,
      pbiWorkspaceId,
      selectedColumns,
      selectedDataset,
      selectedExecutionDataset,
      selectedMeasures,
    ]
  )

  const saveExecutionDatasetMapping = useCallback(
    async (executionDatasetId: string) => {
      if (!selectedDataset || !pbiWorkspaceId) return

      const executionDataset = datasets.find(
        (dataset: { id: string; name: string }) => dataset.id === executionDatasetId
      )

      setSavingExecutionDataset(true)

      try {
        const res = await fetch("/api/automations/catalog", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: selectedDataset,
            workspaceId: pbiWorkspaceId,
            executionDatasetId,
            executionWorkspaceId: pbiWorkspaceId,
            executionDatasetName: executionDataset?.name || null,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || "Erro ao salvar dataset auxiliar")
        }

        await mutateFixedCatalog()

        toast.success(
          executionDatasetId === selectedDataset
            ? "Execucao configurada para usar o proprio dataset."
            : "Dataset auxiliar de execucao salvo."
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Erro ao salvar dataset auxiliar"
        )
      } finally {
        setSavingExecutionDataset(false)
      }
    },
    [datasets, mutateFixedCatalog, pbiWorkspaceId, selectedDataset]
  )

  useEffect(() => {
    if (!hasQuery) {
      lastExecutedSignatureRef.current = ""
      return
    }
  }, [hasQuery])

  useEffect(() => {
    if (!mounted || !selectedDataset || !hasQuery || isExecuting) {
      return
    }

    const signature = `${selectedDataset}::${daxQuery}`

    if (lastExecutedSignatureRef.current === signature) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      lastExecutedSignatureRef.current = signature
      void executeQuery({ silent: true })
    }, 600)

    return () => window.clearTimeout(timeoutId)
  }, [mounted, selectedDataset, hasQuery, daxQuery, isExecuting, executeQuery])

  const handleGeneratePdf = useCallback(() => {
    if (!reportHtml) {
      toast.error("Execute uma query com resultado antes de gerar PDF")
      return
    }

    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const printWindow = window.open(url, "_blank", "width=1200,height=900")

    if (!printWindow) {
      URL.revokeObjectURL(url)
      toast.error(
        "Nao foi possivel abrir a janela do PDF. Verifique se o navegador bloqueou pop-up."
      )
      return
    }

    const triggerPrint = () => {
      printWindow.focus()
      printWindow.print()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    }

    printWindow.onload = triggerPrint
  }, [reportHtml])

  const handleSave = async (saveData: {
    name: string
    cron_expression: string | null
    export_format: string
    message_template: string
    contact_ids: string[]
  }) => {
    if (!selectedDataset) {
      throw new Error("Selecione um dataset antes de salvar a automacao")
    }

    if (!hasQuery) {
      throw new Error("Monte uma query valida antes de salvar a automacao")
    }

    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...saveData,
        dataset_id: selectedDataset,
        workspace_id: selectedWorkspace || null,
        selected_columns: selectedColumns,
        selected_measures: selectedMeasures,
        filters,
        dax_query: daxQuery,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      const message =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.error?.message === "string"
            ? data.error.message
            : "Erro ao salvar automacao"

      throw new Error(message)
    }

    toast.success("Automacao salva com sucesso!")
    await globalMutate("/api/automations")
  }

  const handleWorkspaceChange = (value: string) => {
    setSelectedWorkspace(value)
    setSelectedDataset("")
    setSelectedExecutionDataset("")
    setSelectedColumns([])
    setSelectedMeasures([])
    setActiveTableName(null)
    setFilters([])
    setAutoOpenFilterSignal(null)
    setResult(null)
    setReportHtml(null)
    lastExecutedSignatureRef.current = ""
  }

  const handleDatasetChange = (value: string) => {
    setSelectedDataset(value)
    setSelectedExecutionDataset(value)
    setSelectedColumns([])
    setSelectedMeasures([])
    setActiveTableName(null)
    setFilters([])
    setAutoOpenFilterSignal(null)
    setResult(null)
    setReportHtml(null)
    lastExecutedSignatureRef.current = ""
  }

  const handleExecutionDatasetChange = async (value: string) => {
    setSelectedExecutionDataset(value)
    lastExecutedSignatureRef.current = ""
    await saveExecutionDatasetMapping(value)
  }

  const importCatalogFromScanner = async () => {
    if (!selectedDataset || !pbiWorkspaceId) {
      toast.error("Selecione workspace e dataset antes de importar")
      return
    }

    setImportingScannerCatalog(true)

    try {
      const res = await fetch("/api/powerbi/scanner-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: pbiWorkspaceId,
          datasetId: selectedDataset,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Falha ao importar catalogo via scanner")
      }

      await mutateFixedCatalog()

      toast.success(
        `Catalogo importado: ${data.table_count ?? 0} tabelas, ${data.column_count ?? 0
        } colunas, ${data.measure_count ?? 0} medidas`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao importar catalogo via scanner"
      )
    } finally {
      setImportingScannerCatalog(false)
    }
  }

  const importWorkspaceCatalogsFromScanner = async () => {
    if (!pbiWorkspaceId) {
      toast.error("Selecione um workspace antes de importar em lote")
      return
    }

    setImportingWorkspaceScannerCatalog(true)

    try {
      const res = await fetch("/api/powerbi/scanner-catalog/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: pbiWorkspaceId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Falha ao importar catalogos do workspace")
      }

      await mutateFixedCatalog()

      toast.success(
        `Importacao em lote concluida: ${data.imported_datasets ?? 0} datasets atualizados`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro na importacao em lote do scanner"
      )
    } finally {
      setImportingWorkspaceScannerCatalog(false)
    }
  }

  if (!mounted) {
    return (
      <div className="flex h-[calc(100vh-1rem)] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-1rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 sm:hidden" />
          <Workflow className="size-5 text-primary" />
          <h1 className="text-base font-bold sm:text-lg">Automacoes</h1>
        </div>

        <div className="ml-2 inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <Button
            type="button"
            variant={activeTab === "builder" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 gap-1.5 px-2 text-xs"
            onClick={() => setActiveTab("builder")}
          >
            <Database className="size-3" />
            <span className="hidden sm:inline">Query Builder</span>
            <span className="sm:hidden">Builder</span>
          </Button>

          <Button
            type="button"
            variant={activeTab === "saved" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 gap-1.5 px-2 text-xs"
            onClick={() => setActiveTab("saved")}
          >
            <ListFilter className="size-3" />
            <span className="hidden sm:inline">Automacoes Salvas</span>
            <span className="sm:hidden">Salvas</span>
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {activeTab === "builder" && stats?.n8nConfigured === false && (
            <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              Webhook N8N nao configurado para este cliente
            </span>
          )}

          {activeTab === "builder" && (
            <>
              <DispatchDialog
                contacts={contacts}
                showContacts={canShowContacts}
                daxQuery={daxQuery}
                datasetId={selectedDataset}
                executionDatasetId={selectedExecutionDataset || selectedDataset}
                disabled={!hasQuery}
              />

              <ScheduleDialog
                contacts={contacts}
                showContacts={canShowContacts}
                onSave={handleSave}
                disabled={!hasQuery}
              />

              <SaveAutomationDialog
                contacts={contacts}
                showContacts={canShowContacts}
                onSave={handleSave}
                disabled={!hasQuery}
              />
            </>
          )}
        </div>
      </div>

      {activeTab === "builder" && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 sm:px-4">
            <Select value={selectedWorkspace} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-48">
                <SelectValue placeholder="Selecione um workspace" />
              </SelectTrigger>

              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedDataset}
              onValueChange={handleDatasetChange}
              disabled={!selectedWorkspace || loadingDatasets}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-56">
                {loadingDatasets ? (
                  <Loader2 className="mr-2 size-3 animate-spin" />
                ) : (
                  <Database className="mr-2 size-3" />
                )}

                <SelectValue placeholder="Selecione um dataset" />
              </SelectTrigger>

              <SelectContent>
                {datasets.map((ds: { id: string; name: string }) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedExecutionDataset}
              onValueChange={(value) => {
                void handleExecutionDatasetChange(value)
              }}
              disabled={!selectedDataset || loadingDatasets || savingExecutionDataset}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-64">
                {savingExecutionDataset ? (
                  <Loader2 className="mr-2 size-3 animate-spin" />
                ) : (
                  <Database className="mr-2 size-3" />
                )}

                <SelectValue placeholder="Dataset de execucao" />
              </SelectTrigger>

              <SelectContent>
                {datasets.map((ds: { id: string; name: string }) => (
                  <SelectItem key={`execution-${ds.id}`} value={ds.id}>
                    {ds.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isLoadingSchema && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {loadingFixedCatalog
                  ? "Carregando catalogo salvo..."
                  : "Carregando metadados..."}
              </div>
            )}

            {selectedDataset &&
              selectedExecutionDataset &&
              selectedExecutionDataset !== selectedDataset && (
                <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
                  Executando no dataset auxiliar
                </span>
              )}

            {selectedDataset && (
              <>
                <div className="ml-auto" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={importCatalogFromScanner}
                  disabled={importingScannerCatalog}
                >
                  {importingScannerCatalog ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Database className="size-3" />
                  )}
                  Importar Scanner API
                </Button>
              </>
            )}

            {selectedWorkspace && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={importWorkspaceCatalogsFromScanner}
                disabled={importingWorkspaceScannerCatalog}
              >
                {importingWorkspaceScannerCatalog ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Database className="size-3" />
                )}
                Importar Todos do Workspace
              </Button>
            )}
          </div>

          {!selectedDataset ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Database className="size-12 opacity-20" />
              <p className="text-sm font-medium">Selecione um workspace e dataset para comecar</p>
              <p className="text-xs">Escolha os campos que deseja consultar e crie sua automacao</p>
            </div>
          ) : datasetsError ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <AlertCircle className="mb-3 size-12 opacity-30" />
              <p className="text-sm font-medium">Erro ao carregar datasets</p>
              <p className="text-xs">{datasetsError.message}</p>
            </div>
          ) : isLoadingSchema ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : schemaError ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <AlertCircle className="mb-3 size-12 opacity-30" />
              <p className="text-sm font-medium">Erro ao carregar metadados do dataset</p>
              <p className="text-xs">{schemaError.message}</p>
            </div>
          ) : !tables.length && !columns.length ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <AlertCircle className="mb-3 size-12 opacity-30" />
              <p className="text-sm font-medium">Nenhum metadado encontrado</p>
            </div>
          ) : (
            <>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 md:hidden">
                <TablesPanel
                  tables={tables}
                  columns={columns}
                  selectedColumns={selectedColumns}
                  filters={filters}
                  activeTableName={activeTableName}
                  onToggleColumn={toggleColumn}
                  onAddFilter={addFilter}
                  onActivateTable={activateTable}
                  showHidden={showHidden}
                  onToggleHidden={() => setShowHidden((prev) => !prev)}
                />

                <MeasuresPanel
                  measures={measures}
                  selectedMeasures={selectedMeasures}
                  linkedTableNames={linkedTableNames}
                  onToggleMeasure={toggleMeasure}
                />

                <FiltersPanel
                  quickFilters={quickFilters}
                  onAddQuickFilter={addQuickFilter}
                  filters={filters}
                  datasetId={selectedDataset}
                  executionDatasetId={selectedExecutionDataset || selectedDataset}
                  executionWorkspaceId={pbiWorkspaceId || null}
                  autoOpenFilterSignal={autoOpenFilterSignal}
                  onUpdateFilter={updateFilter}
                  onRemoveFilter={removeFilter}
                  onClearAll={() => {
                    setFilters([])
                    setAutoOpenFilterSignal(null)
                  }}
                />

                <ResultsPanel
                  selectedColumns={selectedColumns}
                  selectedMeasures={selectedMeasures}
                  daxQuery={daxQuery}
                  result={result}
                  reportHtml={reportHtml}
                  isExecuting={isExecuting}
                  onExecute={executeQuery}
                  onGeneratePdf={handleGeneratePdf}
                  onRemoveColumn={toggleColumn}
                  onRemoveMeasure={toggleMeasure}
                />
              </div>

              <ResizablePanelGroup direction="horizontal" className="hidden flex-1 md:flex">
                <ResizablePanel defaultSize={22} minSize={15}>
                  <TablesPanel
                    tables={tables}
                    columns={columns}
                    selectedColumns={selectedColumns}
                    filters={filters}
                    activeTableName={activeTableName}
                    onToggleColumn={toggleColumn}
                    onAddFilter={addFilter}
                    onActivateTable={activateTable}
                    showHidden={showHidden}
                    onToggleHidden={() => setShowHidden((prev) => !prev)}
                  />
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize={20} minSize={12}>
                  <MeasuresPanel
                    measures={measures}
                    selectedMeasures={selectedMeasures}
                    linkedTableNames={linkedTableNames}
                    onToggleMeasure={toggleMeasure}
                  />
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize={20} minSize={12}>
                  <FiltersPanel
                    quickFilters={quickFilters}
                    onAddQuickFilter={addQuickFilter}
                    filters={filters}
                    datasetId={selectedDataset}
                    executionDatasetId={selectedExecutionDataset || selectedDataset}
                    executionWorkspaceId={pbiWorkspaceId || null}
                    autoOpenFilterSignal={autoOpenFilterSignal}
                    onUpdateFilter={updateFilter}
                    onRemoveFilter={removeFilter}
                    onClearAll={() => {
                      setFilters([])
                      setAutoOpenFilterSignal(null)
                    }}
                  />
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize={38} minSize={25}>
                  <ResultsPanel
                    selectedColumns={selectedColumns}
                    selectedMeasures={selectedMeasures}
                    daxQuery={daxQuery}
                    result={result}
                    reportHtml={reportHtml}
                    isExecuting={isExecuting}
                    onExecute={executeQuery}
                    onGeneratePdf={handleGeneratePdf}
                    onRemoveColumn={toggleColumn}
                    onRemoveMeasure={toggleMeasure}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </>
          )}
        </>
      )}

      {activeTab === "saved" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <SavedAutomationsList />
        </div>
      )}
    </div>
  )
}
