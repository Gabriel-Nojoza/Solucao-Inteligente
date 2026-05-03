"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/dashboard/page-header"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type {
  AdminOperationalCompanySummary,
  AdminOperationalSummaryResponse,
} from "@/app/api/admin/operational-summary/route"
import type {
  CompanyStatItem,
  CompanyStatsResponse,
} from "@/app/api/admin/company-stats/route"

type FetchError = Error & { status?: number }

const fetcher = async (url: string) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60000)
  let response: Response

  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const timeoutError = new Error(`Tempo excedido ao buscar ${url}`) as FetchError
      timeoutError.status = 408
      throw timeoutError
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  const body = await response.json().catch(() => null)

  if (response.status === 401) {
    const error = new Error(
      body?.error || `Sessao expirada ao buscar ${url}`
    ) as FetchError
    error.status = 401
    throw error
  }

  if (!response.ok) {
    const error = new Error(
      body?.error || `Erro ao buscar ${url}: ${response.status}`
    ) as FetchError
    error.status = response.status
    throw error
  }

  return body
}

function CompanySummaryContent({
  companyId,
  date,
  embedded = false,
}: {
  companyId: string
  date: string
  embedded?: boolean
}) {
  const swrOptions = {
    refreshInterval: 0,
    revalidateOnFocus: false,
    shouldRetryOnError: (error: FetchError) => error.status !== 401,
    dedupingInterval: 60000,
  }

  const { data, error, isLoading } = useSWR<AdminOperationalSummaryResponse>(
    `/api/admin/operational-summary?companyId=${companyId}&panel=1&date=${date}`,
    fetcher,
    swrOptions
  )

  const companySummary: AdminOperationalCompanySummary | null =
    data?.companies?.[0] ?? null

  if (isLoading && !data) {
    return <Skeleton className="h-[520px] rounded-xl" />
  }

  if (error && !companySummary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nao foi possivel carregar</CardTitle>
          <CardDescription>{error.message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!companySummary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sem dados</CardTitle>
          <CardDescription>
            Nenhum resumo operacional foi encontrado para esta empresa.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <RecentDispatches
      logs={companySummary.recentLogs}
      scheduleSummary={companySummary.scheduleDispatchSummary}
      embedded={embedded}
    />
  )
}

function CompanyHeader({
  company,
}: {
  company: CompanyStatItem
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-base font-semibold text-foreground">
          {company.companyName}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumo individual da agenda e dos disparos operacionais.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pr-2">
        <Badge variant="outline">
          {company.dispatchesThisMonth} no mes
        </Badge>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          {company.deliveredThisMonth} enviados
        </Badge>
        <Badge variant="outline" className="border-rose-500/30 text-rose-600 dark:text-rose-400">
          {company.failedThisMonth} erros
        </Badge>
        <Badge variant="outline">
          {company.successRate}% sucesso
        </Badge>
      </div>
    </div>
  )
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

export default function AdminOperationalSummaryPage() {
  const [selectedCompany, setSelectedCompany] = useState<CompanyStatItem | null>(null)
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

  const companyListSWR = {
    refreshInterval: 0,
    revalidateOnFocus: false,
    shouldRetryOnError: (error: FetchError) => error.status !== 401,
    dedupingInterval: 60000,
  }

  const {
    data: companyStatsData,
    error: companyStatsError,
    isLoading,
  } = useSWR<CompanyStatsResponse>(
    "/api/admin/company-stats?lite=1",
    fetcher,
    companyListSWR
  )

  const companies = companyStatsData?.companies ?? []
  const hasMultipleCompanies = companies.length > 1
  const singleCompany = companies[0] ?? null

  useEffect(() => {
    if (!hasMultipleCompanies) {
      return
    }

    if (!selectedCompany && companies.length > 0) {
      setSelectedCompany(companies[0])
      return
    }

    if (
      selectedCompany &&
      !companies.some((company) => company.companyId === selectedCompany.companyId)
    ) {
      setSelectedCompany(companies[0] ?? null)
    }
  }, [companies, hasMultipleCompanies, selectedCompany])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Resumo operacional"
        description={
          hasMultipleCompanies
            ? "Selecione uma empresa para ver o resumo operacional individual, sem misturar os dados."
            : "Painel individual da agenda de disparos e da execucao das rotinas da empresa visivel no admin."
        }
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
        {isLoading ? (
          <Skeleton className="h-[520px] rounded-xl" />
        ) : companyStatsError && !companyStatsData ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nao foi possivel carregar</CardTitle>
              <CardDescription>{companyStatsError.message}</CardDescription>
            </CardHeader>
          </Card>
        ) : companies.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo operacional</CardTitle>
              <CardDescription>
                Nenhuma empresa com dados operacionais disponiveis no momento.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : hasMultipleCompanies ? (
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
            <Card className="min-w-0 overflow-hidden py-0">
              <CardHeader className="border-b">
                <CardTitle className="text-base">Empresas cadastradas</CardTitle>
                <CardDescription>
                  Selecione uma empresa para carregar o painel ao lado.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 overflow-hidden p-0">
                <ScrollArea className="h-[72vh] min-w-0 w-full overflow-x-hidden">
                  <div className="space-y-3 p-4">
                    {companies.map((company) => {
                      const isSelected = selectedCompany?.companyId === company.companyId

                      return (
                        <button
                          key={company.companyId}
                          type="button"
                          onClick={() => setSelectedCompany(company)}
                          className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition-colors ${
                            isSelected
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/70 bg-card hover:border-border hover:bg-muted/20"
                          }`}
                        >
                          <CompanyHeader company={company} />
                          <span
                            className={`flex size-10 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 bg-background text-muted-foreground"
                            }`}
                          >
                            <ChevronRight className="size-4" />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden py-0">
              <CardHeader className="border-b">
                <CardTitle className="text-base">
                  {selectedCompany?.companyName ?? "Selecione uma empresa"}
                </CardTitle>
                <CardDescription>
                  Painel operacional carregado em uma area fixa, sem abrir modal e sem expandir a lista.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 overflow-hidden p-0">
                <ScrollArea className="h-[72vh] min-w-0 w-full overflow-x-hidden">
                  <div className="min-w-0 overflow-x-hidden p-4 sm:p-6">
                    {selectedCompany ? (
                      <CompanySummaryContent
                        companyId={selectedCompany.companyId}
                        date={selectedDate}
                        embedded
                      />
                    ) : (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Nenhuma empresa selecionada</CardTitle>
                          <CardDescription>
                            Escolha uma empresa na coluna ao lado para visualizar o resumo operacional.
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        ) : singleCompany ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{singleCompany.companyName}</CardTitle>
                <CardDescription>
                  Resumo operacional individual da empresa visivel neste painel.
                </CardDescription>
              </CardHeader>
            </Card>
            <CompanySummaryContent companyId={singleCompany.companyId} date={selectedDate} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
