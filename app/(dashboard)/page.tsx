"use client"

import useSWR from "swr"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { DispatchChart } from "@/components/dashboard/dispatch-chart"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { Skeleton } from "@/components/ui/skeleton"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Erro ao buscar ${url}: ${response.status}`)
  }
  return response.json()
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSWR("/api/stats", fetcher, {
    refreshInterval: 30000,
  })
  const { data: logsData, isLoading: logsLoading } = useSWR(
    "/api/logs?limit=10",
    fetcher,
    { refreshInterval: 30000 }
  )

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Dashboard"
        description="Visao geral dos disparos e metricas"
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        {statsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
        ) : (
          <StatsCards
            data={{
              totalReports: stats?.totalReports ?? 0,
              activeContacts: stats?.activeContacts ?? 0,
              dispatchesToday: stats?.dispatchesToday ?? 0,
              successRate: stats?.successRate ?? 100,
              pbiConfigured: stats?.pbiConfigured ?? false,
              n8nConfigured: stats?.n8nConfigured ?? false,
            }}
          />
        )}

        {statsLoading ? (
          <Skeleton className="h-[380px] rounded-xl" />
        ) : (
          <DispatchChart data={stats?.chartData ?? []} />
        )}

        {logsLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : (
          <RecentDispatches logs={logsData?.data ?? []} />
        )}
      </div>
    </div>
  )
}
