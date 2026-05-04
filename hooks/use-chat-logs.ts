import useSWR from "swr"
import type { CompanyStatItem } from "@/app/api/admin/company-stats/route"

export type ChatLogStat = {
  companyId: string
  companyName: string
  usoEsteMes: number
  excedente: number
  aCobrar: number | null
}

type CompanyStatsResponse = {
  companies: CompanyStatItem[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<CompanyStatsResponse>

export function useChatLogs() {
  const { data, error, isLoading } = useSWR<CompanyStatsResponse>(
    "/api/admin/company-stats",
    fetcher,
    { refreshInterval: 60_000 }
  )

  const stats: ChatLogStat[] = (data?.companies ?? []).map((c) => ({
    companyId: c.companyId,
    companyName: c.companyName,
    usoEsteMes: c.chatUsageThisMonth,
    excedente: c.chatOverage,
    aCobrar: c.chatOverageCharge,
  }))

  return { stats, isLoading, error }
}
