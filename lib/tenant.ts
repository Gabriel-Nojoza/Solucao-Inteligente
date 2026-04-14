import { createClient, createServiceClient } from "@/lib/supabase/server"
import {
  getSelectedPbiDatasetIds,
  getSelectedPbiWorkspaceIds,
  isDatasetAccessConfigured,
  isWorkspaceAccessConfigured,
} from "@/lib/workspace-access"

export type RequestContext = {
  userId: string
  email: string
  role: "admin" | "client"
  companyId: string
  isPlatformAdmin: boolean
  workspaceAccessConfigured: boolean
  datasetAccessConfigured: boolean
  selectedPbiWorkspaceIds: string[]
  selectedPbiDatasetIds: string[]
}

function getRole(user: {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}) {
  const appRole = user.app_metadata?.role
  const userRole = user.user_metadata?.role
  return appRole === "admin" || userRole === "admin" ? "admin" : "client"
}

function getCompanyId(user: {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}) {
  const appCompanyId = user.app_metadata?.company_id
  const userCompanyId = user.user_metadata?.company_id
  const companyId =
    typeof appCompanyId === "string"
      ? appCompanyId
      : typeof userCompanyId === "string"
        ? userCompanyId
        : ""

  return companyId.trim()
}

function isPlatformAdminEmail(email: string) {
  const configured = (process.env.PLATFORM_ADMIN_EMAIL || "admin@seuapp.com")
    .trim()
    .toLowerCase()

  return email.trim().toLowerCase() === configured
}

export function isAuthContextError(error: unknown) {
  if (!(error instanceof Error)) return false

  return (
    error.message === "Nao autenticado" ||
    error.message === "Usuario sem empresa vinculada (company_id)"
  )
}

export async function getRequestContext(): Promise<RequestContext> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    throw new Error("Nao autenticado")
  }

  const companyId = getCompanyId(data.user)
  const email = data.user.email || ""

  if (!companyId) {
    throw new Error("Usuario sem empresa vinculada (company_id)")
  }

  return {
    userId: data.user.id,
    email,
    role: getRole(data.user),
    companyId,
    isPlatformAdmin: isPlatformAdminEmail(email),
    workspaceAccessConfigured: isWorkspaceAccessConfigured(data.user),
    datasetAccessConfigured: isDatasetAccessConfigured(data.user),
    selectedPbiWorkspaceIds: getSelectedPbiWorkspaceIds(data.user),
    selectedPbiDatasetIds: getSelectedPbiDatasetIds(data.user),
  }
}

export async function requireAdminContext(): Promise<RequestContext> {
  const context = await getRequestContext()

  if (context.role !== "admin") {
    throw new Error("Acesso restrito a administradores")
  }

  return context
}

export async function getCompanySettingsRow(key: string, companyId: string) {
  const supabase = createServiceClient()

  return supabase
    .from("company_settings")
    .select("*")
    .eq("company_id", companyId)
    .eq("key", key)
    .single()
}
