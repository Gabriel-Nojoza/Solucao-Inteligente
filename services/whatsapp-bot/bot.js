import { config as loadDotenv } from "dotenv"
loadDotenv()
loadDotenv({ path: ".env.local" })

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { default as ws } from "ws"
// Polyfill WebSocket para Node.js < 22 (exigido pelo @supabase/realtime-js)
if (!globalThis.WebSocket) globalThis.WebSocket = ws
import QRCode from "qrcode"
import qrcodeTerminal from "qrcode-terminal"
import express from "express"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HTTP_PORT = Number(process.env.BOT_PORT || 3010)
const BODY_LIMIT = process.env.BOT_BODY_LIMIT || "100mb"
const AUTH_DIR = path.join(__dirname, "auth")
const AUTH_INSTANCES_DIR = path.join(__dirname, "auth-instances")
const RUNTIME_DIR = path.join(__dirname, "runtime")
const RUNTIME_INSTANCES_DIR = path.join(RUNTIME_DIR, "instances")
const QR_STATE_PATH = path.join(RUNTIME_DIR, "qr-state.json")
const BASE_DIR =
  process.env.BOT_PDF_BASE_DIR || path.resolve(__dirname, "..", "..", "bot-pdf")
const DEFAULT_INSTANCE_KEY = "default"

const grupos = [
  { nome: "Grupo 1", id: "120363406411408946@g.us", pasta: "grupo-1" },
  { nome: "Grupo 2", id: "120363407240392123@g.us", pasta: "grupo-2" },
  { nome: "Grupo 3", id: "120363423749941918@g.us", pasta: "grupo-3" },
  { nome: "Grupo 4", id: "120363406391767151@g.us", pasta: "grupo-4" },
  { nome: "Grupo 5", id: "120363407737340800@g.us", pasta: "grupo-5" },
  { nome: "Grupo 6", id: "120363424874021737@g.us", pasta: "grupo-6" },
  { nome: "Grupo 7", id: "120363422804615911@g.us", pasta: "grupo-7" },
]

const instances = new Map()

let _supabaseClient = null
let _supportsWhatsappGroupId = null

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
  if (!url || !key) return null
  _supabaseClient = createSupabaseClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } })
  return _supabaseClient
}

async function checkSupportsWhatsappGroupId(supabase) {
  if (_supportsWhatsappGroupId !== null) return _supportsWhatsappGroupId
  const { error } = await supabase.from("contacts").select("whatsapp_group_id").limit(1)
  _supportsWhatsappGroupId = !error
  return _supportsWhatsappGroupId
}

async function resolveCompanyId(instanceId) {
  if (!instanceId || instanceId === DEFAULT_INSTANCE_KEY) return null
  const supabase = getSupabaseClient()
  if (!supabase) return null
  try {
    const { data } = await supabase
      .from("whatsapp_bot_instances")
      .select("company_id")
      .eq("id", instanceId)
      .single()
    return data?.company_id ?? null
  } catch {
    return null
  }
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function syncContactsToDb(instance) {
  if (!instance.companyId) return
  if (instance._syncingContacts) return
  const supabase = getSupabaseClient()
  if (!supabase) return
  instance._syncingContacts = true

  try {
    const items = await buildDirectory(instance)
    if (items.length === 0) return

    const supportsGroupId = await checkSupportsWhatsappGroupId(supabase)

    const { data: existing } = await supabase
      .from("contacts")
      .select("id, phone, whatsapp_group_id, type, name, bot_instance_id, is_active")
      .eq("company_id", instance.companyId)
      .limit(50000)

    const existingByPhone = new Map()
    const existingByGroupId = new Map()
    for (const c of existing ?? []) {
      if (c.type === "individual" && c.phone) {
        existingByPhone.set(c.phone.replace(/\D/g, ""), c)
      }
      if (c.type === "group") {
        const gid = supportsGroupId ? c.whatsapp_group_id : c.phone
        if (gid) existingByGroupId.set(gid, c)
      }
    }

    const inserts = []
    const updates = []
    const botInstanceId = instance.id === DEFAULT_INSTANCE_KEY ? null : instance.id

    for (const item of items) {
      if (item.type === "individual") {
        const normalizedPhone = normalizePhone(item.phone)
        if (!normalizedPhone) continue
        const formattedPhone = `+${normalizedPhone}`
        const existingContact = existingByPhone.get(normalizedPhone)
        if (!existingContact) {
          const payload = {
            company_id: instance.companyId,
            bot_instance_id: botInstanceId,
            name: item.name,
            phone: formattedPhone,
            type: "individual",
            is_active: true,
          }
          if (supportsGroupId) payload.whatsapp_group_id = null
          inserts.push(payload)
        } else if (existingContact.name !== item.name || !existingContact.is_active || existingContact.bot_instance_id !== botInstanceId) {
          updates.push({
            id: existingContact.id,
            payload: { name: item.name, is_active: true, bot_instance_id: botInstanceId, updated_at: new Date().toISOString() },
          })
        }
      } else if (item.type === "group") {
        const groupId = item.whatsapp_group_id
        if (!groupId) continue
        const existingGroup = existingByGroupId.get(groupId)
        if (!existingGroup) {
          const payload = {
            company_id: instance.companyId,
            bot_instance_id: botInstanceId,
            name: item.name,
            phone: groupId,
            type: "group",
            is_active: true,
          }
          if (supportsGroupId) payload.whatsapp_group_id = groupId
          inserts.push(payload)
        } else if (existingGroup.name !== item.name || !existingGroup.is_active || existingGroup.bot_instance_id !== botInstanceId) {
          updates.push({
            id: existingGroup.id,
            payload: { name: item.name, is_active: true, bot_instance_id: botInstanceId, updated_at: new Date().toISOString() },
          })
        }
      }
    }

    const seenPhones = new Set()
    const groupInserts = inserts.filter((i) => i.type === "group" && !seenPhones.has(i.phone) && seenPhones.add(i.phone))
    const seenIndividuals = new Set()
    const individualInserts = inserts.filter((i) => i.type === "individual" && !seenIndividuals.has(i.phone) && seenIndividuals.add(i.phone))
    const groupConflict = supportsGroupId ? "company_id,whatsapp_group_id" : "company_id,phone"
    for (const chunk of chunkArray(groupInserts, 200)) {
      const { error } = await supabase.from("contacts").upsert(chunk, { ignoreDuplicates: true, onConflict: groupConflict })
      if (error) console.error(`[${instance.id}] Erro ao inserir grupos no banco:`, error.message)
    }
    for (const chunk of chunkArray(individualInserts, 200)) {
      const { error } = await supabase.from("contacts").upsert(chunk, { ignoreDuplicates: true, onConflict: "company_id,phone" })
      if (error) console.error(`[${instance.id}] Erro ao inserir contatos no banco:`, error.message)
    }
    for (const update of updates) {
      const { error } = await supabase.from("contacts").update(update.payload).eq("id", update.id)
      if (error) console.error(`[${instance.id}] Erro ao atualizar contato no banco:`, error.message)
    }

    console.log(`[${instance.id}] Banco sincronizado: ${inserts.length} inseridos, ${updates.length} atualizados`)
  } finally {
    instance._syncingContacts = false
  }
}

ensureDirectory(AUTH_DIR)
ensureDirectory(AUTH_INSTANCES_DIR)
ensureDirectory(RUNTIME_DIR)
ensureDirectory(RUNTIME_INSTANCES_DIR)

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function normalizeInstanceId(instanceId) {
  if (typeof instanceId !== "string") {
    return DEFAULT_INSTANCE_KEY
  }

  const normalized = instanceId.trim()
  if (!normalized || normalized === DEFAULT_INSTANCE_KEY) {
    return DEFAULT_INSTANCE_KEY
  }

  return normalized.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function getInstanceLabel(instanceId) {
  return instanceId === DEFAULT_INSTANCE_KEY
    ? "WhatsApp principal"
    : `WhatsApp ${instanceId}`
}

function buildDefaultRuntimeState(instanceId) {
  return {
    instance_id: instanceId,
    instance_name: getInstanceLabel(instanceId),
    status: "offline",
    qr_code_data_url: "",
    updated_at: null,
    connected_at: null,
    last_error: null,
    phone_number: null,
    display_name: null,
    jid: null,
    contacts_ready: false,
  }
}

function resolveInstanceConfig(instanceId) {
  const normalizedId = normalizeInstanceId(instanceId)
  if (normalizedId === DEFAULT_INSTANCE_KEY) {
    return {
      id: normalizedId,
      label: getInstanceLabel(normalizedId),
      authDir: AUTH_DIR,
      runtimePath: QR_STATE_PATH,
    }
  }

  return {
    id: normalizedId,
    label: getInstanceLabel(normalizedId),
    authDir: path.join(AUTH_INSTANCES_DIR, normalizedId),
    runtimePath: path.join(RUNTIME_INSTANCES_DIR, `${normalizedId}.json`),
  }
}

function getInstanceEntry(instanceId) {
  const config = resolveInstanceConfig(instanceId)
  const cached = instances.get(config.id)
  if (cached) {
    return cached
  }

  ensureDirectory(config.authDir)

  const entry = {
    id: config.id,
    label: config.label,
    authDir: config.authDir,
    runtimePath: config.runtimePath,
    socket: null,
    isStarting: false,
    pendingControlAction: null,
    allowAuthStateWrites: true,
    restartTimer: null,
    contacts: new Map(),
    chats: new Map(),
    groups: new Map(),
    companyId: null,
    pendingPairingPhone: null,
    _groupSyncTimer: null,
    _syncingContacts: false,
  }

  instances.set(config.id, entry)
  return entry
}

function clearDirectoryCache(instance) {
  instance.contacts.clear()
  instance.chats.clear()
  instance.groups.clear()
}

async function readRuntimeState(instanceId) {
  const instance = getInstanceEntry(instanceId)

  try {
    const raw = await fs.promises.readFile(instance.runtimePath, "utf-8")
    const parsed = JSON.parse(raw)
    return {
      ...buildDefaultRuntimeState(instance.id),
      ...parsed,
      instance_id: instance.id,
      instance_name: instance.label,
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null
    }

    console.error(`Erro ao ler estado do QR (${instance.id}):`, error)
    return null
  }
}

async function writeRuntimeState(instanceId, patch) {
  const instance = getInstanceEntry(instanceId)
  const current = (await readRuntimeState(instance.id)) || buildDefaultRuntimeState(instance.id)
  const nextState = {
    ...current,
    ...patch,
    instance_id: instance.id,
    instance_name: instance.label,
    updated_at: new Date().toISOString(),
  }

  await fs.promises.writeFile(instance.runtimePath, JSON.stringify(nextState, null, 2), "utf-8")
  return nextState
}

async function writeStoppedRuntimeState(instanceId, status = "offline") {
  return writeRuntimeState(instanceId, {
    status,
    qr_code_data_url: "",
    connected_at: null,
    last_error: null,
    phone_number: null,
    display_name: null,
    jid: null,
  })
}

function getSocketIdentity(socket) {
  const user = socket?.user
  const jid = typeof user?.id === "string" ? user.id : null
  const phoneNumber =
    typeof user?.phoneNumber === "string"
      ? user.phoneNumber
      : jid
        ? jid.split(":")[0].split("@")[0]
        : null
  const displayName = user?.verifiedName || user?.name || user?.notify || phoneNumber || null

  return {
    phone_number: phoneNumber,
    display_name: displayName,
    jid,
  }
}

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us")
}

function isIndividualJid(jid) {
  return (
    typeof jid === "string" &&
    (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))
  )
}

function getNormalizedJid(jid) {
  return typeof jid === "string" ? jid.trim() : ""
}

function getPhoneFromJid(jid) {
  const normalized = getNormalizedJid(jid)
  if (
    !normalized ||
    isGroupJid(normalized) ||
    normalized.endsWith("@lid") ||
    normalized === "status@broadcast"
  ) {
    return null
  }

  const phone = normalized.split(":")[0].split("@")[0].replace(/\D/g, "")
  return phone || null
}

function normalizePhone(phone) {
  const normalized = typeof phone === "string" ? phone.replace(/\D/g, "") : ""
  return normalized || null
}

function upsertContactCache(instance, contact) {
  const jid = getNormalizedJid(contact?.id || contact?.jid || contact?.phoneNumber)
  if (!jid) {
    return
  }

  const existing = instance.contacts.get(jid) || {}
  instance.contacts.set(jid, {
    ...existing,
    jid,
    phoneNumber:
      typeof contact?.phoneNumber === "string" && contact.phoneNumber.trim()
        ? contact.phoneNumber.trim()
        : existing.phoneNumber || getPhoneFromJid(jid),
    name:
      contact?.verifiedName ||
      contact?.name ||
      contact?.notify ||
      existing.name ||
      getPhoneFromJid(jid) ||
      jid,
  })
}

function upsertChatCache(instance, chat) {
  const jid = getNormalizedJid(chat?.id || chat?.jid)
  if (!jid) {
    return
  }

  const existing = instance.chats.get(jid) || {}
  instance.chats.set(jid, {
    ...existing,
    jid,
    name:
      chat?.name ||
      chat?.conversationName ||
      chat?.subject ||
      existing.name ||
      (isGroupJid(jid) ? "Grupo" : getPhoneFromJid(jid) || jid),
  })
}

async function resolvePhoneJid(instance, jid) {
  const normalized = getNormalizedJid(jid)
  if (!normalized || isGroupJid(normalized) || normalized === "status@broadcast") {
    return null
  }

  if (!normalized.endsWith("@lid")) {
    return normalized
  }

  try {
    const pn = await instance.socket?.signalRepository?.lidMapping?.getPNForLID(normalized)
    return typeof pn === "string" && pn.endsWith("@s.whatsapp.net") ? pn : null
  } catch {
    return null
  }
}

async function upsertMessageSenderCache(instance, msg) {
  const remoteJid = getNormalizedJid(msg?.key?.remoteJid)
  const senderJid = isGroupJid(remoteJid)
    ? getNormalizedJid(msg?.key?.participant)
    : remoteJid

  if (!senderJid || !isIndividualJid(senderJid) || msg?.key?.fromMe) {
    return
  }

  const resolvedJid = (await resolvePhoneJid(instance, senderJid)) || senderJid
  const pushName = typeof msg?.pushName === "string" ? msg.pushName.trim() : ""
  upsertChatCache(instance, { jid: resolvedJid, name: pushName || undefined })
  if (pushName) {
    upsertContactCache(instance, { id: resolvedJid, name: pushName, notify: pushName })
  }
}

function upsertGroupCache(instance, group) {
  const jid = getNormalizedJid(group?.id)
  if (!jid) {
    return
  }

  instance.groups.set(jid, {
    jid,
    name:
      typeof group?.subject === "string" && group.subject.trim()
        ? group.subject.trim()
        : instance.groups.get(jid)?.name || "Grupo",
  })
}

async function refreshGroupDirectory(instance) {
  if (!instance.socket) {
    return
  }

  const groups = await instance.socket.groupFetchAllParticipating()
  for (const groupId in groups) {
    const group = groups[groupId]
    if (!group.id) {
      group.id = groupId
    }
    upsertGroupCache(instance, group)

    if (Array.isArray(group.participants)) {
      for (const participant of group.participants) {
        const participantJid = typeof participant.id === "string" ? participant.id : ""
        if (isIndividualJid(participantJid)) {
          const resolvedJid = await resolvePhoneJid(instance, participantJid)
          if (resolvedJid) {
            upsertContactCache(instance, { id: resolvedJid })
          }
        }
      }
    }
  }
}

async function buildDirectory(instance) {
  const items = []
  const ownJid = getNormalizedJid(instance.socket?.user?.id)
  const ownPhoneJid = await resolvePhoneJid(instance, ownJid)
  const ownPhone = getPhoneFromJid(ownPhoneJid || ownJid)

  for (const [jid, group] of instance.groups.entries()) {
    if (!jid) continue
    items.push({
      jid,
      type: "group",
      name: group.name || "Grupo",
      phone: null,
      whatsapp_group_id: jid,
    })
  }

  const seenIndividuals = new Set()
  const individualJids = new Set([...instance.contacts.keys(), ...instance.chats.keys()])
  for (const jid of individualJids) {
    const resolvedJid = (await resolvePhoneJid(instance, jid)) || jid
    if (!isIndividualJid(jid) || jid === ownJid || resolvedJid === ownPhoneJid) {
      continue
    }

    const phone = getPhoneFromJid(resolvedJid)
    if (!phone || phone === ownPhone || seenIndividuals.has(phone)) {
      continue
    }
    seenIndividuals.add(phone)

    const name = instance.contacts.get(jid)?.name || instance.chats.get(jid)?.name || phone
    items.push({
      jid: resolvedJid,
      type: "individual",
      name,
      phone,
      whatsapp_group_id: null,
    })
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "group" ? 1 : -1
    }
    return a.name.localeCompare(b.name, "pt-BR")
  })
}

function createValidationError(message) {
  const error = new Error(message)
  error.code = "VALIDATION"
  return error
}

function isValidationError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "VALIDATION"
}

function notifyTelegramAlert(text) {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID
  if (!token || !chatId) return
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  }).catch((err) => console.error("Erro ao enviar alerta Telegram:", err.message))
}

function findIndividualJidByPhone(instance, phone) {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return null
  }

  const candidateMaps = [instance.contacts, instance.chats]
  for (const candidateMap of candidateMaps) {
    for (const [jid, value] of candidateMap.entries()) {
      if (!isIndividualJid(jid)) {
        continue
      }

      const mappedPhone = normalizePhone(value?.phoneNumber || getPhoneFromJid(jid))
      if (mappedPhone === normalizedPhone) {
        return jid
      }
    }
  }

  return `${normalizedPhone}@s.whatsapp.net`
}

function resolveRecipientJid(instance, input) {
  const directJid = getNormalizedJid(input?.jid)
  if (directJid) {
    if (!directJid.includes("@")) {
      const directPhone = normalizePhone(directJid)
      if (directPhone) {
        return `${directPhone}@s.whatsapp.net`
      }
    }

    return directJid
  }

  const groupId = getNormalizedJid(input?.whatsapp_group_id || input?.group_id)
  if (groupId) {
    if (!isGroupJid(groupId)) {
      throw createValidationError("whatsapp_group_id invalido")
    }

    return groupId
  }

  const phone = normalizePhone(input?.phone)
  if (phone) {
    return findIndividualJidByPhone(instance, phone)
  }

  throw createValidationError("Informe jid, whatsapp_group_id ou phone")
}

function inferMimeType(fileName) {
  const lower = typeof fileName === "string" ? fileName.trim().toLowerCase() : ""
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }

  return "application/octet-stream"
}

function getFileNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    const name = path.basename(pathname)
    return name && name !== "/" ? name : null
  } catch {
    return null
  }
}

async function resolveDocumentPayload(input) {
  const base64Input =
    typeof input?.document_base64 === "string" ? input.document_base64.trim() : ""
  const documentUrl =
    typeof input?.document_url === "string" ? input.document_url.trim() : ""
  const providedFileName = typeof input?.file_name === "string" ? input.file_name.trim() : ""
  const providedMimeType = typeof input?.mimetype === "string" ? input.mimetype.trim() : ""

  if (!base64Input && !documentUrl) {
    return null
  }

  let buffer = null
  let mimeType = providedMimeType || null
  let fileName = providedFileName || null

  if (base64Input) {
    const dataUrlMatch = base64Input.match(/^data:([^;]+);base64,(.+)$/s)
    const effectiveBase64 = dataUrlMatch ? dataUrlMatch[2] : base64Input

    if (dataUrlMatch && !mimeType) {
      mimeType = dataUrlMatch[1]
    }

    try {
      buffer = Buffer.from(effectiveBase64, "base64")
    } catch {
      throw createValidationError("document_base64 invalido")
    }
  } else {
    let response
    try {
      response = await fetch(documentUrl)
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Nao foi possivel baixar document_url: ${error.message}`
          : "Nao foi possivel baixar document_url"
      )
    }

    if (!response.ok) {
      throw new Error(`Nao foi possivel baixar document_url (${response.status})`)
    }

    const arrayBuffer = await response.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
    mimeType =
      mimeType || response.headers.get("content-type")?.split(";")[0].trim() || null
    fileName = fileName || getFileNameFromUrl(documentUrl)
  }

  if (!buffer || buffer.length === 0) {
    throw createValidationError("Documento vazio")
  }

  fileName = fileName || "arquivo"
  mimeType = mimeType || inferMimeType(fileName)

  return {
    buffer,
    fileName,
    mimeType,
  }
}

async function ensureGroupParticipants(instance, jid) {
  if (!isGroupJid(jid) || !instance.socket) {
    return
  }

  try {
    await instance.socket.groupMetadata(jid)
  } catch {
    // ignore — best effort to warm up the group key cache
  }
}

async function waitForSocket(instance, timeoutMs = 30000) {
  if (instance.socket) return

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (instance.socket) return
  }

  throw new Error("Bot ainda nao conectado ao WhatsApp")
}

async function waitForSocketUser(instance, timeoutMs = 30000) {
  if (instance.socket?.user) {
    return
  }

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (instance.socket?.user) {
      return
    }
  }

  throw new Error("Bot ainda nao autenticado no WhatsApp")
}

async function waitForCredentials(instance, timeoutMs = 30000) {
  if (instance.socket?.authState?.creds?.me) return

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (instance.socket?.authState?.creds?.me) return
  }

  throw new Error("Credenciais do bot nao carregadas (creds.me indefinido)")
}

async function verifyAndResolveJid(instance, jid) {
  if (isGroupJid(jid) || !isIndividualJid(jid)) {
    return jid
  }

  try {
    const phone = getPhoneFromJid(jid)
    if (!phone) return jid
    const results = await instance.socket.onWhatsApp(phone)
    if (Array.isArray(results) && results.length > 0 && results[0].exists) {
      const verified = results[0].jid
      upsertChatCache(instance, { jid: verified })
      return verified
    }
  } catch {
    // fallback to constructed jid
  }

  return jid
}

async function sendGenericPayload(instance, input) {
  await waitForSocket(instance)
  await waitForSocketUser(instance)
  await waitForCredentials(instance)

  const rawJid = resolveRecipientJid(instance, input)
  const jid = await verifyAndResolveJid(instance, rawJid)
  await ensureGroupParticipants(instance, jid)
  const documentPayload = await resolveDocumentPayload(input)
  const message = typeof input?.message === "string" ? input.message.trim() : ""
  const caption = typeof input?.caption === "string" ? input.caption.trim() : ""
  const text = typeof input?.text === "string" ? input.text.trim() : ""

  const audioBase64 = typeof input?.audio_base64 === "string" ? input.audio_base64.trim() : ""
  if (audioBase64) {
    const audioBuffer = Buffer.from(audioBase64, "base64")
    const isPtt = !isGroupJid(jid)
    await instance.socket.sendMessage(jid, {
      audio: audioBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: isPtt,
    })
    return {
      jid,
      phone: getPhoneFromJid(jid),
      whatsapp_group_id: isGroupJid(jid) ? jid : null,
      has_document: true,
      file_name: "audio.ogg",
      mimetype: "audio/ogg; codecs=opus",
    }
  }

  if (documentPayload) {
    // Forcado para "document" (nao "image") — o envio como imagem passa pelo
    // pipeline de recompressao/thumbnail do WhatsApp, que estava corrompendo
    // relatorios PNG de forma intermitente. Como documento, os bytes vao direto.
    const isImage = false
    // Mimetype de imagem (image/*) faz alguns clientes do WhatsApp tentarem
    // gerar preview/thumbnail mesmo em mensagens de documento. Usamos um
    // mimetype generico para esses casos, evitando qualquer processamento
    // especial de imagem do lado de quem recebe.
    const sendMimeType = documentPayload.mimeType.startsWith("image/")
      ? "application/octet-stream"
      : documentPayload.mimeType
    await instance.socket.sendMessage(jid, isImage
      ? {
          image: documentPayload.buffer,
          caption: caption || message || undefined,
        }
      : {
          document: documentPayload.buffer,
          mimetype: sendMimeType,
          fileName: documentPayload.fileName,
          caption: caption || message || undefined,
        }
    )

    return {
      jid,
      phone: getPhoneFromJid(jid),
      whatsapp_group_id: isGroupJid(jid) ? jid : null,
      has_document: true,
      file_name: documentPayload.fileName,
      mimetype: documentPayload.mimeType,
    }
  }

  const textMessage = text || message || caption
  if (!textMessage) {
    throw createValidationError("Informe uma mensagem ou documento para enviar")
  }

  await instance.socket.sendMessage(jid, { text: textMessage })

  return {
    jid,
    phone: getPhoneFromJid(jid),
    whatsapp_group_id: isGroupJid(jid) ? jid : null,
    has_document: false,
    file_name: null,
    mimetype: null,
  }
}

async function resetAuthState(instanceId) {
  const instance = getInstanceEntry(instanceId)

  if (!fs.existsSync(instance.authDir)) {
    ensureDirectory(instance.authDir)
    return
  }

  // On Windows, rename works even when files are locked, unlike rm/unlink
  const tempDir = `${instance.authDir}_old_${Date.now()}`
  try {
    await fs.promises.rename(instance.authDir, tempDir)
  } catch {
    // If rename also fails, try force delete directly
    await fs.promises.rm(instance.authDir, { recursive: true, force: true }).catch(() => {})
  }

  ensureDirectory(instance.authDir)

  // Clean up the renamed old dir in background without blocking bot startup
  fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
    // Best-effort: if it fails, leave it and try again on next reset
    setTimeout(() => {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }, 5000)
  })
}

function clearRestartTimer(instance) {
  if (instance.restartTimer) {
    clearTimeout(instance.restartTimer)
    instance.restartTimer = null
  }
}

function scheduleBotStart(instanceId, delayMs = 0) {
  const instance = getInstanceEntry(instanceId)
  clearRestartTimer(instance)
  instance.restartTimer = setTimeout(() => {
    instance.restartTimer = null
    startBot(instance.id).catch((error) => {
      console.error(`Erro ao iniciar bot (${instance.id}):`, error)
    })
  }, delayMs)
}

function isRestartLikeAction(action) {
  return action === "restart" || action === "switch_phone"
}

async function applyControlAction(instanceId, action) {
  const instance = getInstanceEntry(instanceId)
  instance.pendingControlAction = action

  if (!instance.socket) {
    instance.allowAuthStateWrites = false
    await resetAuthState(instance.id)
    clearDirectoryCache(instance)

    if (isRestartLikeAction(action)) {
      await writeStoppedRuntimeState(instance.id, "starting")
      instance.pendingControlAction = null
      scheduleBotStart(instance.id, 300)
    } else {
      await writeStoppedRuntimeState(instance.id, "offline")
      instance.pendingControlAction = null
    }

    return
  }

  try {
    clearDirectoryCache(instance)
    instance.allowAuthStateWrites = false
    await writeStoppedRuntimeState(instance.id, isRestartLikeAction(action) ? "starting" : "offline")
    await instance.socket.logout()
  } catch (error) {
    console.error(`Erro ao aplicar acao de controle (${instance.id}):`, error)
    instance.socket = null
    instance.isStarting = false
    await resetAuthState(instance.id)
    clearDirectoryCache(instance)

    if (isRestartLikeAction(action)) {
      await writeStoppedRuntimeState(instance.id, "starting")
      scheduleBotStart(instance.id, 300)
    } else {
      await writeStoppedRuntimeState(instance.id, "offline")
    }

    instance.pendingControlAction = null
  }
}

async function listarGrupos(instance) {
  if (!instance.socket) {
    return
  }

  await refreshGroupDirectory(instance)
  const groups = await instance.socket.groupFetchAllParticipating()

  console.log(`\n=== Grupos do bot (${instance.id}) ===`)
  for (const id in groups) {
    const group = groups[id]
    console.log(`- ${group.subject} -> ${id}`)
  }
  console.log("=== Fim da lista de grupos ===\n")

  void syncContactsToDb(instance)
}

async function getLatestPdfPath(moment, group) {
  const folder = path.join(BASE_DIR, group.pasta)

  if (!fs.existsSync(folder)) {
    console.log(`Pasta nao encontrada para ${group.nome}: ${folder}`)
    return null
  }

  const files = await fs.promises.readdir(folder)
  const pdfs = files.filter((file) => {
    const lower = file.toLowerCase()
    return lower.endsWith(".pdf") && lower.includes(moment.toLowerCase())
  })

  if (pdfs.length === 0) {
    return null
  }

  let latestFile = pdfs[0]
  let latestTime = (await fs.promises.stat(path.join(folder, latestFile))).mtimeMs

  for (const file of pdfs.slice(1)) {
    const fullPath = path.join(folder, file)
    const stats = await fs.promises.stat(fullPath)
    if (stats.mtimeMs > latestTime) {
      latestTime = stats.mtimeMs
      latestFile = file
    }
  }

  return path.join(folder, latestFile)
}

async function sendPdfsForMoment(instance, moment) {
  if (!instance.socket) {
    throw new Error("Bot ainda nao conectado ao WhatsApp")
  }

  console.log(`\n=== Iniciando envio de PDFs (${moment}) [${instance.id}] ===`)

  for (const group of grupos) {
    const filePath = await getLatestPdfPath(moment, group)

    if (!filePath) {
      console.log(`Nenhum PDF encontrado para ${group.nome} (${moment})`)
      continue
    }

    if (!fs.existsSync(filePath)) {
      console.log(`Arquivo nao encontrado para ${group.nome}: ${filePath}`)
      continue
    }

    const buffer = fs.readFileSync(filePath)
    const fileName = path.basename(filePath)
    const caption = `Relatorio ${moment} - ${group.nome}`

    try {
      console.log(`Enviando ${fileName} para ${group.nome} (${group.id})...`)
      await instance.socket.sendMessage(group.id, {
        document: buffer,
        mimetype: "application/pdf",
        fileName,
        caption,
      })
      console.log(`Enviado para ${group.nome}`)
    } catch (error) {
      console.error(`Erro ao enviar para ${group.nome}:`, error?.message || error)
    }
  }

  console.log(`=== Fim do envio (${moment}) [${instance.id}] ===\n`)
}

function bindSocketEvents(instance, saveCreds) {
  instance.socket.ev.on("creds.update", () => {
    if (!instance.allowAuthStateWrites) {
      return
    }

    void saveCreds()
  })

  instance.socket.ev.on("messaging-history.set", async ({ contacts = [], chats = [], messages = [], isLatest }) => {
    contacts.forEach((contact) => upsertContactCache(instance, contact))
    chats.forEach((chat) => upsertChatCache(instance, chat))
    await Promise.all(messages.map((msg) => upsertMessageSenderCache(instance, msg)))
    if (isLatest) {
      await refreshGroupDirectory(instance)
      void syncContactsToDb(instance)
      void writeRuntimeState(instance.id, { contacts_ready: true })
    }
  })

  instance.socket.ev.on("contacts.upsert", (contacts) => {
    contacts.forEach((contact) => upsertContactCache(instance, contact))
  })

  instance.socket.ev.on("contacts.update", (contacts) => {
    contacts.forEach((contact) => upsertContactCache(instance, contact))
  })

  instance.socket.ev.on("chats.upsert", (chats) => {
    chats.forEach((chat) => upsertChatCache(instance, chat))
  })

  instance.socket.ev.on("chats.update", (chats) => {
    chats.forEach((chat) => upsertChatCache(instance, chat))
  })

  instance.socket.ev.on("groups.upsert", (groups) => {
    groups.forEach((group) => upsertGroupCache(instance, group))
    if (instance._groupSyncTimer) clearTimeout(instance._groupSyncTimer)
    instance._groupSyncTimer = setTimeout(() => {
      instance._groupSyncTimer = null
      void syncContactsToDb(instance)
    }, 3000)
  })

  instance.socket.ev.on("groups.update", (groups) => {
    groups.forEach((group) => upsertGroupCache(instance, group))
  })

  instance.socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return
    messages.forEach((msg) => {
      void upsertMessageSenderCache(instance, msg)
    })
  })

  instance.socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      if (instance.pendingPairingPhone) {
        const phone = instance.pendingPairingPhone
        instance.pendingPairingPhone = null
        try {
          const code = await instance.socket.requestPairingCode(phone)
          await writeRuntimeState(instance.id, { pairing_code: code })
          console.log(`Codigo de pareamento gerado (${instance.id}): ${code}`)
        } catch (e) {
          console.error(`Erro ao gerar codigo de pareamento (${instance.id}):`, e?.message || e)
          await writeRuntimeState(instance.id, { pairing_code: `ERR:${e?.message || "falha"}` })
        }
        return
      }

      const qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 512, margin: 1 })

      console.log(`\nLeia este QR (${instance.id}) com o WhatsApp em Dispositivos conectados:\n`)
      qrcodeTerminal.generate(qr, { small: false })

      await writeRuntimeState(instance.id, {
        status: "awaiting_qr",
        qr_code_data_url: qrCodeDataUrl,
        connected_at: null,
        last_error: null,
        phone_number: null,
        display_name: null,
        jid: null,
      })
    }

    if (connection === "open") {
      console.log(`\nConectado ao WhatsApp (${instance.id}).`)
      instance.reconnectAttempts = 0
      const identity = getSocketIdentity(instance.socket)

      await writeRuntimeState(instance.id, {
        status: "connected",
        qr_code_data_url: "",
        connected_at: new Date().toISOString(),
        last_error: null,
        ...identity,
      })

      instance.companyId = await resolveCompanyId(instance.id)

      await listarGrupos(instance)
    }

    if (connection === "close") {
      const controlAction = instance.pendingControlAction
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const wasLoggedOut = statusCode === DisconnectReason.loggedOut
      const errorMessage =
        lastDisconnect?.error?.message ||
        (typeof statusCode === "number" ? `Conexao fechada (${statusCode})` : null)

      instance.socket = null
      instance.isStarting = false

      if (controlAction) {
        instance.pendingControlAction = null
        await resetAuthState(instance.id)
        clearDirectoryCache(instance)

        if (isRestartLikeAction(controlAction)) {
          await writeStoppedRuntimeState(instance.id, "starting")
          console.log(
            controlAction === "switch_phone"
              ? `Sessao anterior removida (${instance.id}). Gerando QR para conectar outro celular...`
              : `Bot reiniciado manualmente (${instance.id}). Gerando novo QR...`
          )
          scheduleBotStart(instance.id, 300)
        } else {
          await writeStoppedRuntimeState(instance.id, "offline")
          console.log(`Bot desconectado manualmente (${instance.id}).`)
        }

        return
      }

      const MAX_RECONNECT_ATTEMPTS = 5
      instance.reconnectAttempts = (instance.reconnectAttempts || 0) + 1
      const giveUp = !wasLoggedOut && instance.reconnectAttempts > MAX_RECONNECT_ATTEMPTS

      await writeRuntimeState(instance.id, {
        status: wasLoggedOut || giveUp ? "offline" : "reconnecting",
        qr_code_data_url: "",
        connected_at: null,
        last_error: giveUp
          ? `Desistiu de reconectar apos ${MAX_RECONNECT_ATTEMPTS} tentativas. Gere um novo QR manualmente. Ultimo erro: ${errorMessage ?? "desconhecido"}`
          : errorMessage,
        phone_number: null,
        display_name: null,
        jid: null,
      })

      {
        const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
        const label = instance.label || instance.id
        if (wasLoggedOut) {
          notifyTelegramAlert(`🚫 *WhatsApp Desconectado*\n📱 *${label}*\n❌ Sessão encerrada pelo WhatsApp (conta banida ou deslogada)\n🕐 ${now}`)
        } else if (giveUp) {
          notifyTelegramAlert(`🚫 *WhatsApp Desconectado*\n📱 *${label}*\n❌ Desistiu apos ${MAX_RECONNECT_ATTEMPTS} tentativas de reconexao — acao manual necessaria (gerar QR)\n🕐 ${now}`)
        } else {
          notifyTelegramAlert(`⚠️ *WhatsApp Desconectado*\n📱 *${label}*\n🔄 Conexão perdida, tentando reconectar (${instance.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...${errorMessage ? `\n🔍 ${errorMessage}` : ""}\n🕐 ${now}`)
        }
      }

      if (wasLoggedOut) {
        console.log(`Sessao desconectada do WhatsApp (${instance.id}). Gere um novo QR reiniciando o bot.`)
        return
      }

      if (giveUp) {
        console.log(`Desistindo de reconectar (${instance.id}) apos ${MAX_RECONNECT_ATTEMPTS} tentativas. Aguardando acao manual (gerar QR).`)
        return
      }

      console.log(`Conexao fechada (${instance.id}). Tentando reconectar em 3 segundos... (tentativa ${instance.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
      scheduleBotStart(instance.id, 3000)
    }
  })
}

async function startBot(instanceId = DEFAULT_INSTANCE_KEY) {
  const instance = getInstanceEntry(instanceId)

  if (instance.isStarting || instance.socket) {
    return
  }

  instance.isStarting = true
  instance.allowAuthStateWrites = true
  clearRestartTimer(instance)

  await writeRuntimeState(instance.id, {
    status: "starting",
    qr_code_data_url: "",
    last_error: null,
    phone_number: null,
    display_name: null,
    jid: null,
    contacts_ready: false,
  })

  try {
    const { state, saveCreds } = await useMultiFileAuthState(instance.authDir)
    const { version } = await fetchLatestBaileysVersion()

    instance.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["SolucaoInteligenteBot", "Chrome", "1.0.0"],
      syncFullHistory: true,
      getMessage: async () => ({ conversation: "" }),
    })

    bindSocketEvents(instance, saveCreds)
  } catch (error) {
    instance.socket = null
    await writeRuntimeState(instance.id, {
      status: "error",
      qr_code_data_url: "",
      connected_at: null,
      last_error: error instanceof Error ? error.message : "Erro ao iniciar bot",
      phone_number: null,
      display_name: null,
      jid: null,
    })
    console.error(`Erro ao iniciar bot (${instance.id}):`, error)
  } finally {
    instance.isStarting = false
  }
}

function legacyAuthHasState() {
  try {
    return fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).length > 0
  } catch {
    return false
  }
}

function legacyRuntimeHasState() {
  return fs.existsSync(QR_STATE_PATH)
}

function listKnownInstanceIds() {
  const known = new Set()

  if (legacyAuthHasState() || legacyRuntimeHasState()) {
    known.add(DEFAULT_INSTANCE_KEY)
  }

  try {
    for (const entry of fs.readdirSync(AUTH_INSTANCES_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        known.add(normalizeInstanceId(entry.name))
      }
    }
  } catch {
    // noop
  }

  try {
    for (const entry of fs.readdirSync(RUNTIME_INSTANCES_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        known.add(normalizeInstanceId(entry.name.replace(/\.json$/i, "")))
      }
    }
  } catch {
    // noop
  }

  return [...known]
}

async function bootstrapKnownInstances() {
  const knownInstanceIds = listKnownInstanceIds()

  for (const instanceId of knownInstanceIds) {
    const runtimeState = await readRuntimeState(instanceId)
    if (
      instanceId === DEFAULT_INSTANCE_KEY ||
      runtimeState?.status === "connected" ||
      runtimeState?.status === "reconnecting" ||
      runtimeState?.status === "awaiting_qr" ||
      runtimeState?.status === "starting"
    ) {
      scheduleBotStart(instanceId, 100)
    }
  }
}

function getRequestInstanceId(req) {
  return normalizeInstanceId(req.query?.instance_id || req.body?.instance_id)
}

function getInstanceStatusPayload(runtimeState, instanceId) {
  return (
    runtimeState || {
      ...buildDefaultRuntimeState(instanceId),
      updated_at: null,
    }
  )
}

const app = express()

app.use(
  express.json({
    limit: BODY_LIMIT,
  })
)

app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
    parameterLimit: 100000,
  })
)

app.get("/health", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const runtimeState = await readRuntimeState(instanceId)
  return res.json({
    ok: true,
    base_dir: BASE_DIR,
    instance_id: instanceId,
    status: runtimeState?.status || "offline",
  })
})

app.get("/status", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const runtimeState = await readRuntimeState(instanceId)
  return res.json(getInstanceStatusPayload(runtimeState, instanceId))
})

app.get("/directory", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const instance = getInstanceEntry(instanceId)

  try {
    if (instance.socket) {
      await refreshGroupDirectory(instance)
    }

    return res.json({
      instance_id: instance.id,
      items: await buildDirectory(instance),
    })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao listar diretorio do bot",
    })
  }
})

app.post("/pairing-code", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const phone = (req.body?.phone || "").toString().replace(/\D/g, "")

  if (!phone || phone.length < 10) {
    return res.status(400).json({ error: "Numero invalido. Use apenas digitos com DDI. Ex: 5511999999999" })
  }

  const instance = getInstanceEntry(instanceId)

  if (instance.socket?.user) {
    return res.status(400).json({ error: "Bot ja conectado. Use 'Trocar celular' antes de conectar por numero." })
  }

  try {
    await writeRuntimeState(instance.id, { pairing_code: null })
    instance.pendingPairingPhone = phone

    if (instance.socket) {
      instance.pendingControlAction = "restart"
      instance.socket.end()
    } else {
      await resetAuthState(instance.id)
      clearDirectoryCache(instance)
      await writeStoppedRuntimeState(instance.id, "starting")
      scheduleBotStart(instance.id, 100)
    }

    const maxWait = 30000
    const started = Date.now()
    while (Date.now() - started < maxWait) {
      await new Promise((r) => setTimeout(r, 600))
      const state = await readRuntimeState(instance.id)
      if (typeof state?.pairing_code === "string" && state.pairing_code) {
        const code = state.pairing_code
        await writeRuntimeState(instance.id, { pairing_code: null })
        if (code.startsWith("ERR:")) {
          return res.status(500).json({ error: code.replace("ERR:", "").trim() || "Erro ao gerar codigo de pareamento" })
        }
        return res.json({ code })
      }
      if (state?.status === "connected") {
        return res.status(400).json({ error: "Bot conectou sem gerar codigo. Tente novamente." })
      }
    }

    instance.pendingPairingPhone = null
    return res.status(504).json({ error: "Timeout ao gerar codigo. Verifique se o numero esta correto e tente novamente." })
  } catch (error) {
    instance.pendingPairingPhone = null
    return res.status(500).json({ error: error instanceof Error ? error.message : "Erro interno ao gerar codigo de pareamento" })
  }
})

app.post("/control", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const action =
    req.body?.action === "disconnect" ||
    req.body?.action === "restart" ||
    req.body?.action === "switch_phone"
      ? req.body.action
      : null

  if (!action) {
    return res.status(400).json({ error: "Acao invalida" })
  }

  try {
    await applyControlAction(instanceId, action)
    const runtimeState = await readRuntimeState(instanceId)
    return res.json(getInstanceStatusPayload(runtimeState, instanceId))
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao controlar bot",
    })
  }
})

app.post("/send-pdfs", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const moment = req.body?.moment
  const instance = getInstanceEntry(instanceId)

  if (!["manha", "tarde", "noite"].includes(moment)) {
    return res.status(400).json({ error: "moment invalido" })
  }

  if (!instance.socket) {
    return res.status(503).json({ error: "Bot ainda nao conectado ao WhatsApp" })
  }

  try {
    await sendPdfsForMoment(instance, moment)
    return res.json({ ok: true, moment, instance_id: instance.id })
  } catch (error) {
    console.error(`Erro no endpoint /send-pdfs (${instance.id}):`, error)
    return res.status(500).json({ error: "erro ao enviar PDFs" })
  }
})

app.post("/send", async (req, res) => {
  const instanceId = getRequestInstanceId(req)
  const instance = getInstanceEntry(instanceId)

  try {
    const result = await sendGenericPayload(instance, req.body ?? {})
    return res.json({
      ok: true,
      instance_id: instance.id,
      ...result,
    })
  } catch (error) {
    console.error(`Erro no endpoint /send (${instance.id}):`, error)
    return res.status(isValidationError(error) ? 400 : 500).json({
      error:
        error instanceof Error ? error.message : "Erro ao enviar mensagem pelo bot",
    })
  }
})

app.listen(HTTP_PORT, () => {
  console.log(`Servidor do bot ouvindo em http://localhost:${HTTP_PORT}`)
  console.log(`Base dos PDFs: ${BASE_DIR}`)
  console.log(
    'Endpoint: POST /send { "instance_id?", "phone|whatsapp_group_id|jid", "message?", "document_base64?", "document_url?" }'
  )
})

bootstrapKnownInstances().catch((error) => {
  console.error("Erro fatal ao iniciar bots conhecidos:", error)
})
