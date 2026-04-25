import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  buildChatIASettingsValue,
  buildDisabledExpiredChatIASettingsValue,
  normalizeChatIASettings,
} from "@/lib/chat-ia-config"
import { requireAdminContext } from "@/lib/tenant"
import { listDatasets, listReports, listWorkspaces } from "@/lib/powerbi"
import {
  getCompanyWorkspaceOptions,
  getSelectedPbiDatasetIds,
  getSelectedPbiWorkspaceIds,
  getUserAssignedPbiDatasetIds,
  getUserAssignedPbiWorkspaceIds,
  isDatasetAccessConfigured,
  isWorkspaceAccessConfigured,
  normalizePbiDatasetIds,
  normalizePbiDatasetSelections,
  normalizePbiWorkspaceIds,
  syncUserDatasetAccess,
  syncUserWorkspaceAccess,
} from "@/lib/workspace-access"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function getUserCompanyId(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) {
  const fromApp = user.app_metadata?.company_id
  const fromUser = user.user_metadata?.company_id
  return typeof fromApp === "string" ? fromApp : typeof fromUser === "string" ? fromUser : ""
}

function canManageUser(
  context: Awaited<ReturnType<typeof requireAdminContext>>,
  user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }
) {
  if (context.isPlatformAdmin) {
    return true
  }

  return getUserCompanyId(user) === context.companyId
}

async function getUserSettingsSnapshot(
  supabase: ReturnType<typeof getAdminClient>,
  companyId: string
) {
  if (!companyId) {
    return {
      company_name: "",
      powerbi: undefined,
      n8n: undefined,
    }
  }

  const [{ data: company, error: companyErr }, { data: settingsRows, error: settingsErr }] = await Promise.all([
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("company_settings")
      .select("key, value")
      .eq("company_id", companyId)
      .in("key", ["powerbi", "n8n", "chat_ia"]),
  ])

  if (companyErr) throw companyErr
  if (settingsErr) throw settingsErr

  const settingsMap = new Map(
    (settingsRows ?? []).map((row) => [row.key, row.value as Record<string, unknown>])
  )

  const rawChatIA = settingsMap.get("chat_ia")
  const chatIAConfig = normalizeChatIASettings(rawChatIA)

  if (chatIAConfig.isExpired && chatIAConfig.enabled) {
    const disabledChatIA = buildDisabledExpiredChatIASettingsValue(rawChatIA)

    await supabase
      .from("company_settings")
      .update({
        value: disabledChatIA,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("key", "chat_ia")

    settingsMap.set("chat_ia", disabledChatIA)
  }

  return {
    company_name: company?.name ?? "",
    powerbi: settingsMap.get("powerbi"),
    n8n: settingsMap.get("n8n"),
    chat_ia: settingsMap.get("chat_ia"),
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function getPowerBIAccessToken(config: {
  tenant_id: string
  client_id: string
  client_secret: string
}) {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao obter token Power BI: ${err}`)
  }

  const json = await res.json()
  return String(json.access_token ?? "")
}

async function discoverPowerBIWorkspaces(config: Record<string, unknown> | undefined) {
  const tenantId =
    typeof config?.tenant_id === "string" ? config.tenant_id.trim() : ""
  const clientId =
    typeof config?.client_id === "string" ? config.client_id.trim() : ""
  const clientSecret =
    typeof config?.client_secret === "string" ? config.client_secret.trim() : ""

  if (!tenantId || !clientId || !clientSecret) {
    return null
  }

  const token = await getPowerBIAccessToken({
    tenant_id: tenantId,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const workspaces = await listWorkspaces(token)

  return Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const datasets = await listDatasets(token, workspace.id)
        return {
          id: workspace.id,
          name: workspace.name,
          dataset_count: datasets.length,
          datasets: datasets.map((dataset) => ({
            id: String(dataset.id ?? ""),
            name: String(dataset.name ?? ""),
          })),
        }
      } catch {
        return {
          id: workspace.id,
          name: workspace.name,
          dataset_count: 0,
          datasets: [],
        }
      }
    })
  )
}

async function upsertWorkspace(
  supabase: ReturnType<typeof getAdminClient>,
  payload: Record<string, unknown>
) {
  const preferred = await supabase
    .from("workspaces")
    .upsert(payload, { onConflict: "company_id,pbi_workspace_id" })

  if (!preferred.error) return

  await supabase
    .from("workspaces")
    .upsert(payload, { onConflict: "pbi_workspace_id" })
}

async function upsertReport(
  supabase: ReturnType<typeof getAdminClient>,
  payload: Record<string, unknown>
) {
  const preferred = await supabase
    .from("reports")
    .upsert(payload, { onConflict: "company_id,pbi_report_id" })

  if (!preferred.error) return

  await supabase
    .from("reports")
    .upsert(payload, { onConflict: "pbi_report_id" })
}

export async function GET(request: Request) {
  try {
    let context

    try {
      context = await requireAdminContext()
    } catch (err) {
      console.error("Admin context error:", err)

      return NextResponse.json(
        { error: "Nao autenticado" },
        { status: 401 }
      )
    }

    const supabase = getAdminClient()
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) throw error

    const allUsers = data.users ?? []
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (id) {
      const current = allUsers.find((user) => user.id === id)
      if (!current || !canManageUser(context, current)) {
        return NextResponse.json(
          { error: "Voce nao tem permissao para visualizar este usuario" },
          { status: 403 }
        )
      }

      const companyId = getUserCompanyId(current)
      const settings = await getUserSettingsSnapshot(supabase, companyId)
      const discoveredWorkspaces = await discoverPowerBIWorkspaces(
        settings.powerbi
      ).catch(() => null)
      const availableWorkspaces =
        discoveredWorkspaces ?? (await getCompanyWorkspaceOptions(supabase, companyId))
      const assignedPbiWorkspaceIds = await getUserAssignedPbiWorkspaceIds(
        supabase,
        current.id,
        companyId,
        current
      )
      const assignedPbiDatasetIds = await getUserAssignedPbiDatasetIds(
        supabase,
        current.id,
        companyId,
        current
      )
      const workspaceAccessConfigured = isWorkspaceAccessConfigured(current)
      const datasetAccessConfigured = isDatasetAccessConfigured(current)
      const allDatasetIds = availableWorkspaces.flatMap((workspace) =>
        Array.isArray(workspace.datasets)
          ? workspace.datasets.flatMap((dataset) =>
              typeof dataset.id === "string" && dataset.id.trim()
                ? [dataset.id.trim()]
                : []
            )
          : []
      )

      return NextResponse.json({
        ...current,
        company_id: companyId,
        workspace_access_configured: workspaceAccessConfigured,
        dataset_access_configured: datasetAccessConfigured,
        available_workspaces: availableWorkspaces,
        selected_pbi_workspace_ids:
          workspaceAccessConfigured && assignedPbiWorkspaceIds !== null
            ? assignedPbiWorkspaceIds
            : availableWorkspaces.map((workspace) => workspace.id),
        selected_pbi_dataset_ids:
          datasetAccessConfigured && assignedPbiDatasetIds !== null
            ? assignedPbiDatasetIds
            : allDatasetIds,
        ...settings,
      })
    }

    const users = context.isPlatformAdmin
      ? allUsers
      : allUsers.filter((user) => getUserCompanyId(user) === context.companyId)

    return NextResponse.json(users)
  } catch (error) {
    console.error("Error listing users:", error)
    return NextResponse.json(
      { error: "Erro ao listar usuarios" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()
    const body = await request.json()
    const { email, password, name, role, company_name, powerbi, n8n, chat_ia } = body
    const normalizedEmail = String(email ?? "").trim().toLowerCase()
    const normalizedPassword = String(password ?? "").trim()
    const normalizedName = String(name ?? "").trim()
    const normalizedRole = role === "admin" ? "admin" : "client"
    const hasWorkspaceSelectionPayload = Array.isArray(body?.selected_pbi_workspace_ids)
    const normalizedSelectedPbiWorkspaceIds = normalizePbiWorkspaceIds(body?.selected_pbi_workspace_ids)
    const hasDatasetSelectionPayload =
      Array.isArray(body?.selected_pbi_dataset_access) ||
      Array.isArray(body?.selected_pbi_dataset_ids)
    const normalizedSelectedDatasetSelections = normalizePbiDatasetSelections(
      body?.selected_pbi_dataset_access
    ).filter(
      (entry) =>
        normalizedSelectedPbiWorkspaceIds.length === 0 ||
        normalizedSelectedPbiWorkspaceIds.includes(entry.workspaceId)
    )
    const normalizedSelectedPbiDatasetIds =
      normalizedSelectedDatasetSelections.length > 0
        ? normalizedSelectedDatasetSelections.map((entry) => entry.datasetId)
        : normalizePbiDatasetIds(body?.selected_pbi_dataset_ids)
    let targetCompanyId = context.companyId

    if (!normalizedEmail || !normalizedPassword) {
      return NextResponse.json(
        { error: "Email e senha obrigatorios" },
        { status: 400 }
      )
    }

    if (normalizedRole === "client") {
      const companyName = String(company_name ?? "").trim()
      const pbiTenantId = String(powerbi?.tenant_id ?? "").trim()
      const pbiClientId = String(powerbi?.client_id ?? "").trim()
      const pbiClientSecret = String(powerbi?.client_secret ?? "").trim()
      const n8nWebhookUrl = String(n8n?.webhook_url ?? "").trim()
      const n8nCallbackSecret = String(n8n?.callback_secret ?? "").trim()

      if (!companyName || !pbiTenantId || !pbiClientId || !pbiClientSecret) {
        return NextResponse.json(
          { error: "Para Cliente: empresa e credenciais Power BI sao obrigatorios" },
          { status: 400 }
        )
      }

      if (n8nWebhookUrl && !n8nCallbackSecret) {
        return NextResponse.json(
          { error: "Para Cliente: Callback Secret do N8N e obrigatorio quando houver Webhook URL" },
          { status: 400 }
        )
      }

      const slug = slugify(companyName)
      const { data: company, error: companyErr } = await supabase
        .from("companies")
        .insert({ name: companyName, slug })
        .select("id")
        .single()

      if (companyErr || !company) {
        const message = companyErr?.message?.includes("duplicate")
          ? "Nome da empresa ja cadastrado"
          : companyErr?.message || "Erro ao criar empresa"
        return NextResponse.json({ error: message }, { status: 400 })
      }

      targetCompanyId = company.id

      await supabase
        .from("company_settings")
        .upsert(
          [
            {
              company_id: targetCompanyId,
              key: "powerbi",
              value: {
                tenant_id: pbiTenantId,
                client_id: pbiClientId,
                client_secret: pbiClientSecret,
              },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "n8n",
              value: {
                webhook_url: n8nWebhookUrl,
                callback_secret: n8nCallbackSecret,
                chat_webhook_url: String(n8n?.chat_webhook_url ?? "").trim(),
              },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "general",
              value: { app_name: companyName, timezone: "America/Sao_Paulo" },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "chat_ia",
              value: buildChatIASettingsValue(chat_ia),
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: "company_id,key" }
        )

      // Initial Power BI sync so the client logs in with workspaces already available.
      const token = await getPowerBIAccessToken({
        tenant_id: pbiTenantId,
        client_id: pbiClientId,
        client_secret: pbiClientSecret,
      })
      const pbiWorkspaces = await listWorkspaces(token)

      for (const ws of pbiWorkspaces) {
        await upsertWorkspace(supabase, {
          company_id: targetCompanyId,
          pbi_workspace_id: ws.id,
          name: ws.name,
          is_active: true,
          synced_at: new Date().toISOString(),
        })
      }

      const { data: dbWorkspaces } = await supabase
        .from("workspaces")
        .select("id, pbi_workspace_id")
        .eq("company_id", targetCompanyId)

      for (const ws of dbWorkspaces ?? []) {
        try {
          const pbiReports = await listReports(token, ws.pbi_workspace_id)
          for (const report of pbiReports) {
            await upsertReport(supabase, {
              company_id: targetCompanyId,
              pbi_report_id: report.id,
              workspace_id: ws.id,
              name: report.name,
              web_url: report.webUrl,
              embed_url: report.embedUrl,
              dataset_id: report.datasetId,
              is_active: true,
              synced_at: new Date().toISOString(),
            })
          }
        } catch {
          // Ignore workspace-level report sync failures.
        }
      }
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      email_confirm: true,
      app_metadata: {
        role: normalizedRole,
        company_id: targetCompanyId,
        workspace_access_configured:
          normalizedRole === "client" ? hasWorkspaceSelectionPayload : false,
        dataset_access_configured:
          normalizedRole === "client" ? hasDatasetSelectionPayload : false,
        selected_pbi_workspace_ids:
          normalizedRole === "client" ? normalizedSelectedPbiWorkspaceIds : [],
        selected_pbi_dataset_ids:
          normalizedRole === "client" ? normalizedSelectedPbiDatasetIds : [],
      },
      user_metadata: {
        name: normalizedName,
        role: normalizedRole,
        company_id: targetCompanyId,
        workspace_access_configured:
          normalizedRole === "client" ? hasWorkspaceSelectionPayload : false,
        dataset_access_configured:
          normalizedRole === "client" ? hasDatasetSelectionPayload : false,
        selected_pbi_workspace_ids:
          normalizedRole === "client" ? normalizedSelectedPbiWorkspaceIds : [],
        selected_pbi_dataset_ids:
          normalizedRole === "client" ? normalizedSelectedPbiDatasetIds : [],
      },
    })

    if (error) {
      if (error.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "Este email ja esta cadastrado" },
          { status: 400 }
        )
      }
      throw error
    }

    if (data.user && normalizedRole === "client" && hasWorkspaceSelectionPayload) {
      await syncUserWorkspaceAccess(supabase, {
        userId: data.user.id,
        companyId: targetCompanyId,
        selectedPbiWorkspaceIds: normalizedSelectedPbiWorkspaceIds,
      })
    }

    if (data.user && normalizedRole === "client" && hasDatasetSelectionPayload) {
      await syncUserDatasetAccess(supabase, {
        userId: data.user.id,
        companyId: targetCompanyId,
        selectedDatasets: normalizedSelectedDatasetSelections,
      })
    }

    return NextResponse.json(data.user)
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json(
      { error: "Erro ao criar usuario" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()
    const body = await request.json()
    const {
      id,
      email,
      password,
      name,
      role,
      company_name,
      powerbi,
      n8n,
      chat_ia,
      selected_pbi_workspace_ids,
      selected_pbi_dataset_access,
      selected_pbi_dataset_ids,
    } = body
    const normalizedEmail = String(email ?? "").trim().toLowerCase()
    const normalizedPassword = String(password ?? "").trim()
    const normalizedName = String(name ?? "").trim()
    const normalizedRole = role === "admin" ? "admin" : "client"
    const hasWorkspaceSelectionPayload = Array.isArray(selected_pbi_workspace_ids)
    const normalizedSelectedPbiWorkspaceIds = normalizePbiWorkspaceIds(selected_pbi_workspace_ids)
    const hasDatasetSelectionPayload =
      Array.isArray(selected_pbi_dataset_access) ||
      Array.isArray(selected_pbi_dataset_ids)
    const normalizedSelectedDatasetSelections = normalizePbiDatasetSelections(
      selected_pbi_dataset_access
    ).filter(
      (entry) =>
        normalizedSelectedPbiWorkspaceIds.length === 0 ||
        normalizedSelectedPbiWorkspaceIds.includes(entry.workspaceId)
    )
    const normalizedSelectedPbiDatasetIds =
      normalizedSelectedDatasetSelections.length > 0
        ? normalizedSelectedDatasetSelections.map((entry) => entry.datasetId)
        : normalizePbiDatasetIds(selected_pbi_dataset_ids)

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email obrigatorio" }, { status: 400 })
    }

    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers()
    if (listErr) throw listErr
    const current = usersData.users.find((u) => u.id === id)
    if (!current || !canManageUser(context, current)) {
      return NextResponse.json({ error: "Voce nao tem permissao para editar este usuario" }, { status: 403 })
    }

    const targetCompanyId = context.isPlatformAdmin
      ? getUserCompanyId(current)
      : context.companyId
    const nextWorkspaceAccessConfigured =
      normalizedRole === "client"
        ? hasWorkspaceSelectionPayload || isWorkspaceAccessConfigured(current)
        : false
    const nextDatasetAccessConfigured =
      normalizedRole === "client"
        ? hasDatasetSelectionPayload || isDatasetAccessConfigured(current)
        : false
    const nextSelectedPbiWorkspaceIds =
      normalizedRole === "client"
        ? (
            hasWorkspaceSelectionPayload
              ? normalizedSelectedPbiWorkspaceIds
              : getSelectedPbiWorkspaceIds(current)
          )
        : []
    const nextSelectedPbiDatasetIds =
      normalizedRole === "client"
        ? (
            hasDatasetSelectionPayload
              ? normalizedSelectedPbiDatasetIds
              : getSelectedPbiDatasetIds(current)
          )
        : []

    if (normalizedRole === "client") {
      const companyName = String(company_name ?? "").trim()
      const pbiTenantId = String(powerbi?.tenant_id ?? "").trim()
      const pbiClientId = String(powerbi?.client_id ?? "").trim()
      const pbiClientSecret = String(powerbi?.client_secret ?? "").trim()
      const n8nWebhookUrl = String(n8n?.webhook_url ?? "").trim()
      const n8nCallbackSecret = String(n8n?.callback_secret ?? "").trim()

      if (!companyName || !pbiTenantId || !pbiClientId || !pbiClientSecret) {
        return NextResponse.json(
          { error: "Para Cliente: empresa e credenciais Power BI sao obrigatorios" },
          { status: 400 }
        )
      }

      if (n8nWebhookUrl && !n8nCallbackSecret) {
        return NextResponse.json(
          { error: "Para Cliente: Callback Secret do N8N e obrigatorio quando houver Webhook URL" },
          { status: 400 }
        )
      }

      const { error: companyErr } = await supabase
        .from("companies")
        .update({
          name: companyName,
          slug: slugify(companyName),
        })
        .eq("id", targetCompanyId)

      if (companyErr) {
        const message = companyErr.message?.includes("duplicate")
          ? "Nome da empresa ja cadastrado"
          : companyErr.message || "Erro ao atualizar empresa"
        return NextResponse.json({ error: message }, { status: 400 })
      }

      const { data: existingChatIA } = await supabase
        .from("company_settings")
        .select("value")
        .eq("company_id", targetCompanyId)
        .eq("key", "chat_ia")
        .maybeSingle()

      const { error: settingsErr } = await supabase
        .from("company_settings")
        .upsert(
          [
            {
              company_id: targetCompanyId,
              key: "powerbi",
              value: {
                tenant_id: pbiTenantId,
                client_id: pbiClientId,
                client_secret: pbiClientSecret,
              },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "n8n",
              value: {
                webhook_url: n8nWebhookUrl,
                callback_secret: n8nCallbackSecret,
                chat_webhook_url: String(n8n?.chat_webhook_url ?? "").trim(),
              },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "chat_ia",
              value: buildChatIASettingsValue(chat_ia, existingChatIA?.value),
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: "company_id,key" }
        )

      if (settingsErr) throw settingsErr
    }

    const updateData: {
      email?: string
      email_confirm?: boolean
      password?: string
      app_metadata?: Record<string, string | boolean | string[]>
      user_metadata?: Record<string, string | boolean | string[]>
    } = {
      app_metadata: {
        role: normalizedRole,
        company_id: targetCompanyId,
        workspace_access_configured: nextWorkspaceAccessConfigured,
        dataset_access_configured: nextDatasetAccessConfigured,
        selected_pbi_workspace_ids: nextSelectedPbiWorkspaceIds,
        selected_pbi_dataset_ids: nextSelectedPbiDatasetIds,
      },
      user_metadata: {
        name: normalizedName,
        role: normalizedRole,
        company_id: targetCompanyId,
        workspace_access_configured: nextWorkspaceAccessConfigured,
        dataset_access_configured: nextDatasetAccessConfigured,
        selected_pbi_workspace_ids: nextSelectedPbiWorkspaceIds,
        selected_pbi_dataset_ids: nextSelectedPbiDatasetIds,
      },
    }

    if (normalizedEmail !== String(current.email ?? "").trim().toLowerCase()) {
      updateData.email = normalizedEmail
      updateData.email_confirm = true
    }

    if (normalizedPassword) {
      updateData.password = normalizedPassword
    }

    const { data, error } = await supabase.auth.admin.updateUserById(id, updateData)

    if (error) {
      if (error.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "Este email ja esta cadastrado" },
          { status: 400 }
        )
      }
      throw error
    }

    if (normalizedRole !== "client" || !nextWorkspaceAccessConfigured) {
      await syncUserWorkspaceAccess(supabase, {
        userId: id,
        companyId: targetCompanyId,
        selectedPbiWorkspaceIds: [],
      })
    } else if (hasWorkspaceSelectionPayload) {
      await syncUserWorkspaceAccess(supabase, {
        userId: id,
        companyId: targetCompanyId,
        selectedPbiWorkspaceIds: normalizedSelectedPbiWorkspaceIds,
      })
    }

    if (normalizedRole !== "client" || !nextDatasetAccessConfigured) {
      await syncUserDatasetAccess(supabase, {
        userId: id,
        companyId: targetCompanyId,
        selectedDatasets: [],
      })
    } else if (hasDatasetSelectionPayload) {
      await syncUserDatasetAccess(supabase, {
        userId: id,
        companyId: targetCompanyId,
        selectedDatasets: normalizedSelectedDatasetSelections,
      })
    }

    return NextResponse.json(data.user)
  } catch (error) {
    console.error("Error updating user:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar usuario" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers()
    if (listErr) throw listErr
    const current = usersData.users.find((u) => u.id === id)
    if (!current || !canManageUser(context, current)) {
      return NextResponse.json({ error: "Voce nao tem permissao para remover este usuario" }, { status: 403 })
    }

    if (current.id === context.userId) {
      return NextResponse.json(
        { error: "Voce nao pode remover a propria conta logada" },
        { status: 400 }
      )
    }

    const { error } = await supabase.auth.admin.deleteUser(id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json(
      { error: "Erro ao remover usuario" },
      { status: 500 }
    )
  }
}
