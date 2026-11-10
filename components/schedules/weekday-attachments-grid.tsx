"use client"

// Grade de anexos por dia da semana (chave "Por dia da semana" no campo Anexos).
// Cada dia tem as suas imagens/PDFs; em cada horario da rotina vai o anexo do dia.
import { useRef, useState } from "react"
import { FileText, Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import {
  MAX_ATTACHMENTS_PER_DAY,
  WEEKDAY_ATTACHMENT_DAYS,
  getAttachmentFileName,
  isPdfAttachmentUrl,
} from "@/lib/weekday-attachments"

interface WeekdayAttachmentsGridProps {
  days: Record<string, string[]>
  onChange: (days: Record<string, string[]>) => void
  // Sobe o arquivo e devolve o link (mesmo envio do campo de anexos normal)
  upload: (file: File) => Promise<string>
}

export function WeekdayAttachmentsGrid({ days, onChange, upload }: WeekdayAttachmentsGridProps) {
  const [diaSubindo, setDiaSubindo] = useState<number | null>(null)
  const seletor = useRef<HTMLInputElement>(null)
  const diaEscolhido = useRef<number | null>(null)

  function escolherArquivo(dia: number) {
    diaEscolhido.current = dia
    seletor.current?.click()
  }

  async function receberArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    const dia = diaEscolhido.current
    e.target.value = ""
    if (!arquivo || dia === null) return

    setDiaSubindo(dia)
    try {
      const link = await upload(arquivo)
      const atuais = days[String(dia)] ?? []
      onChange({ ...days, [String(dia)]: [...atuais, link] })
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Erro ao anexar o arquivo")
    } finally {
      setDiaSubindo(null)
    }
  }

  function remover(dia: number, indice: number) {
    const restantes = (days[String(dia)] ?? []).filter((_, i) => i !== indice)
    const proximo = { ...days }
    if (restantes.length > 0) proximo[String(dia)] = restantes
    else delete proximo[String(dia)]
    onChange(proximo)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-2">
        {WEEKDAY_ATTACHMENT_DAYS.map(({ day, short }) => {
          const anexos = days[String(day)] ?? []
          return (
            <div
              key={day}
              data-dia={day}
              className="flex min-h-[110px] flex-col gap-1.5 rounded-lg border bg-muted/20 p-2"
            >
              <p className="text-center text-xs font-semibold">{short}</p>
              {anexos.map((link, indice) => (
                <div key={link} className="relative">
                  {isPdfAttachmentUrl(link) ? (
                    <div
                      className="flex h-12 flex-col items-center justify-center rounded bg-muted px-1"
                      title={getAttachmentFileName(link)}
                    >
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                        {getAttachmentFileName(link)}
                      </span>
                    </div>
                  ) : (
                    <img src={link} alt={`Anexo de ${short}`} className="h-12 w-full rounded object-cover" />
                  )}
                  <button
                    type="button"
                    title="Remover"
                    aria-label={`Remover anexo de ${short}`}
                    onClick={() => remover(day, indice)}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-white shadow"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {anexos.length < MAX_ATTACHMENTS_PER_DAY ? (
                <button
                  type="button"
                  title={`Anexar para ${short}`}
                  aria-label={`Anexar para ${short}`}
                  data-testid={`anexar-dia-${day}`}
                  onClick={() => escolherArquivo(day)}
                  disabled={diaSubindo !== null}
                  className="mt-auto flex h-8 items-center justify-center rounded border border-dashed text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  {diaSubindo === day ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      <input
        ref={seletor}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,application/pdf,.pdf"
        className="hidden"
        data-testid="anexo-dia-arquivo"
        onChange={receberArquivo}
      />
      <p className="text-xs text-muted-foreground">
        Em cada horario da rotina, vai o anexo do dia. Continua toda semana ate ser removido. Dia sem
        anexo: nao envia nada naquele dia.
      </p>
    </div>
  )
}
