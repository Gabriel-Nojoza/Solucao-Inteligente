import { promises as fs } from "fs"
import path from "path"

export type WhatsAppBotRuntimeStatus =
  | "starting"
  | "awaiting_qr"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error"

export type WhatsAppBotRuntimeState = {
  status: WhatsAppBotRuntimeStatus
  qr_code_data_url: string
  updated_at: string | null
  connected_at: string | null
  last_error: string | null
  phone_number: string | null
  display_name: string | null
  jid: string | null
}

const DEFAULT_WHATSAPP_BOT_RUNTIME_STATE: WhatsAppBotRuntimeState = {
  status: "offline",
  qr_code_data_url: "",
  updated_at: null,
  connected_at: null,
  last_error: null,
  phone_number: null,
  display_name: null,
  jid: null,
}

export type WhatsAppBotDirectoryEntry = {
  jid: string
  type: "individual" | "group"
  name: string
  phone: string | null
  whatsapp_group_id: string | null
}

export const WHATSAPP_BOT_RUNTIME_STATE_PATH = path.join(
  process.cwd(),
  "services",
  "whatsapp-bot",
  "runtime",
  "qr-state.json"
)

export async function readWhatsAppBotRuntimeState(): Promise<WhatsAppBotRuntimeState | null> {
  const serviceState = await readWhatsAppBotRuntimeStateFromService()
  if (serviceState) {
    return serviceState
  }

  return readWhatsAppBotRuntimeStateFromFile()
}

async function readWhatsAppBotRuntimeStateFromService(): Promise<WhatsAppBotRuntimeState | null> {
  try {
    const response = await fetch(`${getWhatsAppBotServiceBaseUrl()}/status`, {
      cache: "no-store",
    })
    const raw = await response.text()
    const data = parseWhatsAppBotRuntimeStateResponse(raw)

    if (!response.ok) {
      if (response.status === 404 || raw.includes("Cannot GET /status")) {
        return null
      }

      return {
        ...DEFAULT_WHATSAPP_BOT_RUNTIME_STATE,
        status: "error",
        last_error: data?.error || `Nao foi possivel consultar o bot (${response.status})`,
      }
    }

    return normalizeWhatsAppBotRuntimeState(data)
  } catch (error) {
    if (!process.env.WHATSAPP_BOT_SERVICE_URL?.trim()) {
      return null
    }

    return {
      ...DEFAULT_WHATSAPP_BOT_RUNTIME_STATE,
      status: "error",
      last_error:
        error instanceof Error ? error.message : "Erro ao consultar estado do bot",
    }
  }
}

export function getWhatsAppBotServiceBaseUrl() {
  return (process.env.WHATSAPP_BOT_SERVICE_URL || "http://127.0.0.1:3010").trim()
}

async function readWhatsAppBotRuntimeStateFromFile(): Promise<WhatsAppBotRuntimeState | null> {
  try {
    const raw = await fs.readFile(WHATSAPP_BOT_RUNTIME_STATE_PATH, "utf-8")
    return normalizeWhatsAppBotRuntimeState(JSON.parse(raw) as Partial<WhatsAppBotRuntimeState>)
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null
    }

    return {
      ...DEFAULT_WHATSAPP_BOT_RUNTIME_STATE,
      status: "error",
      last_error: error instanceof Error ? error.message : "Erro ao ler estado do bot",
    }
  }
}

export async function controlWhatsAppBot(
  action: "disconnect" | "restart"
): Promise<WhatsAppBotRuntimeState> {
  const response = await fetch(`${getWhatsAppBotServiceBaseUrl()}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    cache: "no-store",
  })

  const data = (await response.json().catch(() => null)) as
    | (Partial<WhatsAppBotRuntimeState> & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(data?.error || "Nao foi possivel controlar o bot")
  }

  return {
    status: isValidStatus(data?.status) ? data.status : "offline",
    qr_code_data_url:
      typeof data?.qr_code_data_url === "string" ? data.qr_code_data_url : "",
    updated_at: typeof data?.updated_at === "string" ? data.updated_at : null,
    connected_at: typeof data?.connected_at === "string" ? data.connected_at : null,
    last_error: typeof data?.last_error === "string" ? data.last_error : null,
    phone_number: typeof data?.phone_number === "string" ? data.phone_number : null,
    display_name: typeof data?.display_name === "string" ? data.display_name : null,
    jid: typeof data?.jid === "string" ? data.jid : null,
  }
}

export async function fetchWhatsAppBotDirectory(): Promise<WhatsAppBotDirectoryEntry[]> {
  const response = await fetch(`${getWhatsAppBotServiceBaseUrl()}/directory`, {
    cache: "no-store",
  })

  const raw = await response.text()
  const data = (() => {
    try {
      return JSON.parse(raw) as
        | {
            error?: string
            items?: Array<Partial<WhatsAppBotDirectoryEntry>>
          }
        | null
    } catch {
      return null
    }
  })()

  if (!response.ok) {
    if (response.status === 404 || raw.includes("Cannot GET /directory")) {
      throw new Error(
        "O bot em execucao ainda esta na versao antiga. Reinicie o bot para habilitar a listagem de contatos e grupos."
      )
    }

    throw new Error(data?.error || "Nao foi possivel listar contatos do bot")
  }

  return Array.isArray(data?.items)
    ? data.items.flatMap((item) => {
        const jid = typeof item?.jid === "string" ? item.jid.trim() : ""
        const type =
          item?.type === "group" || item?.type === "individual"
            ? item.type
            : null
        const name = typeof item?.name === "string" ? item.name.trim() : ""

        if (!jid || !type || !name) {
          return []
        }

        return [
          {
            jid,
            type,
            name,
            phone: typeof item?.phone === "string" ? item.phone.trim() || null : null,
            whatsapp_group_id:
              typeof item?.whatsapp_group_id === "string"
                ? item.whatsapp_group_id.trim() || null
                : null,
          },
        ]
      })
    : []
}

function isValidStatus(value: unknown): value is WhatsAppBotRuntimeStatus {
  return (
    value === "starting" ||
    value === "awaiting_qr" ||
    value === "connected" ||
    value === "reconnecting" ||
    value === "offline" ||
    value === "error"
  )
}

function normalizeWhatsAppBotRuntimeState(
  parsed: Partial<WhatsAppBotRuntimeState> | null | undefined
): WhatsAppBotRuntimeState {
  return {
    status: isValidStatus(parsed?.status) ? parsed.status : "offline",
    qr_code_data_url:
      typeof parsed?.qr_code_data_url === "string" ? parsed.qr_code_data_url : "",
    updated_at: typeof parsed?.updated_at === "string" ? parsed.updated_at : null,
    connected_at: typeof parsed?.connected_at === "string" ? parsed.connected_at : null,
    last_error: typeof parsed?.last_error === "string" ? parsed.last_error : null,
    phone_number: typeof parsed?.phone_number === "string" ? parsed.phone_number : null,
    display_name: typeof parsed?.display_name === "string" ? parsed.display_name : null,
    jid: typeof parsed?.jid === "string" ? parsed.jid : null,
  }
}

function parseWhatsAppBotRuntimeStateResponse(
  raw: string
): (Partial<WhatsAppBotRuntimeState> & { error?: string }) | null {
  try {
    return JSON.parse(raw) as Partial<WhatsAppBotRuntimeState> & { error?: string }
  } catch {
    return null
  }
}
