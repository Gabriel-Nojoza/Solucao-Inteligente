"use client"

import { useState } from "react"
import useSWR from "swr"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

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

const SP_TZ = "America/Sao_Paulo"

function todayDateString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: SP_TZ })
}

function formatDateLabel(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
}

export default function OperationalSummaryPage() {
  const [selectedDate, setSelectedDate] = useState(todayDateString())

  function changeDate(offset: number) {
    const [year, month, day] = selectedDate.split("-").map(Number)
    const date = new Date(year, month - 1, day + offset)
    setSelectedDate(date.toLocaleDateString("en-CA", { timeZone: SP_TZ }))
  }

  const todayStr = todayDateString()
  const isToday = selectedDate === todayStr
  const maxDate = (() => {
    const [y, m, d] = todayStr.split("-").map(Number)
    return new Date(y, m - 1, d + 7).toLocaleDateString("en-CA", { timeZone: SP_TZ })
  })()
  const isAtMaxDate = selectedDate >= maxDate

  const swrOptions = {
    refreshInterval: isToday ? 30000 : 0,
    revalidateOnFocus: false,
    shouldRetryOnError: (error: FetchError) => error.status !== 401,
    dedupingInterval: 60000,
  }

  const { data: stats, isLoading: statsLoading } = useSWR(
    `/api/stats?date=${selectedDate}`,
    fetcher,
    swrOptions
  )
  const { data: logsData, isLoading: logsLoading } = useSWR(
    `/api/logs?limit=20&date=${selectedDate}`,
    fetcher,
    swrOptions
  )

  return (
    <div className="flex flex-1 flex-col overflow-x-hidden">
      <PageHeader
        title="Resumo operacional"
        description="Painel de acompanhamento da agenda de disparos e da execucao das rotinas do dia."
      />

      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Button variant="outline" size="icon" onClick={() => changeDate(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[220px] text-center text-sm font-medium capitalize">
          {formatDateLabel(selectedDate)}
        </span>
        <Button variant="outline" size="icon" onClick={() => changeDate(1)} disabled={isAtMaxDate}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

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
