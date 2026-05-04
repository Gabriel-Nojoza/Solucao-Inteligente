"use client"

import useSWR from "swr"
import { useState } from "react"
import { MessageSquare } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/dashboard/page-header"
import type { ChatUsageResponse } from "@/app/api/admin/chat-usage/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatMesLabel(mes: string) {
  const [year, month] = mes.split("-")
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  return `${months[parseInt(month) - 1]}/${year}`
}

export default function ChatUsagePage() {
  const { data, isLoading } = useSWR<ChatUsageResponse>("/api/admin/chat-usage", fetcher)
  const [selectedMes, setSelectedMes] = useState<string>("")

  const meses = data?.meses ?? []
  const mesFiltro = selectedMes || meses[0] || ""

  const rows = (data?.rows ?? []).filter((r) => r.mes === mesFiltro)
  const totalPerguntas = rows.reduce((s, r) => s + r.perguntas, 0)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Uso do Chat por Empresa"
        description="Total de perguntas feitas por empresa em cada mês"
      />

      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <Select value={mesFiltro} onValueChange={setSelectedMes}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Selecionar mês" />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m} value={m}>{formatMesLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mesFiltro && (
            <span className="text-sm text-muted-foreground">
              {formatMesLabel(mesFiltro)} — {totalPerguntas} pergunta{totalPerguntas !== 1 ? "s" : ""} no total
            </span>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-500/10 p-2">
                <MessageSquare className="size-4 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-base">Perguntas por Empresa</CardTitle>
                <CardDescription className="text-xs">
                  {mesFiltro ? formatMesLabel(mesFiltro) : "Selecione um mês"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {isLoading ? (
              <div className="space-y-2 px-4 pb-4">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-muted-foreground">Nenhum dado para este mês</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Perguntas</th>
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">% do total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((r) => {
                      const percent = totalPerguntas > 0 ? Math.round((r.perguntas / totalPerguntas) * 100) : 0
                      return (
                        <tr key={r.companyId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{r.companyName}</td>
                          <td className="px-4 py-3 text-center font-bold">{r.perguntas}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-purple-500"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-8">{percent}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</td>
                      <td className="px-4 py-2.5 text-center font-bold text-sm">{totalPerguntas}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
