"use client"

// "Imagem automatica do robo" na rotina: arquivos que o robo instalado no
// computador do cliente envia (ex.: relatorio baixado do WinThor). No horario,
// vai o mais novo da pasta escolhida, junto com os anexos. Ver
// lib/robot-attachments.ts.
import { Bot, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FOLDER_REPORT_FORMATS,
  folderReportFormatLabel,
  type FolderReportConfig,
  type FolderReportFolderSummary,
  type FolderReportFormat,
} from "@/lib/folder-reports"

interface FolderReportsPickerProps {
  value: FolderReportConfig[]
  onChange: (value: FolderReportConfig[]) => void
  folders: FolderReportFolderSummary[] | undefined
  isLoading: boolean
  loadError: string | null
  hasError: boolean
  // A rotina tem relatorio do Power BI: a imagem vai logo depois dele.
  withPowerBi?: boolean
}

function formatReceivedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "data desconhecida"

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function FolderReportsPicker({
  value,
  onChange,
  folders,
  isLoading,
  loadError,
  hasError,
  withPowerBi = false,
}: FolderReportsPickerProps) {
  // Pastas recebidas + pastas ja escolhidas que nao aparecem mais na lista
  // (ex.: arquivos antigos apagados), para a escolha nao sumir da tela.
  const receivedFolders = folders ?? []
  const knownKeys = new Set(receivedFolders.map((folder) => folder.folder_key))
  const options: FolderReportFolderSummary[] = [
    ...receivedFolders,
    ...value
      .filter((config) => !knownKeys.has(config.folder_key))
      .map((config) => ({ folder_key: config.folder_key, folder_name: config.folder_name, latest: {} })),
  ]

  function toggleFormat(folder: FolderReportFolderSummary, format: FolderReportFormat, checked: boolean) {
    const current = value.find((config) => config.folder_key === folder.folder_key)
    const currentFormats = current?.formats ?? []
    const formats = FOLDER_REPORT_FORMATS.filter((item) =>
      item === format ? checked : currentFormats.includes(item)
    )

    const others = value.filter((config) => config.folder_key !== folder.folder_key)
    onChange(
      formats.length > 0
        ? [...others, { folder_key: folder.folder_key, folder_name: folder.folder_name, formats }]
        : others
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        Imagem automatica do robo (opcional)
      </Label>
      <p className="text-xs text-muted-foreground" data-testid="imagem-do-robo-explicacao">
        O robo do computador do cliente envia o arquivo baixado (ex.: do WinThor) sozinho, sem
        precisar trocar o anexo. No horario, vai o mais novo da pasta marcada, desde que tenha sido
        salvo hoje e ainda nao enviado por esta rotina. Se nao chegar, a imagem antiga nao vai e o
        historico mostra o motivo.
        {withPowerBi ? " Vai logo depois do relatorio do Power BI, antes dos anexos." : null}
      </p>

      <div
        className={`flex flex-col gap-2 rounded-xl border p-3 ${hasError ? "border-destructive" : ""}`}
      >
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando pastas...
          </div>
        ) : options.length === 0 ? (
          loadError ? null : (
            <p className="text-sm text-muted-foreground">
              Nenhum arquivo recebido do robo ainda. Instale o robo no computador do cliente e salve
              um arquivo PNG, JPG ou PDF na pasta dele.
            </p>
          )
        ) : (
          options.map((folder) => {
            const selected = value.find((config) => config.folder_key === folder.folder_key)

            return (
              <div
                key={folder.folder_key}
                className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{folder.folder_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {FOLDER_REPORT_FORMATS.map((format) => {
                      const latest = folder.latest[format]
                      return latest ? `${folderReportFormatLabel(format)}: ${formatReceivedAt(latest.file_saved_at)}` : null
                    })
                      .filter(Boolean)
                      .join(" · ") || "Nenhum arquivo guardado no momento"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {FOLDER_REPORT_FORMATS.map((format) => {
                    const id = `folder-${folder.folder_key}-${format}`
                    return (
                      <div key={format} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={selected?.formats.includes(format) ?? false}
                          onCheckedChange={(checked) => toggleFormat(folder, format, checked === true)}
                        />
                        <Label htmlFor={id} className="cursor-pointer text-sm">
                          {folderReportFormatLabel(format)}
                        </Label>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
