import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"

export async function GET(request: NextRequest) {
  try {
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }

    const headerSecret = request.headers.get("x-callback-secret")?.trim()
    const querySecret = new URL(request.url).searchParams.get("secret")?.trim()
    const incomingSecret = headerSecret || querySecret || ""

    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const supabase = createClient()

    const { data: instances, error } = await supabase
      .from("whatsapp_bot_instances")
      .select("id, company_id, name, updated_at")
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")

    const companyNameById = new Map<string, string>(
      (companies ?? []).map((c) => [c.id, c.name])
    )

    const result = await Promise.all(
      (instances ?? []).map(async (instance) => {
        const runtime = await readWhatsAppBotRuntimeState(instance.id).catch(() => null)
        return {
          id: instance.id,
          name: instance.name,
          company_id: instance.company_id,
          company_name: companyNameById.get(instance.company_id) ?? instance.company_id,
          status: runtime?.status ?? "offline",
          phone_number: runtime?.phone_number ?? null,
          display_name: runtime?.display_name ?? null,
          last_error: runtime?.last_error ?? null,
          updated_at: runtime?.updated_at ?? instance.updated_at ?? null,
        }
      })
    )

    return NextResponse.json({
      evaluated_at: new Date().toISOString(),
      total: result.length,
      connected: result.filter((i) => i.status === "connected").length,
      offline: result.filter((i) => i.status === "offline").length,
      instances: result,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar instancias" },
      { status: 500 }
    )
  }
}
