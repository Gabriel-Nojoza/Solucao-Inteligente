import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys"
import QRCode from "qrcode"
import qrcodeTerminal from "qrcode-terminal"
import express from "express"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HTTP_PORT = Number(process.env.BOT_PORT || 3010)
const AUTH_DIR = path.join(__dirname, "auth")
const RUNTIME_DIR = path.join(__dirname, "runtime")
const QR_STATE_PATH = path.join(RUNTIME_DIR, "qr-state.json")
const BASE_DIR =
  process.env.BOT_PDF_BASE_DIR || path.resolve(__dirname, "..", "..", "bot-pdf")

const grupos = [
  { nome: "Grupo 1", id: "120363406411408946@g.us", pasta: "grupo-1" },
  { nome: "Grupo 2", id: "120363407240392123@g.us", pasta: "grupo-2" },
  { nome: "Grupo 3", id: "120363423749941918@g.us", pasta: "grupo-3" },
  { nome: "Grupo 4", id: "120363406391767151@g.us", pasta: "grupo-4" },
  { nome: "Grupo 5", id: "120363407737340800@g.us", pasta: "grupo-5" },
  { nome: "Grupo 6", id: "120363424874021737@g.us", pasta: "grupo-6" },
  { nome: "Grupo 7", id: "120363422804615911@g.us", pasta: "grupo-7" },
]

let sock = null
let isStarting = false
let pendingControlAction = null
const botContacts = new Map()
const botChats = new Map()
const botGroups = new Map()

ensureDirectory(AUTH_DIR)
ensureDirectory(RUNTIME_DIR)

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

async function readRuntimeState() {
  try {
    const raw = await fs.promises.readFile(QR_STATE_PATH, "utf-8")
    return JSON.parse(raw)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null
    }
    console.error("Erro ao ler estado do QR:", error)
    return null
  }
}

async function writeRuntimeState(patch) {
  const current = (await readRuntimeState()) || {}
  const nextState = {
    status: "offline",
    qr_code_data_url: "",
    updated_at: new Date().toISOString(),
    connected_at: null,
    last_error: null,
    phone_number: null,
    display_name: null,
    jid: null,
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  }

  await fs.promises.writeFile(QR_STATE_PATH, JSON.stringify(nextState, null, 2), "utf-8")
  return nextState
}

function clearDirectoryCache() {
  botContacts.clear()
  botChats.clear()
  botGroups.clear()
}

async function writeStoppedRuntimeState(status = "offline") {
  return writeRuntimeState({
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
  const displayName =
    user?.verifiedName || user?.name || user?.notify || phoneNumber || null

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
  if (!normalized || isGroupJid(normalized) || normalized === "status@broadcast") {
    return null
  }

  const phone = normalized.split(":")[0].split("@")[0].replace(/\D/g, "")
  return phone || null
}

function upsertContactCache(contact) {
  const jid = getNormalizedJid(contact?.id || contact?.jid || contact?.phoneNumber)
  if (!jid) {
    return
  }

  const existing = botContacts.get(jid) || {}
  botContacts.set(jid, {
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

function upsertChatCache(chat) {
  const jid = getNormalizedJid(chat?.id || chat?.jid)
  if (!jid) {
    return
  }

  const existing = botChats.get(jid) || {}
  botChats.set(jid, {
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

function upsertGroupCache(group) {
  const jid = getNormalizedJid(group?.id)
  if (!jid) {
    return
  }

  botGroups.set(jid, {
    jid,
    name:
      typeof group?.subject === "string" && group.subject.trim()
        ? group.subject.trim()
        : botGroups.get(jid)?.name || "Grupo",
  })
}

async function refreshGroupDirectory(socket) {
  if (!socket) {
    return
  }

  const groups = await socket.groupFetchAllParticipating()
  for (const groupId in groups) {
    upsertGroupCache(groups[groupId])
  }
}

function buildDirectory() {
  const items = []
  const ownJid = getNormalizedJid(sock?.user?.id)

  for (const [jid, group] of botGroups.entries()) {
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
  const individualJids = new Set([...botContacts.keys(), ...botChats.keys()])
  for (const jid of individualJids) {
    if (!isIndividualJid(jid) || jid === ownJid) {
      continue
    }

    const phone = botContacts.get(jid)?.phoneNumber || getPhoneFromJid(jid)
    if (!phone) {
      continue
    }

    if (seenIndividuals.has(phone)) {
      continue
    }
    seenIndividuals.add(phone)

    const name =
      botContacts.get(jid)?.name ||
      botChats.get(jid)?.name ||
      phone

    items.push({
      jid,
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

async function resetAuthState() {
  await fs.promises.rm(AUTH_DIR, { recursive: true, force: true })
  ensureDirectory(AUTH_DIR)
}

function scheduleBotStart(delayMs = 0) {
  setTimeout(() => {
    startBot().catch((error) => {
      console.error("Erro ao iniciar bot:", error)
    })
  }, delayMs)
}

async function applyControlAction(action) {
  pendingControlAction = action

  if (!sock) {
    await resetAuthState()
    clearDirectoryCache()

    if (action === "restart") {
      await writeStoppedRuntimeState("starting")
      pendingControlAction = null
      scheduleBotStart(300)
    } else {
      await writeStoppedRuntimeState("offline")
      pendingControlAction = null
    }

    return
  }

  try {
    clearDirectoryCache()
    await writeStoppedRuntimeState(action === "restart" ? "starting" : "offline")
    await sock.logout()
  } catch (error) {
    console.error("Erro ao aplicar acao de controle:", error)
    sock = null
    isStarting = false
    await resetAuthState()
    clearDirectoryCache()

    if (action === "restart") {
      await writeStoppedRuntimeState("starting")
      scheduleBotStart(300)
    } else {
      await writeStoppedRuntimeState("offline")
    }

    pendingControlAction = null
  }
}

async function listarGrupos(socket) {
  await refreshGroupDirectory(socket)
  const groups = await socket.groupFetchAllParticipating()

  console.log("\n=== Grupos onde o bot esta ===")
  for (const id in groups) {
    const group = groups[id]
    console.log(`- ${group.subject} -> ${id}`)
  }
  console.log("=== Fim da lista de grupos ===\n")
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

async function sendPdfsForMoment(socket, moment) {
  console.log(`\n=== Iniciando envio de PDFs (${moment}) ===`)

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
      await socket.sendMessage(group.id, {
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

  console.log(`=== Fim do envio (${moment}) ===\n`)
}

async function startBot() {
  if (isStarting) {
    return
  }

  isStarting = true
  await writeRuntimeState({
    status: "starting",
    qr_code_data_url: "",
    last_error: null,
    phone_number: null,
    display_name: null,
    jid: null,
  })

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const { version } = await fetchLatestBaileysVersion()

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["SolucaoInteligenteBot", "Chrome", "1.0.0"],
    })

    sock.ev.on("creds.update", saveCreds)
    sock.ev.on("messaging-history.set", ({ contacts = [], chats = [] }) => {
      contacts.forEach((contact) => upsertContactCache(contact))
      chats.forEach((chat) => upsertChatCache(chat))
    })
    sock.ev.on("contacts.upsert", (contacts) => {
      contacts.forEach((contact) => upsertContactCache(contact))
    })
    sock.ev.on("contacts.update", (contacts) => {
      contacts.forEach((contact) => upsertContactCache(contact))
    })
    sock.ev.on("chats.upsert", (chats) => {
      chats.forEach((chat) => upsertChatCache(chat))
    })
    sock.ev.on("chats.update", (chats) => {
      chats.forEach((chat) => upsertChatCache(chat))
    })
    sock.ev.on("groups.upsert", (groups) => {
      groups.forEach((group) => upsertGroupCache(group))
    })
    sock.ev.on("groups.update", (groups) => {
      groups.forEach((group) => upsertGroupCache(group))
    })

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        const qrCodeDataUrl = await QRCode.toDataURL(qr, {
          width: 512,
          margin: 1,
        })

        console.log("\nLeia este QR com o WhatsApp em Dispositivos conectados:\n")
        qrcodeTerminal.generate(qr, { small: false })

        await writeRuntimeState({
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
        console.log("\nConectado ao WhatsApp.")
        console.log("Deixe este processo rodando.\n")
        const identity = getSocketIdentity(sock)

        await writeRuntimeState({
          status: "connected",
          qr_code_data_url: "",
          connected_at: new Date().toISOString(),
          last_error: null,
          ...identity,
        })

        await listarGrupos(sock)
      }

      if (connection === "close") {
        const controlAction = pendingControlAction
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const wasLoggedOut = statusCode === DisconnectReason.loggedOut
        const errorMessage =
          lastDisconnect?.error?.message ||
          (typeof statusCode === "number" ? `Conexao fechada (${statusCode})` : null)

        sock = null
        isStarting = false

        if (controlAction) {
          pendingControlAction = null
          await resetAuthState()
          clearDirectoryCache()

          if (controlAction === "restart") {
            await writeStoppedRuntimeState("starting")
            console.log("Bot reiniciado manualmente. Gerando novo QR...")
            scheduleBotStart(300)
          } else {
            await writeStoppedRuntimeState("offline")
            console.log("Bot desconectado manualmente.")
          }

          return
        }

        await writeRuntimeState({
          status: wasLoggedOut ? "offline" : "reconnecting",
          qr_code_data_url: "",
          connected_at: null,
          last_error: errorMessage,
          phone_number: null,
          display_name: null,
          jid: null,
        })

        if (wasLoggedOut) {
          console.log("Sessao desconectada do WhatsApp. Gere um novo QR reiniciando o bot.")
          return
        }

        console.log("Conexao fechada. Tentando reconectar em 3 segundos...")
        scheduleBotStart(3000)
      }
    })
  } catch (error) {
    sock = null
    await writeRuntimeState({
      status: "error",
      qr_code_data_url: "",
      connected_at: null,
      last_error: error instanceof Error ? error.message : "Erro ao iniciar bot",
      phone_number: null,
      display_name: null,
      jid: null,
    })
    console.error("Erro ao iniciar bot:", error)
  } finally {
    isStarting = false
  }
}

const app = express()
app.use(express.json())

app.get("/health", async (_req, res) => {
  const runtimeState = await readRuntimeState()
  return res.json({
    ok: true,
    base_dir: BASE_DIR,
    status: runtimeState?.status || "offline",
  })
})

app.get("/status", async (_req, res) => {
  const runtimeState = await readRuntimeState()
  return res.json(
    runtimeState || {
      status: "offline",
      qr_code_data_url: "",
      updated_at: null,
      connected_at: null,
      last_error: null,
      phone_number: null,
      display_name: null,
      jid: null,
    }
  )
})

app.get("/directory", async (_req, res) => {
  try {
    if (sock) {
      await refreshGroupDirectory(sock)
    }

    return res.json({
      items: buildDirectory(),
    })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao listar diretorio do bot",
    })
  }
})

app.post("/control", async (req, res) => {
  const action =
    req.body?.action === "disconnect" || req.body?.action === "restart"
      ? req.body.action
      : null

  if (!action) {
    return res.status(400).json({ error: "Acao invalida" })
  }

  try {
    await applyControlAction(action)
    const runtimeState = await readRuntimeState()
    return res.json(
      runtimeState || {
        status: action === "restart" ? "starting" : "offline",
        qr_code_data_url: "",
        updated_at: new Date().toISOString(),
        connected_at: null,
        last_error: null,
        phone_number: null,
        display_name: null,
        jid: null,
      }
    )
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Erro ao controlar bot",
    })
  }
})

app.post("/send-pdfs", async (req, res) => {
  const moment = req.body.moment
  if (!["manha", "tarde", "noite"].includes(moment)) {
    return res.status(400).json({ error: "moment invalido" })
  }

  if (!sock) {
    return res.status(503).json({ error: "Bot ainda nao conectado ao WhatsApp" })
  }

  try {
    await sendPdfsForMoment(sock, moment)
    return res.json({ ok: true, moment })
  } catch (error) {
    console.error("Erro no endpoint /send-pdfs:", error)
    return res.status(500).json({ error: "erro ao enviar PDFs" })
  }
})

app.listen(HTTP_PORT, () => {
  console.log(`Servidor do bot ouvindo em http://localhost:${HTTP_PORT}`)
  console.log(`Base dos PDFs: ${BASE_DIR}`)
  console.log('Endpoint: POST /send-pdfs { "moment": "manha|tarde|noite" }')
})

startBot().catch((error) => {
  console.error("Erro fatal ao iniciar bot:", error)
})
