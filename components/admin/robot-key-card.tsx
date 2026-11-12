"use client"

// Chave do robo de relatorios (Admin > Configuracoes). O robo instalado no
// computador do cliente usa essa chave para enviar o relatorio baixado (ex.:
// do WinThor). A chave aparece uma vez so, quando e gerada. Ver lib/robot-key.ts.
import { useState } from "react"
import useSWR from "swr"
import { Bot, Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type RobotKeyInfo = { exists: boolean; created_at: string | null; hint: string | null }

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || "Erro ao carregar")
  return data as RobotKeyInfo
}

function formatDate(value: string | null) {
  if (!value) return "data desconhecida"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "data desconhecida"
    : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function RobotKeyCard({ className }: { className?: string }) {
  const { data, error, isLoading, mutate } = useSWR("/api/robot-key", fetcher)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  async function generate() {
    if (
      data?.exists &&
      !window.confirm(
        "Gerar uma chave nova? O robo que usa a chave atual para de enviar ate receber a nova."
      )
    ) {
      return
    }

    setGenerating(true)
    try {
      const res = await fetch("/api/robot-key", { method: "POST" })
      const body = (await res.json()) as { key?: string; error?: string }
      if (!res.ok || !body.key) throw new Error(body.error || "Nao foi possivel gerar a chave")
      setNewKey(body.key)
      await mutate()
      toast.success("Chave gerada. Copie agora: ela nao aparece de novo.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nao foi possivel gerar a chave")
    } finally {
      setGenerating(false)
    }
  }

  async function copyKey() {
    if (!newKey) return
    try {
      await navigator.clipboard.writeText(newKey)
      toast.success("Chave copiada")
    } catch {
      toast.error("Nao deu para copiar. Selecione a chave e copie com Ctrl+C.")
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5 text-muted-foreground" />
          Robo de relatorios (WinThor)
        </CardTitle>
        <CardDescription>
          Chave que o robo instalado no computador do cliente usa para enviar o relatorio baixado
          (ex.: do WinThor). Ela so permite guardar arquivos desta empresa; nao envia mensagens.
          Depois, escolha a pasta na rotina, em &quot;Imagem automatica do robo&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground" data-testid="robot-key-status">
          {isLoading
            ? "Carregando..."
            : error
              ? "Nao foi possivel ver a chave agora."
              : data?.exists
                ? `Chave ativa, criada em ${formatDate(data.created_at)}${data.hint ? `, termina em ...${data.hint}` : ""}.`
                : "Nenhuma chave gerada ainda."}
        </p>

        {newKey ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <Label htmlFor="robot-key-new">Chave nova (copie agora, ela nao aparece de novo)</Label>
            <div className="flex gap-2">
              <Input
                id="robot-key-new"
                readOnly
                value={newKey}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={() => void copyKey()} className="shrink-0 gap-1.5">
                <Copy className="size-4" /> Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No computador do cliente, rode <code>npm run configurar</code> no robo e cole essa chave.
            </p>
          </div>
        ) : null}

        <div>
          <Button type="button" onClick={() => void generate()} disabled={generating || isLoading}>
            {generating ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {data?.exists ? "Gerar nova chave" : "Gerar chave do robo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
