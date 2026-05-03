"use client"

import useSWR from "swr"
import { PageHeader } from "@/components/dashboard/page-header"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { Skeleton } from "@/components/ui/skeleton"

type FetchError = Error & { status?: number }

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })

  if (response.status === 401) {
    const error = new Error(`Sessao expirada ao buscar ${url}`) as FetchError
    error.status = 401
    throw error
  }

  if (!response.ok) {
    const error = new Error(`Erro ao buscar ${url}: ${response.status}`) as FetchError
    error.status = response.status
    throw error
  }

  return response.json()
}

export default function OperationalSummaryPage() {
  const swrOptions = {
    refreshInterval: 30000,
    revalidateOnFocus: false,
    shouldRetryOnError: (error: FetchError) => error.status !== 401,
  }

  const { data: stats, isLoading: statsLoading } = useSWR("/api/stats", fetcher, swrOptions)
  const { data: logsData, isLoading: logsLoading } = useSWR(
    "/api/logs?limit=20",
    fetcher,
    swrOptions
  )

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Resumo operacional"
        description="Painel de acompanhamento da agenda de disparos e da execucao das rotinas do dia."
      />

      <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        {logsLoading || statsLoading ? (
          <Skeleton className="h-[520px] rounded-xl" />
        ) : (
          <RecentDispatches
            logs={logsData?.data ?? []}
            scheduleSummary={stats?.scheduleDispatchSummary ?? null}
            showReportColumn={false}
          />
        )}
      </div>
    </div>
  )
}
