"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"]

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

type DayData = {
  delivered: number
  failed: number
  ongoing: number
  entries: Array<{
    id: string
    scheduleId: string | null
    reportName: string
    contactName: string
    exportFormat: string | null
    status: string
    outcome: "delivered" | "failed" | "ongoing"
    errorMessage: string | null
    effectiveAt: string | null
  }>
}

type CalendarApiResponse = {
  days: Record<string, DayData>
  totals: { delivered: number; failed: number; ongoing: number }
}

type FetchError = Error & { status?: number }

const fetcher = async (url: string): Promise<CalendarApiResponse> => {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const err = new Error("Erro ao buscar calendario") as FetchError
    err.status = res.status
    throw err
  }
  return res.json()
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  // 0 = Sunday
  return new Date(year, month - 1, 1).getDay()
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function getBrazilToday() {
  const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000
  const now = new Date()
  const brazilNow = new Date(now.getTime() - BRAZIL_OFFSET_MS)
  return {
    year: brazilNow.getUTCFullYear(),
    month: brazilNow.getUTCMonth() + 1,
    day: brazilNow.getUTCDate(),
  }
}

function DayCell({
  day,
  data,
  isToday,
  isPast,
}: {
  day: number
  data: DayData | undefined
  isToday: boolean
  isPast: boolean
}) {
  const total = data ? data.delivered + data.failed + data.ongoing : 0
  const hasData = total > 0
  const successRate =
    hasData && data && data.delivered + data.failed > 0
      ? Math.round((data.delivered / (data.delivered + data.failed)) * 100)
      : null
  const previewEntries = data?.entries.slice(0, 2) ?? []
  const remainingEntries = (data?.entries.length ?? 0) - previewEntries.length

  return (
    <div
      className={[
        "relative flex flex-col gap-2 rounded-lg border p-2 min-h-[120px] text-xs transition-colors",
        isToday
          ? "border-amber-600/60 bg-amber-950/40"
          : isPast
            ? "border-border/50 bg-muted/10"
            : "border-border/30 bg-transparent",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={[
            "text-sm font-semibold leading-none",
            isToday ? "text-amber-400" : "text-foreground",
          ].join(" ")}
        >
          {day}
        </span>
        {successRate !== null && (
          <span
            className={[
              "text-[10px] font-medium leading-none tabular-nums",
              successRate >= 80
                ? "text-emerald-400"
                : successRate >= 50
                  ? "text-amber-400"
                  : "text-red-400",
            ].join(" ")}
          >
            {successRate}%
          </span>
        )}
      </div>

      {hasData && data ? (
        <div className="mt-auto flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground">Enviados</span>
            <span className="ml-auto tabular-nums text-[10px] font-medium text-foreground">
              {data.delivered}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground">Falhas</span>
            <span className="ml-auto tabular-nums text-[10px] font-medium text-foreground">
              {data.failed}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground">Andamento</span>
            <span className="ml-auto tabular-nums text-[10px] font-medium text-foreground">
              {data.ongoing}
            </span>
          </div>
          {previewEntries.length > 0 ? (
            <div className="mt-1 space-y-1 border-t border-border/40 pt-1.5">
              {previewEntries.map((entry) => (
                <div key={entry.id} className="rounded-md bg-muted/20 px-1.5 py-1">
                  <p className="truncate text-[10px] font-medium text-foreground">
                    {entry.reportName}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {entry.contactName}
                  </p>
                </div>
              ))}
              {remainingEntries > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  +{remainingEntries} outro(s) disparo(s)
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-auto text-[10px] text-muted-foreground/60">Sem envios</p>
      )}
    </div>
  )
}

export function DispatchCalendar() {
  const today = getBrazilToday()
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)

  const { data, isLoading } = useSWR<CalendarApiResponse>(
    `/api/calendar?year=${year}&month=${month}`,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false }
  )

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDow = getFirstDayOfWeek(year, month)
    const cells: (number | null)[] = []

    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)

    // Pad end to fill last row
    while (cells.length % 7 !== 0) cells.push(null)

    return cells
  }, [year, month])

  function prevMonth() {
    if (month === 1) {
      setYear((y) => y - 1)
      setMonth(12)
    } else {
      setMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear((y) => y + 1)
      setMonth(1)
    } else {
      setMonth((m) => m + 1)
    }
  }

  const totals = data?.totals ?? { delivered: 0, failed: 0, ongoing: 0 }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 pt-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold">Calendário de Disparos</h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              {totals.delivered} enviados
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              {totals.failed} falharam
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              {totals.ongoing} em andamento
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-7" onClick={prevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium min-w-[130px] text-center">
            {MONTH_NAMES[month - 1]} de {year}
          </span>
          <Button variant="ghost" size="icon" className="size-7" onClick={nextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 sm:px-6">
        {isLoading ? (
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="text-center text-[11px] font-medium text-muted-foreground py-1">
                {WEEKDAYS[i]}
              </div>
            ))}
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="text-center text-[11px] font-medium text-muted-foreground py-1"
              >
                {wd}
              </div>
            ))}
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="min-h-[90px]" />
              }

              const dateKey = toDateKey(year, month, day)
              const isToday =
                year === today.year && month === today.month && day === today.day
              const todayKey = toDateKey(today.year, today.month, today.day)
              const isPast = dateKey < todayKey

              return (
                <DayCell
                  key={dateKey}
                  day={day}
                  data={data?.days[dateKey]}
                  isToday={isToday}
                  isPast={isPast}
                />
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
