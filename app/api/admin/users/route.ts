import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"
import { listReports, listWorkspaces } from "@/lib/powerbi"

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

export async function GET() {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) throw error

    const allUsers = data.users ?? []
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
    const { email, password, name, role, company_name, powerbi, n8n } = body
    const normalizedEmail = String(email ?? "").trim().toLowerCase()
    const normalizedPassword = String(password ?? "").trim()
    const normalizedName = String(name ?? "").trim()
    const normalizedRole = role === "admin" ? "admin" : "client"
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
              },
              updated_at: new Date().toISOString(),
            },
            {
              company_id: targetCompanyId,
              key: "general",
              value: { app_name: companyName, timezone: "America/Sao_Paulo" },
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
      app_metadata: { role: normalizedRole, company_id: targetCompanyId },
      user_metadata: { name: normalizedName, role: normalizedRole, company_id: targetCompanyId },
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
    const { id, password, name, role } = body
    const normalizedPassword = String(password ?? "").trim()
    const normalizedName = String(name ?? "").trim()
    const normalizedRole = role === "admin" ? "admin" : "client"

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers()
    if (listErr) throw listErr
    const current = usersData.users.find((u) => u.id === id)
    if (!current || getUserCompanyId(current) !== context.companyId) {
      return NextResponse.json({ error: "Usuario nao pertence a sua empresa" }, { status: 403 })
    }

    const updateData: {
      password?: string
      app_metadata?: Record<string, string>
      user_metadata?: Record<string, string>
    } = {
      app_metadata: { role: normalizedRole, company_id: context.companyId },
      user_metadata: { name: normalizedName, role: normalizedRole, company_id: context.companyId },
    }

    if (normalizedPassword) {
      updateData.password = normalizedPassword
    }

    const { data, error } = await supabase.auth.admin.updateUserById(id, updateData)

    if (error) throw error

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
    if (!current || getUserCompanyId(current) !== context.companyId) {
      return NextResponse.json({ error: "Usuario nao pertence a sua empresa" }, { status: 403 })
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
