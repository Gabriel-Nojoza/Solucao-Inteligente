// Chave do robo de relatorios (programa no computador do cliente que sobe o
// relatorio exportado do WinThor). E uma chave so para isso: com ela o robo so
// consegue guardar arquivos da propria empresa. Nao usa o Callback Secret do
// n8n, que permite mandar mensagens pelo WhatsApp.
//
// No banco fica so o hash (company_settings, key "robot"). A chave aparece uma
// vez, quando e gerada em Admin > Configuracoes.
import crypto from "node:crypto"
import { createServiceClient } from "@/lib/supabase/server"

type ServiceClient = ReturnType<typeof createServiceClient>

export const ROBOT_SETTINGS_KEY = "robot"
const KEY_PREFIX = "robo_"

export type RobotKeyInfo = {
  exists: boolean
  created_at: string | null
  hint: string | null
}

export function hashRobotKey(key: string) {
  return crypto.createHash("sha256").update(key.trim()).digest("hex")
}

export function generateRobotKey() {
  return `${KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`
}

function readHash(value: unknown) {
  const hash = (value as Record<string, unknown> | null)?.key_hash
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null
}

function sameHash(a: string, b: string) {
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
}

// Empresa dona da chave, ou null quando a chave nao confere.
export async function getCompanyIdFromRobotKey(supabase: ServiceClient, key: string) {
  const trimmed = key.trim()
  if (!trimmed.startsWith(KEY_PREFIX) || trimmed.length < 20) return null

  const { data, error } = await supabase
    .from("company_settings")
    .select("company_id, value")
    .eq("key", ROBOT_SETTINGS_KEY)

  if (error) throw new Error(error.message)

  const hash = hashRobotKey(trimmed)
  for (const row of data ?? []) {
    const stored = readHash(row.value)
    if (stored && sameHash(stored, hash)) {
      return row.company_id as string
    }
  }

  return null
}

export async function getRobotKeyInfo(supabase: ServiceClient, companyId: string): Promise<RobotKeyInfo> {
  const { data } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", ROBOT_SETTINGS_KEY)
    .maybeSingle()

  const value = data?.value as Record<string, unknown> | null
  if (!readHash(value)) return { exists: false, created_at: null, hint: null }

  return {
    exists: true,
    created_at: typeof value?.created_at === "string" ? value.created_at : null,
    hint: typeof value?.hint === "string" ? value.hint : null,
  }
}

// Gera uma chave nova e troca a anterior (o robo com a chave antiga para de
// conseguir enviar). Devolve a chave inteira, que nao fica guardada.
export async function createRobotKey(supabase: ServiceClient, companyId: string) {
  const key = generateRobotKey()
  const value = {
    key_hash: hashRobotKey(key),
    hint: key.slice(-4),
    created_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from("company_settings")
    .upsert(
      { company_id: companyId, key: ROBOT_SETTINGS_KEY, value, updated_at: value.created_at },
      { onConflict: "company_id,key" }
    )

  if (error) throw new Error(error.message)

  return { key, created_at: value.created_at, hint: value.hint }
}
