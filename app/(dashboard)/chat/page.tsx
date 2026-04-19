"use client"

import { useState } from "react"
import useSWR from "swr"
import { Bot, Database, Loader2, AlertCircle } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ChatInterface } from "@/components/chat/chat-interface"
import type { Workspace } from "@/lib/types"

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || "Falha ao carregar")
  return data
}

export default function ChatPage() {
  const [selectedWorkspace, setSelectedWorkspace] = useState("")
  const [selectedDataset, setSelectedDataset] = useState("")
  const [selectedDatasetName, setSelectedDatasetName] = useState("")

  const { data: rawWorkspaces } = useSWR("/api/workspaces", fetcher)
  const workspaces: Workspace[] = Array.isArray(rawWorkspaces) ? rawWorkspaces : []

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
  const datasets: Array<{ id: string; name: string }> = Array.isArray(rawDatasets)
    ? rawDatasets
    : []

  const handleWorkspaceChange = (value: string) => {
    setSelectedWorkspace(value)
    setSelectedDataset("")
    setSelectedDatasetName("")
  }

  const handleDatasetChange = (value: string) => {
    const ds = datasets.find((d) => d.id === value)
    setSelectedDataset(value)
    setSelectedDatasetName(ds?.name ?? "")
  }

  const isReady = !!selectedDataset && !!pbiWorkspaceId

  return (
    <div className="flex h-[calc(100vh-1rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1 sm:hidden" />
          <Bot className="size-5 text-primary" />
          <h1 className="text-base font-bold sm:text-lg">Chat IA</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            BETA
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
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
              {datasets.map((ds) => (
                <SelectItem key={ds.id} value={ds.id}>
                  {ds.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {!selectedWorkspace ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Bot className="size-14 opacity-20" />
            <p className="text-sm font-medium">Selecione um workspace e dataset para comecar</p>
            <p className="text-xs opacity-70">O chat analisara os dados do dataset selecionado</p>
          </div>
        ) : datasetsError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <AlertCircle className="size-12 opacity-30" />
            <p className="text-sm font-medium">Erro ao carregar datasets</p>
            <p className="text-xs">{datasetsError.message}</p>
          </div>
        ) : !selectedDataset ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Database className="size-12 opacity-20" />
            <p className="text-sm font-medium">Selecione um dataset para iniciar o chat</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {isReady && (
              <ChatInterface
                datasetId={selectedDataset}
                workspaceId={pbiWorkspaceId!}
                datasetName={selectedDatasetName}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
