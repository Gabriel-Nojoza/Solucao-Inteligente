"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { AlertCircle, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { DispatchChart } from "@/components/dashboard/dispatch-chart"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type FetchError = Error & { status?: number }

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; [key: string]: unknown }
    | null

  if (!response.ok) {
    const error = new Error(
      payload?.error || `Erro ao buscar ${url}: ${response.status}`
    ) as FetchError
    error.status = response.status
    throw error
  }

  return payload
}

export default function DashboardPage() {
  const [refreshing, setRefreshing] = useState(false)
  const isMountedRef = useRef(false)
  const swrOptions = {
    refreshInterval: 30000,
    revalidateOnFocus: false,
    shouldRetryOnError: (error: FetchError) => error.status !== 401,
  }

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  const {
    data: stats,
    error: statsError,
    isLoading: statsLoading,
    mutate: refreshStats,
  } = useSWR("/api/stats", fetcher, swrOptions)
  const {
    data: logsData,
    error: logsError,
    isLoading: logsLoading,
    mutate: refreshLogs,
  } = useSWR("/api/logs?limit=10", fetcher, swrOptions)

  async function handleRefresh() {
    if (isMountedRef.current) {
      setRefreshing(true)
    }

    try {
      await Promise.all([refreshStats(), refreshLogs()])
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false)
      }
    }
  }

  const hasStats = !!stats
  const hasLogs = !!logsData
  const showStatsSkeleton = statsLoading && !hasStats
  const showLogsSkeleton = logsLoading && !hasLogs

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Dashboard"
        description="Visao geral dos disparos e metricas"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        {statsError || logsError ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Alguns dados do dashboard nao puderam ser carregados</AlertTitle>
            <AlertDescription>
              <p>{statsError?.message ?? logsError?.message}</p>
              <p>
                Os blocos abaixo mostram apenas o que foi carregado com sucesso. Use
                Atualizar para tentar novamente.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {showStatsSkeleton ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[140px] rounded-xl" />
            ))}
          </div>
        ) : hasStats ? (
          <StatsCards
            data={{
              totalReports: Number(stats?.totalReports ?? 0),
              activeContacts: Number(stats?.activeContacts ?? 0),
              whatsappConnected: stats?.whatsappConnected === true,
              whatsappStatus:
                stats?.whatsappStatus === "starting" ||
                stats?.whatsappStatus === "awaiting_qr" ||
                stats?.whatsappStatus === "connected" ||
                stats?.whatsappStatus === "reconnecting" ||
                stats?.whatsappStatus === "offline" ||
                stats?.whatsappStatus === "error"
                  ? stats.whatsappStatus
                  : "offline",
              whatsappPhoneNumber:
                typeof stats?.whatsappPhoneNumber === "string"
                  ? stats.whatsappPhoneNumber
                  : null,
              whatsappDisplayName:
                typeof stats?.whatsappDisplayName === "string"
                  ? stats.whatsappDisplayName
                  : null,
              dispatchesToday: Number(stats?.dispatchesToday ?? 0),
              deliveredToday: Number(stats?.deliveredToday ?? 0),
              failedToday: Number(stats?.failedToday ?? 0),
              inProgressToday: Number(stats?.inProgressToday ?? 0),
              successRate:
                typeof stats?.successRate === "number" ? stats.successRate : null,
              completedDispatches30d: Number(stats?.completedDispatches30d ?? 0),
              pbiConfigured: stats?.pbiConfigured === true,
              n8nConfigured: stats?.n8nConfigured === true,
            }}
          />
        ) : null}

        {showStatsSkeleton ? (
          <Skeleton className="h-[380px] rounded-xl" />
        ) : hasStats ? (
          <DispatchChart
            data={Array.isArray(stats?.chartData) ? stats.chartData : []}
          />
        ) : null}

        {showLogsSkeleton ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : hasLogs ? (
          <RecentDispatches logs={Array.isArray(logsData?.data) ? logsData.data : []} />
        ) : null}
      </div>
    </div>
  )
}
