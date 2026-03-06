"use client"

import { useState, useCallback, useMemo } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import {
  Workflow,
  Loader2,
  AlertCircle,
  Database,
  Play,
  Send,
  CalendarClock,
  Save,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { toast } from "sonner"
import { SidebarTrigger } from "@/components/ui/sidebar"
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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function AutomationsPage() {
  const [activeTab, setActiveTab] = useState("builder")
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("")
  const [selectedDataset, setSelectedDataset] = useState<string>("")
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([])
  const [selectedMeasures, setSelectedMeasures] = useState<SelectedMeasure[]>([])
  const [filters, setFilters] = useState<QueryFilter[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [result, setResult] = useState<DAXQueryResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  const { data: rawWorkspaces } = useSWR("/api/workspaces", fetcher)
  const { data: rawContacts } = useSWR("/api/contacts", fetcher)
  const workspaces: Workspace[] = Array.isArray(rawWorkspaces) ? rawWorkspaces : []
  const contacts: Contact[] = Array.isArray(rawContacts) ? rawContacts : []

  const selectedWs = workspaces.find((w) => w.id === selectedWorkspace)
  const pbiWorkspaceId = selectedWs?.pbi_workspace_id

  const { data: rawDatasets, isLoading: loadingDatasets } = useSWR(
    pbiWorkspaceId ? `/api/powerbi/datasets?workspaceId=${pbiWorkspaceId}` : null,
    fetcher
  )
  const datasets = Array.isArray(rawDatasets) ? rawDatasets : []

  const { data: metadata, isLoading: loadingMetadata } = useSWR<{
    tables: DatasetTable[]
    columns: DatasetColumn[]
    measures: DatasetMeasure[]
  }>(
    selectedDataset ? `/api/powerbi/metadata?datasetId=${selectedDataset}` : null,
    fetcher
  )

  const tables = metadata?.tables || []
  const columns = metadata?.columns || []
  const measures = metadata?.measures || []

  const daxQuery = useMemo(
    () => buildDAXQuery(selectedColumns, selectedMeasures, filters),
    [selectedColumns, selectedMeasures, filters]
  )

  const hasQuery = !!daxQuery && !daxQuery.startsWith("--")

  const toggleColumn = useCallback((tableName: string, columnName: string) => {
    setSelectedColumns((prev) => {
      const exists = prev.some((c) => c.tableName === tableName && c.columnName === columnName)
      if (exists) return prev.filter((c) => !(c.tableName === tableName && c.columnName === columnName))
      return [...prev, { tableName, columnName }]
    })
  }, [])

  const toggleMeasure = useCallback((tableName: string, measureName: string) => {
    setSelectedMeasures((prev) => {
      const exists = prev.some((m) => m.tableName === tableName && m.measureName === measureName)
      if (exists) return prev.filter((m) => !(m.tableName === tableName && m.measureName === measureName))
      return [...prev, { tableName, measureName }]
    })
  }, [])

  const addFilter = useCallback((tableName: string, columnName: string, dataType: string) => {
    setFilters((prev) => [
      ...prev,
      { id: crypto.randomUUID(), tableName, columnName, operator: "eq", value: "", dataType },
    ])
  }, [])

  const updateFilter = useCallback((id: string, field: string, value: string) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }, [])

  const removeFilter = useCallback((id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const executeQuery = async () => {
    if (!selectedDataset || !hasQuery) return
    setIsExecuting(true)
    try {
      const res = await fetch("/api/powerbi/execute-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId: selectedDataset, query: daxQuery }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      toast.success(`Query executada: ${data.rows?.length || 0} linhas`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao executar query")
    } finally {
      setIsExecuting(false)
    }
  }

  const handleSave = async (saveData: {
    name: string
    cron_expression: string | null
    export_format: string
    message_template: string
    contact_ids: string[]
  }) => {
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
    if (!res.ok) throw new Error(data.error)
    toast.success("Automacao salva com sucesso!")
    globalMutate("/api/automations")
  }

  const handleWorkspaceChange = (value: string) => {
    setSelectedWorkspace(value)
    setSelectedDataset("")
    setSelectedColumns([])
    setSelectedMeasures([])
    setFilters([])
    setResult(null)
  }

  const handleDatasetChange = (value: string) => {
    setSelectedDataset(value)
    setSelectedColumns([])
    setSelectedMeasures([])
    setFilters([])
    setResult(null)
  }

  return (
    <div className="flex h-[calc(100vh-1rem)] flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 sm:hidden" />
          <Workflow className="size-5 text-primary" />
          <h1 className="text-base font-bold sm:text-lg">Automacoes</h1>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="ml-2">
          <TabsList className="h-8">
            <TabsTrigger value="builder" className="gap-1.5 text-xs">
              <Database className="size-3" />
              <span className="hidden sm:inline">Query Builder</span>
              <span className="sm:hidden">Builder</span>
            </TabsTrigger>
            <TabsTrigger value="saved" className="gap-1.5 text-xs">
              <ListFilter className="size-3" />
              <span className="hidden sm:inline">Automacoes Salvas</span>
              <span className="sm:hidden">Salvas</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-2">
          {activeTab === "builder" && (
            <>
              {/* Dispatch now */}
              <DispatchDialog
                contacts={contacts}
                daxQuery={daxQuery}
                datasetId={selectedDataset}
                disabled={!hasQuery}
              />
              {/* Schedule */}
              <ScheduleDialog
                contacts={contacts}
                onSave={handleSave}
                disabled={!hasQuery}
              />
              {/* Save */}
              <SaveAutomationDialog
                contacts={contacts}
                onSave={handleSave}
                disabled={!hasQuery}
              />
            </>
          )}
        </div>
      </div>

      {/* Builder Tab Content */}
      {activeTab === "builder" && (
        <>
          {/* Workspace/Dataset selectors */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 sm:px-4">
            <Select value={selectedWorkspace} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-48">
                <SelectValue placeholder="Selecione um workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
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
                  <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {loadingMetadata && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Carregando metadados...
              </div>
            )}
          </div>

          {/* 4-Panel Builder */}
          {!selectedDataset ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Database className="size-12 opacity-20" />
              <p className="text-sm font-medium">Selecione um workspace e dataset para comecar</p>
              <p className="text-xs">Escolha os campos que deseja consultar e crie sua automacao</p>
            </div>
          ) : loadingMetadata ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : metadata && !metadata.tables?.length && !metadata.columns?.length ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <AlertCircle className="mb-3 size-12 opacity-30" />
              <p className="text-sm font-medium">Nenhum metadado encontrado</p>
            </div>
          ) : (
            <>
              {/* Mobile stacked */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 md:hidden">
                <TablesPanel tables={tables} columns={columns} selectedColumns={selectedColumns} onToggleColumn={toggleColumn} onAddFilter={addFilter} showHidden={showHidden} onToggleHidden={() => setShowHidden((p) => !p)} />
                <MeasuresPanel measures={measures} selectedMeasures={selectedMeasures} onToggleMeasure={toggleMeasure} />
                <FiltersPanel filters={filters} onUpdateFilter={updateFilter} onRemoveFilter={removeFilter} onClearAll={() => setFilters([])} />
                <ResultsPanel selectedColumns={selectedColumns} selectedMeasures={selectedMeasures} daxQuery={daxQuery} result={result} isExecuting={isExecuting} onExecute={executeQuery} onRemoveColumn={toggleColumn} onRemoveMeasure={toggleMeasure} />
              </div>
              {/* Desktop resizable */}
              <ResizablePanelGroup direction="horizontal" className="hidden flex-1 md:flex">
                <ResizablePanel defaultSize={22} minSize={15}>
                  <TablesPanel tables={tables} columns={columns} selectedColumns={selectedColumns} onToggleColumn={toggleColumn} onAddFilter={addFilter} showHidden={showHidden} onToggleHidden={() => setShowHidden((p) => !p)} />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={20} minSize={12}>
                  <MeasuresPanel measures={measures} selectedMeasures={selectedMeasures} onToggleMeasure={toggleMeasure} />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={20} minSize={12}>
                  <FiltersPanel filters={filters} onUpdateFilter={updateFilter} onRemoveFilter={removeFilter} onClearAll={() => setFilters([])} />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={38} minSize={25}>
                  <ResultsPanel selectedColumns={selectedColumns} selectedMeasures={selectedMeasures} daxQuery={daxQuery} result={result} isExecuting={isExecuting} onExecute={executeQuery} onRemoveColumn={toggleColumn} onRemoveMeasure={toggleMeasure} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </>
          )}
        </>
      )}

      {/* Saved Tab Content */}
      {activeTab === "saved" && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <SavedAutomationsList />
        </div>
      )}
    </div>
  )
}
