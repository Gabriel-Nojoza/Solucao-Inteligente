"use client"

import { useState } from "react"
import useSWR from "swr"
import { Bot, X, ChevronDown, Database, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChatInterface } from "./chat-interface"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/lib/types"

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || "Erro")
  return data
}

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [selectedWorkspace, setSelectedWorkspace] = useState("")
  const [selectedDataset, setSelectedDataset] = useState("")
  const [selectedDatasetName, setSelectedDatasetName] = useState("")

  const { data: rawWorkspaces } = useSWR(open ? "/api/workspaces" : null, fetcher)
  const workspaces: Workspace[] = Array.isArray(rawWorkspaces) ? rawWorkspaces : []

  const selectedWs = workspaces.find((w) => w.id === selectedWorkspace)
  const pbiWorkspaceId = selectedWs?.pbi_workspace_id

  const { data: rawDatasets, isLoading: loadingDatasets } = useSWR(
    open && pbiWorkspaceId ? `/api/powerbi/datasets?workspaceId=${pbiWorkspaceId}` : null,
    fetcher
  )
  const datasets: Array<{ id: string; name: string }> = Array.isArray(rawDatasets) ? rawDatasets : []

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
    <>
      {/* Painel deslizante */}
      <div
        className={cn(
          "fixed bottom-20 right-4 z-50 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-all duration-300 ease-in-out",
          open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        )}
        style={{ height: "600px", maxHeight: "calc(100vh - 100px)" }}
      >
        {/* Header do painel */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-semibold">Chat IA</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            BETA
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Seletor de workspace */}
            <Select value={selectedWorkspace} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-7 w-32 text-[11px]">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id} className="text-xs">
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Seletor de dataset */}
            <Select
              value={selectedDataset}
              onValueChange={handleDatasetChange}
              disabled={!selectedWorkspace || loadingDatasets}
            >
              <SelectTrigger className="h-7 w-36 text-[11px]">
                {loadingDatasets ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <Database className="mr-1 size-3" />
                )}
                <SelectValue placeholder="Dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((ds) => (
                  <SelectItem key={ds.id} value={ds.id} className="text-xs">
                    {ds.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Corpo do chat */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {!isReady ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Database className="size-10 opacity-20" />
              <p className="text-xs font-medium">
                {!selectedWorkspace
                  ? "Selecione um workspace e dataset"
                  : "Selecione um dataset para começar"}
              </p>
            </div>
          ) : (
            <ChatInterface
              datasetId={selectedDataset}
              workspaceId={pbiWorkspaceId!}
              datasetName={selectedDatasetName}
            />
          )}
        </div>
      </div>

      {/* Botão flutuante (FAB) */}
      <Button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "fixed bottom-4 right-4 z-50 size-14 rounded-full shadow-lg transition-all duration-200",
          open && "rotate-0"
        )}
        size="icon"
        aria-label="Abrir Chat IA"
      >
        {open ? (
          <ChevronDown className="size-6" />
        ) : (
          <Bot className="size-6" />
        )}
      </Button>
    </>
  )
}
