"use client"

import useSWR from "swr"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { DispatchChart } from "@/components/dashboard/dispatch-chart"
import { DispatchStatusPie } from "@/components/dashboard/dispatch-status-pie"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { UpcomingDispatches } from "@/components/dashboard/upcoming-dispatches"
import { DispatchCalendar } from "@/components/dashboard/dispatch-calendar"
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

export default function DashboardPage() {
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
              whatsappConnected: stats?.whatsappConnected ?? false,
              connectedWhatsAppInstances: stats?.connectedWhatsAppInstances ?? 0,
              totalWhatsAppInstances: stats?.totalWhatsAppInstances ?? 0,
              dispatchesToday: stats?.dispatchesToday ?? 0,
              successRate: stats?.successRate ?? null,
              completed30d: stats?.completed30d ?? 0,
              delivered30d: stats?.delivered30d ?? 0,
              failed30d: stats?.failed30d ?? 0,
              ongoing30d: stats?.ongoing30d ?? 0,
              pbiConfigured: stats?.pbiConfigured ?? false,
              n8nConfigured: stats?.n8nConfigured ?? false,
            }}
          />
        )}

        {statsLoading ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_440px] 2xl:grid-cols-[minmax(0,1.7fr)_500px]">
            <Skeleton className="h-[380px] rounded-xl" />
            <Skeleton className="h-[380px] rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_440px] 2xl:grid-cols-[minmax(0,1.7fr)_500px]">
            <DispatchChart data={stats?.chartData ?? []} />
            <DispatchStatusPie data={stats?.statusBreakdown30d ?? []} />
          </div>
        )}

        {statsLoading || logsLoading ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-[420px] rounded-xl" />
            <Skeleton className="h-[420px] rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <RecentDispatches logs={logsData?.data ?? []} mode="table" />
            <UpcomingDispatches items={stats?.nextDispatches ?? []} />
          </div>
        )}

        <DispatchCalendar />
      </div>
    </div>
  )
}
