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
  instance_id?: string | null
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
  instance_id: null,
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

export type WhatsAppBotSendPayload = {
  instance_id?: string | null
  jid?: string | null
  phone?: string | null
  whatsapp_group_id?: string | null
  message?: string | null
  caption?: string | null
  text?: string | null
  document_base64?: string | null
  document_url?: string | null
  file_name?: string | null
  mimetype?: string | null
}

export type WhatsAppBotSendResult = {
  ok: boolean
  instance_id?: string | null
  jid: string
  phone: string | null
  whatsapp_group_id: string | null
  has_document: boolean
  file_name: string | null
  mimetype: string | null
}

const WHATSAPP_BOT_RUNTIME_DIR = path.join(process.cwd(), "services", "whatsapp-bot", "runtime")

export const WHATSAPP_BOT_RUNTIME_STATE_PATH = path.join(WHATSAPP_BOT_RUNTIME_DIR, "qr-state.json")

function buildRuntimeStatePath(instanceId?: string | null) {
  const normalizedInstanceId = normalizeInstanceId(instanceId)
  if (!normalizedInstanceId || normalizedInstanceId === "default") {
    return WHATSAPP_BOT_RUNTIME_STATE_PATH
  }

  return path.join(WHATSAPP_BOT_RUNTIME_DIR, "instances", `${normalizedInstanceId}.json`)
}

export async function readWhatsAppBotRuntimeState(
  instanceId?: string | null
): Promise<WhatsAppBotRuntimeState | null> {
  const serviceState = await readWhatsAppBotRuntimeStateFromService(instanceId)
  if (serviceState) {
    return serviceState
  }

  return readWhatsAppBotRuntimeStateFromFile(instanceId)
}

async function readWhatsAppBotRuntimeStateFromService(
  instanceId?: string | null
): Promise<WhatsAppBotRuntimeState | null> {
  try {
    const response = await fetch(withInstanceId(`${getWhatsAppBotServiceBaseUrl()}/status`, instanceId), {
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
        instance_id: normalizeInstanceId(instanceId),
        status: "error",
        last_error: data?.error || `Nao foi possivel consultar o bot (${response.status})`,
      }
    }

    return normalizeWhatsAppBotRuntimeState(data, instanceId)
  } catch (error) {
    if (!process.env.WHATSAPP_BOT_SERVICE_URL?.trim()) {
      return null
    }

    return {
      ...DEFAULT_WHATSAPP_BOT_RUNTIME_STATE,
      instance_id: normalizeInstanceId(instanceId),
      status: "error",
      last_error:
        error instanceof Error ? error.message : "Erro ao consultar estado do bot",
    }
  }
}

export function getWhatsAppBotServiceBaseUrl() {
  return (process.env.WHATSAPP_BOT_SERVICE_URL || "http://127.0.0.1:3010").trim()
}

async function readWhatsAppBotRuntimeStateFromFile(
  instanceId?: string | null
): Promise<WhatsAppBotRuntimeState | null> {
  try {
    const raw = await fs.readFile(buildRuntimeStatePath(instanceId), "utf-8")
    return normalizeWhatsAppBotRuntimeState(
      JSON.parse(raw) as Partial<WhatsAppBotRuntimeState>,
      instanceId
    )
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
      instance_id: normalizeInstanceId(instanceId),
      status: "error",
      last_error: error instanceof Error ? error.message : "Erro ao ler estado do bot",
    }
  }
}

export async function controlWhatsAppBot(
  action: "disconnect" | "restart" | "switch_phone",
  instanceId?: string | null
): Promise<WhatsAppBotRuntimeState> {
  let response: Response

  try {
    response = await fetch(`${getWhatsAppBotServiceBaseUrl()}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        instance_id: normalizeInstanceId(instanceId),
      }),
      cache: "no-store",
    })
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `Nao foi possivel conectar ao servico do bot em ${getWhatsAppBotServiceBaseUrl()}. Inicie o bot local com 'pnpm dev:all' ou 'pnpm bot:whatsapp'. Detalhe: ${error.message}`
        : `Nao foi possivel conectar ao servico do bot em ${getWhatsAppBotServiceBaseUrl()}. Inicie o bot local com 'pnpm dev:all' ou 'pnpm bot:whatsapp'.`
    )
  }

  const data = (await response.json().catch(() => null)) as
    | (Partial<WhatsAppBotRuntimeState> & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(data?.error || "Nao foi possivel controlar o bot")
  }

  return normalizeWhatsAppBotRuntimeState(data, instanceId)
}

export async function fetchWhatsAppBotDirectory(
  instanceId?: string | null
): Promise<WhatsAppBotDirectoryEntry[]> {
  const response = await fetch(
    withInstanceId(`${getWhatsAppBotServiceBaseUrl()}/directory`, instanceId),
    {
      cache: "no-store",
    }
  )

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
          item?.type === "group" || item?.type === "individual" ? item.type : null
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

export async function sendWhatsAppBotMessage(
  payload: WhatsAppBotSendPayload
): Promise<WhatsAppBotSendResult> {
  const normalizedInstanceId = normalizeInstanceId(payload.instance_id)
  const response = await fetch(`${getWhatsAppBotServiceBaseUrl()}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      instance_id: normalizedInstanceId,
    }),
    cache: "no-store",
  })

  const raw = await response.text()
  const data = (() => {
    try {
      return JSON.parse(raw) as
        | (Partial<WhatsAppBotSendResult> & { error?: string })
        | null
    } catch {
      return null
    }
  })()

  if (!response.ok) {
    if (response.status === 404 || raw.includes("Cannot POST /send")) {
      throw new Error(
        "O bot em execucao ainda esta na versao antiga. Reinicie o bot para habilitar o envio generico."
      )
    }

    throw new Error(data?.error || "Nao foi possivel enviar mensagem pelo bot")
  }

  return {
    ok: data?.ok === true,
    instance_id: normalizedInstanceId,
    jid: typeof data?.jid === "string" ? data.jid : "",
    phone: typeof data?.phone === "string" ? data.phone : null,
    whatsapp_group_id:
      typeof data?.whatsapp_group_id === "string" ? data.whatsapp_group_id : null,
    has_document: data?.has_document === true,
    file_name: typeof data?.file_name === "string" ? data.file_name : null,
    mimetype: typeof data?.mimetype === "string" ? data.mimetype : null,
  }
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
  parsed: Partial<WhatsAppBotRuntimeState> | null | undefined,
  instanceId?: string | null
): WhatsAppBotRuntimeState {
  return {
    instance_id: normalizeInstanceId(parsed?.instance_id ?? instanceId),
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

function normalizeInstanceId(instanceId?: string | null) {
  return typeof instanceId === "string" && instanceId.trim() ? instanceId.trim() : null
}

function withInstanceId(url: string, instanceId?: string | null) {
  const normalizedInstanceId = normalizeInstanceId(instanceId)
  if (!normalizedInstanceId) {
    return url
  }

  const nextUrl = new URL(url)
  nextUrl.searchParams.set("instance_id", normalizedInstanceId)
  return nextUrl.toString()
}
