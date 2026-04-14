import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export type RequestCompanyContext = {
  companyId: string
  source: "auth" | "n8n_secret" | "platform"
}

function getSecretFromRequest(request: Request) {
  const url = new URL(request.url)
  const querySecret = url.searchParams.get("secret")?.trim()
  const headerSecret = request.headers.get("x-callback-secret")?.trim()
  const authHeader = request.headers.get("authorization")?.trim()

  const bearerSecret =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null

  return querySecret || headerSecret || bearerSecret || ""
}

async function getCompanyIdFromCallbackSecret(secret: string) {
  if (!secret) {
    return null
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("company_settings")
    .select("company_id, value")
    .eq("key", "n8n")

  if (error) {
    throw new Error(error.message)
  }

  const match = (data ?? []).find((row) => {
    const value = row.value as Record<string, unknown> | null
    return (
      typeof value?.callback_secret === "string" &&
      value.callback_secret.trim() === secret
    )
  })

  return match?.company_id ?? null
}

async function getCompanyIdFromBody(request: Request): Promise<string | null> {
  try {
    const cloned = request.clone()
    const body = await cloned.json().catch(() => null)
    if (!body || typeof body !== "object") return null

    const supabase = createServiceClient()

    // Try dispatch_log_id or dispatch_log_ids
    const logId =
      typeof body.dispatch_log_id === "string" && body.dispatch_log_id.trim()
        ? body.dispatch_log_id.trim()
        : Array.isArray(body.dispatch_log_ids) && typeof body.dispatch_log_ids[0] === "string"
          ? body.dispatch_log_ids[0].trim()
          : null

    if (logId) {
      const { data } = await supabase
        .from("dispatch_logs")
        .select("company_id")
        .eq("id", logId)
        .single()
      if (data?.company_id) return data.company_id
    }

    // Try report_id
    const reportId =
      typeof body.report_id === "string" && body.report_id.trim()
        ? body.report_id.trim()
        : null

    if (reportId) {
      const { data } = await supabase
        .from("reports")
        .select("company_id")
        .eq("id", reportId)
        .single()
      if (data?.company_id) return data.company_id
    }

    return null
  } catch {
    return null
  }
}

export async function resolveRequestCompanyContext(
  request: Request,
  options?: { allowCallbackSecret?: boolean; callbackSecret?: string | null }
): Promise<RequestCompanyContext> {
  if (options?.allowCallbackSecret) {
    const secret =
      (typeof options.callbackSecret === "string"
        ? options.callbackSecret.trim()
        : "") || getSecretFromRequest(request)

    if (secret) {
      // Check if it's the platform secret
      const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
      if (platformSecret && secret === platformSecret) {
        const companyId = await getCompanyIdFromBody(request)
        if (!companyId) {
          throw new Error("Callback secret invalido")
        }
        return { companyId, source: "platform" }
      }

      const companyId = await getCompanyIdFromCallbackSecret(secret)

      if (!companyId) {
        throw new Error("Callback secret invalido")
      }

      return {
        companyId,
        source: "n8n_secret",
      }
    }
  }

  const context = await getRequestContext()

  return {
    companyId: context.companyId,
    source: "auth",
  }
}
