import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import * as os from "os"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"

// Snapshot de saude da VPS + da operacao, para o watchdog/agente do n8n.
// Auth: secret da plataforma (?secret= ou header x-callback-secret).
//
// Retorna metricas + um array "alerts" ja avaliado contra limites, cada um com
// "auto_action" quando ha uma tratativa segura conhecida.

const STUCK_MIN = Number(process.env.DISPATCH_STUCK_TIMEOUT_MINUTES) || 10
const STUCK_CHROME_SEC = 8 * 60 // captura normal < 3 min
const LOAD_PER_CPU_WARN = 3
const MEM_USED_WARN_PCT = 88
const DISK_WARN_PCT = 85
const FAILED_HOUR_WARN = 8

// ── metricas de sistema (Linux; degrada gracioso fora de Linux) ────────────
async function readProcStatCpu(): Promise<number[] | null> {
  try {
    const txt = await fs.readFile("/proc/stat", "utf8")
    const line = txt.split("\n").find((l) => l.startsWith("cpu "))
    if (!line) return null
    return line.trim().split(/\s+/).slice(1).map(Number)
  } catch {
    return null
  }
}

async function getStealPct(): Promise<number | null> {
  const a = await readProcStatCpu()
  if (!a) return null
  await new Promise((r) => setTimeout(r, 1000))
  const b = await readProcStatCpu()
  if (!b) return null
  const totalA = a.reduce((s, v) => s + v, 0)
  const totalB = b.reduce((s, v) => s + v, 0)
  const dTotal = totalB - totalA
  const dSteal = (b[7] ?? 0) - (a[7] ?? 0) // campo 8 = steal
  if (dTotal <= 0) return null
  return Math.round((dSteal / dTotal) * 1000) / 10
}

async function getMemInfo() {
  try {
    const txt = await fs.readFile("/proc/meminfo", "utf8")
    const kb = (k: string) => {
      const m = txt.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"))
      return m ? Number(m[1]) : null
    }
    const total = kb("MemTotal")
    const avail = kb("MemAvailable")
    if (total && avail != null) {
      return {
        total_mb: Math.round(total / 1024),
        available_mb: Math.round(avail / 1024),
        used_pct: Math.round((1 - avail / total) * 100),
      }
    }
  } catch {
    /* fallthrough */
  }
  const total = os.totalmem()
  const free = os.freemem()
  return {
    total_mb: Math.round(total / 1048576),
    available_mb: Math.round(free / 1048576),
    used_pct: Math.round((1 - free / total) * 100),
  }
}

async function getDiskPct(): Promise<number | null> {
  try {
    const s = await fs.statfs("/") // Node >= 18.15
    const used = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize)
    const total = Number(s.blocks) * Number(s.bsize)
    return total > 0 ? Math.round((used / total) * 100) : null
  } catch {
    return null
  }
}

async function countChromeProcs() {
  try {
    const entries = await fs.readdir("/proc")
    let chrome = 0
    let stuckWorkers = 0
    const now = Date.now()
    for (const pid of entries) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const comm = (await fs.readFile(`/proc/${pid}/comm`, "utf8")).trim()
        if (comm === "chrome" || comm === "chromium") chrome++
        if (comm === "node") {
          const cmd = (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ")
          if (/chrome-capture[^ ]*\.js/.test(cmd)) {
            const st = await fs.stat(`/proc/${pid}`)
            if ((now - st.mtimeMs) / 1000 > STUCK_CHROME_SEC) stuckWorkers++
          }
        }
      } catch {
        /* processo sumiu no meio */
      }
    }
    return { chrome_processes: chrome, stuck_capture_workers: stuckWorkers }
  } catch {
    return { chrome_processes: null, stuck_capture_workers: null }
  }
}

export async function GET(request: NextRequest) {
  try {
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }
    const { searchParams } = new URL(request.url)
    const incomingSecret =
      request.headers.get("x-callback-secret")?.trim() ||
      searchParams.get("secret")?.trim() ||
      ""
    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const supabase = createClient()
    const now = new Date()
    const stuckCutoff = new Date(now.getTime() - STUCK_MIN * 60 * 1000).toISOString()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

    const [
      steal,
      mem,
      disk,
      procs,
      { data: stuckRows },
      { data: failedRows },
      { data: companies },
      { data: instances },
    ] = await Promise.all([
      getStealPct(),
      getMemInfo(),
      getDiskPct(),
      countChromeProcs(),
      supabase
        .from("dispatch_logs")
        .select("id, company_id, report_name, created_at")
        .in("status", ["sending", "pending"])
        .lt("created_at", stuckCutoff),
      supabase
        .from("dispatch_logs")
        .select("company_id, error_message")
        .eq("status", "failed")
        .gte("created_at", hourAgo),
      supabase.from("companies").select("id, name"),
      supabase
        .from("whatsapp_bot_instances")
        .select("id, company_id, name")
        .order("created_at", { ascending: true }),
    ])

    const companyName = new Map<string, string>(
      (companies ?? []).map((c) => [c.id, c.name])
    )

    // ── dispatches travados ──
    const stuck = stuckRows ?? []
    const stuckOldestMin =
      stuck.length > 0
        ? Math.round(
            (now.getTime() - Math.min(...stuck.map((r) => new Date(r.created_at).getTime()))) /
              60000
          )
        : 0
    const stuckByCompany = new Map<string, number>()
    for (const r of stuck) {
      const key = r.company_id ?? "?"
      stuckByCompany.set(key, (stuckByCompany.get(key) ?? 0) + 1)
    }

    // ── falhas na ultima hora ──
    const failed = failedRows ?? []
    const failedByCompany = new Map<string, number>()
    const errorCount = new Map<string, number>()
    for (const r of failed) {
      const key = r.company_id ?? "?"
      failedByCompany.set(key, (failedByCompany.get(key) ?? 0) + 1)
      if (r.error_message) {
        const m = r.error_message.slice(0, 100)
        errorCount.set(m, (errorCount.get(m) ?? 0) + 1)
      }
    }
    const topError = [...errorCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? null

    // ── whatsapp ──
    const waStates = await Promise.all(
      (instances ?? []).map(async (inst) => {
        const rt = await readWhatsAppBotRuntimeState(inst.id).catch(() => null)
        return {
          id: inst.id,
          name: inst.name || companyName.get(inst.company_id) || inst.id,
          status: rt?.status ?? "offline",
        }
      })
    )
    const waOffline = waStates.filter((w) => w.status !== "connected")

    // ── sistema ──
    const cpuCount = os.cpus()?.length ?? 1
    const load1 = os.loadavg()[0]
    const loadPerCpu = Math.round((load1 / cpuCount) * 100) / 100

    // ── alertas + acao automatica ──
    const alerts: Array<{
      level: "warn" | "crit"
      code: string
      msg: string
      auto_action: string | null
    }> = []

    if (stuck.length > 0) {
      alerts.push({
        level: stuckOldestMin > STUCK_MIN * 2 ? "crit" : "warn",
        code: "dispatch_stuck",
        msg: `${stuck.length} disparo(s) travado(s), mais antigo ha ${stuckOldestMin} min`,
        auto_action: stuckOldestMin > STUCK_MIN * 2 ? "resend_failed" : null,
      })
    }
    if (failed.length >= FAILED_HOUR_WARN) {
      alerts.push({
        level: "warn",
        code: "many_failures",
        msg: `${failed.length} falhas na ultima hora${topError ? ` — "${topError[0]}" (${topError[1]}x)` : ""}`,
        auto_action: null,
      })
    }
    if (procs.stuck_capture_workers && procs.stuck_capture_workers > 0) {
      alerts.push({
        level: "warn",
        code: "stuck_chrome",
        msg: `${procs.stuck_capture_workers} worker(s) de captura preso(s) (> ${STUCK_CHROME_SEC / 60} min)`,
        auto_action: "kill_stuck_chrome",
      })
    }
    if (steal != null && steal > 25) {
      alerts.push({
        level: steal > 50 ? "crit" : "warn",
        code: "cpu_steal",
        msg: `CPU steal em ${steal}% — throttle da Hostinger`,
        auto_action: null,
      })
    }
    if (loadPerCpu > LOAD_PER_CPU_WARN) {
      alerts.push({
        level: "warn",
        code: "high_load",
        msg: `load ${load1.toFixed(2)} / ${cpuCount} vCPU`,
        auto_action: null,
      })
    }
    if (mem.used_pct >= MEM_USED_WARN_PCT) {
      alerts.push({
        level: mem.used_pct >= 95 ? "crit" : "warn",
        code: "high_mem",
        msg: `RAM em ${mem.used_pct}% (${mem.available_mb} MB livres)`,
        auto_action: "restart_app",
      })
    }
    if (disk != null && disk >= DISK_WARN_PCT) {
      alerts.push({
        level: disk >= 95 ? "crit" : "warn",
        code: "high_disk",
        msg: `disco em ${disk}%`,
        auto_action: "clean_temp",
      })
    }
    if (waOffline.length > 0) {
      alerts.push({
        level: "warn",
        code: "whatsapp_offline",
        msg: `WhatsApp offline: ${waOffline.map((w) => w.name).join(", ")}`,
        auto_action: null, // precisa de QR
      })
    }

    return NextResponse.json({
      checked_at: now.toISOString(),
      healthy: alerts.filter((a) => a.level === "crit").length === 0 && alerts.length === 0,
      system: {
        load1: Math.round(load1 * 100) / 100,
        load5: Math.round(os.loadavg()[1] * 100) / 100,
        cpu_count: cpuCount,
        load_per_cpu: loadPerCpu,
        steal_pct: steal,
        mem_used_pct: mem.used_pct,
        mem_available_mb: mem.available_mb,
        disk_used_pct: disk,
      },
      capture: {
        chrome_processes: procs.chrome_processes,
        stuck_capture_workers: procs.stuck_capture_workers,
      },
      dispatch: {
        stuck: stuck.length,
        stuck_oldest_minutes: stuckOldestMin,
        stuck_by_company: [...stuckByCompany.entries()].map(([id, n]) => ({
          company: companyName.get(id) ?? id,
          count: n,
        })),
        failed_last_hour: failed.length,
        failed_by_company: [...failedByCompany.entries()]
          .map(([id, n]) => ({ company: companyName.get(id) ?? id, count: n }))
          .sort((a, b) => b.count - a.count),
        top_error: topError ? { message: topError[0], count: topError[1] } : null,
      },
      whatsapp: {
        total: waStates.length,
        connected: waStates.length - waOffline.length,
        offline: waOffline.map((w) => w.name),
      },
      alerts,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao checar saude" },
      { status: 500 }
    )
  }
}
