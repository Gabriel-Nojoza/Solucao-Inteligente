import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export type RequestCompanyContext = {
  companyId: string
  source: "auth" | "n8n_secret"
}

async function getSecretFromRequest(request: Request) {
  const url = new URL(request.url)
  const querySecret = url.searchParams.get("secret")?.trim()
  const headerSecret = request.headers.get("x-callback-secret")?.trim()
  const authHeader = request.headers.get("authorization")?.trim()

  const bearerSecret =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null

  let bodySecret = ""

  const contentType = request.headers.get("content-type") || ""
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      const clonedRequest = request.clone()
      const body = await clonedRequest.json()
      bodySecret =
        typeof body?.callback_secret === "string"
          ? body.callback_secret.trim()
          : ""
    } catch {
      bodySecret = ""
    }
  }

  return querySecret || headerSecret || bearerSecret || bodySecret || ""
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

export async function resolveRequestCompanyContext(
  request: Request,
  options?: { allowCallbackSecret?: boolean }
): Promise<RequestCompanyContext> {
  if (options?.allowCallbackSecret) {
    const secret = await getSecretFromRequest(request)

    if (secret) {
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
