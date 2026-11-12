import type { createServiceClient } from "@/lib/supabase/server"

type ServiceClient = ReturnType<typeof createServiceClient>

// Fuso da empresa (Configuracoes > Geral); padrao, horario de Brasilia.
export async function getCompanyTimeZone(supabase: ServiceClient, companyId: string) {
  const { data: generalRow } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "general")
    .maybeSingle()
  const configuredTimeZone = (generalRow?.value as Record<string, unknown> | null)?.timezone
  return typeof configuredTimeZone === "string" && configuredTimeZone.trim()
    ? configuredTimeZone.trim()
    : "America/Sao_Paulo"
}
