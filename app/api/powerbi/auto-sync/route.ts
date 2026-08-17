import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { getTimePartsInTimeZone } from "@/lib/schedule-cron"
import { getAccessToken, listReports, listWorkspaces } from "@/lib/powerbi"
import { syncWorkspaceCatalogs } from "@/lib/powerbi-catalog-sync"

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getWorkspaceLabel(workspace: { name?: string | null; pbi_workspace_id?: string | null }) {
  const name = typeof workspace.name === "string" ? workspace.name.trim() : ""
  if (name) return name
  const workspaceId =
    typeof workspace.pbi_workspace_id === "string" ? workspace.pbi_workspace_id.trim() : ""
  return workspaceId || "workspace desconhecido"
}

async function runPowerBiSync(companyId: string) {
  const supabase = createServiceClient()
  const token = await getAccessToken(companyId)
  const syncedAt = new Date().toISOString()
  const pbiWorkspaces = await listWorkspaces(token)

  for (const ws of pbiWorkspaces) {
    await supabase.from("workspaces").upsert(
      { company_id: companyId, pbi_workspace_id: ws.id, name: ws.name, synced_at: syncedAt },
      { onConflict: "company_id,pbi_workspace_id" }
    )
  }

  const { data: dbWorkspaces } = await supabase
    .from("workspaces")
    .select("id, name, pbi_workspace_id")
    .eq("company_id", companyId)

  const dbWorkspaceList = dbWorkspaces ?? []
  const activeWorkspaceIds = new Set(pbiWorkspaces.map((w) => w.id))
  const currentDbWorkspaces = dbWorkspaceList.filter((w) => activeWorkspaceIds.has(w.pbi_workspace_id))
  const staleDbWorkspaces = dbWorkspaceList.filter((w) => !activeWorkspaceIds.has(w.pbi_workspace_id))

  if (staleDbWorkspaces.length > 0) {
    const stalePbiWorkspaceIds = staleDbWorkspaces.map((w) => w.pbi_workspace_id)
    const staleWorkspaceIds = staleDbWorkspaces.map((w) => w.id)
    await supabase
      .from("workspaces")
      .update({ is_active: false, synced_at: syncedAt })
      .eq("company_id", companyId)
      .in("pbi_workspace_id", stalePbiWorkspaceIds)
    await supabase
      .from("reports")
      .update({ is_active: false, synced_at: syncedAt })
      .eq("company_id", companyId)
      .in("workspace_id", staleWorkspaceIds)
  }

  let totalReports = 0
  const warnings: string[] = []

  const reportSyncWorkspaces = currentDbWorkspaces.filter(
    (ws) => (ws.name ?? "").trim().toLowerCase() !== "microsoft fabric capacity metrics"
  )

  for (const ws of reportSyncWorkspaces) {
    let reports: Awaited<ReturnType<typeof listReports>> | null = null
    try {
      reports = await listReports(token, ws.pbi_workspace_id)
    } catch (error) {
      warnings.push(
        `Nao foi possivel sincronizar os relatorios do workspace ${getWorkspaceLabel(ws)}. ${getErrorMessage(error)}`
      )
    }

    if (reports) {
      for (const report of reports) {
        await supabase.from("reports").upsert(
          {
            company_id: companyId,
            workspace_id: ws.id,
            pbi_report_id: report.id,
            name: report.name,
            web_url: report.webUrl,
            embed_url: report.embedUrl,
            dataset_id: report.datasetId,
            is_active: true,
            synced_at: syncedAt,
          },
          { onConflict: "company_id,pbi_report_id" }
        )
        totalReports++
      }

      const currentReportIds = reports.map((r) => r.id)
      const { data: existingReports } = await supabase
        .from("reports")
        .select("pbi_report_id")
        .eq("company_id", companyId)
        .eq("workspace_id", ws.id)

      const staleReportIds = (existingReports ?? [])
        .map((r) => r.pbi_report_id)
        .filter((id) => !currentReportIds.includes(id))

      if (staleReportIds.length > 0) {
        await supabase
          .from("reports")
          .update({ is_active: false, synced_at: syncedAt })
          .eq("company_id", companyId)
          .eq("workspace_id", ws.id)
          .in("pbi_report_id", staleReportIds)
      }
    }

    try {
      const catalogSync = await syncWorkspaceCatalogs({
        companyId,
        token,
        workspaceId: ws.pbi_workspace_id,
        workspaceLabel: getWorkspaceLabel(ws),
        syncedAt,
      })
      warnings.push(...catalogSync.warnings)
    } catch (error) {
      warnings.push(
        `Nao foi possivel sincronizar os datasets do workspace ${getWorkspaceLabel(ws)}. ${getErrorMessage(error)}`
      )
    }
  }

  return { workspaces: pbiWorkspaces.length, reports: totalReports, warnings }
}

export async function POST(_request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createServiceClient()

    const { data: settingsRows } = await supabase
      .from("company_settings")
      .select("key, value")
      .eq("company_id", companyId)
      .in("key", ["general", "powerbi_sync"])

    const settingsMap = new Map(
      (settingsRows ?? []).map((row) => [row.key, (row.value as Record<string, unknown>) ?? {}])
    )

    const generalSettings = settingsMap.get("general") ?? {}
    const syncSettings = settingsMap.get("powerbi_sync") ?? {}

    const timeZone =
      typeof generalSettings.timezone === "string" && generalSettings.timezone.trim()
        ? generalSettings.timezone.trim()
        : "America/Sao_Paulo"

    // Suporta novo formato (times: "HH:MM"[]) e legado (hours: number[])
    let syncTimes: string[] = []
    if (Array.isArray(syncSettings.times) && syncSettings.times.length > 0) {
      syncTimes = (syncSettings.times as unknown[]).filter(
        (t): t is string => typeof t === "string"
      )
    } else if (Array.isArray(syncSettings.hours) && syncSettings.hours.length > 0) {
      syncTimes = (syncSettings.hours as unknown[])
        .filter((h): h is number => typeof h === "number")
        .map((h) => `${String(h).padStart(2, "0")}:00`)
    }

    const now = new Date()
    const lastSyncAt =
      typeof syncSettings.last_auto_sync_at === "string"
        ? new Date(syncSettings.last_auto_sync_at)
        : null

    if (syncTimes.length === 0) {
      // Sem horarios configurados: sincroniza por intervalo (padrao 4 horas)
      const intervalMinutes =
        typeof syncSettings.interval_minutes === "number" && syncSettings.interval_minutes > 0
          ? syncSettings.interval_minutes
          : 240
      if (lastSyncAt && !isNaN(lastSyncAt.getTime())) {
        const minutesSinceLast = (now.getTime() - lastSyncAt.getTime()) / 60000
        if (minutesSinceLast < intervalMinutes) {
          return NextResponse.json({ synced: false, reason: "Aguardando intervalo de sincronizacao" })
        }
      }
    } else {
      const timeParts = getTimePartsInTimeZone(now, timeZone)
      const currentTime = `${String(timeParts.hour).padStart(2, "0")}:${String(timeParts.minute).padStart(2, "0")}`

      if (!syncTimes.includes(currentTime)) {
        return NextResponse.json({ synced: false, reason: "Fora do horario de sincronizacao" })
      }

      if (lastSyncAt && !isNaN(lastSyncAt.getTime())) {
        const lastParts = getTimePartsInTimeZone(lastSyncAt, timeZone)
        const lastTime = `${String(lastParts.hour).padStart(2, "0")}:${String(lastParts.minute).padStart(2, "0")}`
        if (
          lastParts.year === timeParts.year &&
          lastParts.month === timeParts.month &&
          lastParts.day === timeParts.day &&
          lastTime === currentTime
        ) {
          return NextResponse.json({ synced: false, reason: "Ja sincronizado neste horario" })
        }
      }
    }

    await supabase.from("company_settings").upsert(
      {
        company_id: companyId,
        key: "powerbi_sync",
        value: { ...syncSettings, last_auto_sync_at: now.toISOString() },
        updated_at: now.toISOString(),
      },
      { onConflict: "company_id,key" }
    )

    const result = await runPowerBiSync(companyId)

    return NextResponse.json({
      synced: true,
      synced_at: now.toISOString(),
      ...result,
    })
  } catch (error) {
    const message = getErrorMessage(error)
    console.error("[auto-sync] erro:", message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
