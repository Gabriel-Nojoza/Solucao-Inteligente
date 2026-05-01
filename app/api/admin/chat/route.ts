import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"
import { getCatalogMap } from "@/lib/automation-catalog"
import {
  buildChatSystemPrompt,
  buildConversationMessages,
  extractWebhookAnswer,
  injectCustomMeasuresIntoDax,
  validateQueryPlan,
  formatDataAnswer,
  withCustomChatMeasures,
  type ChatRequest,
  type ChatApiResponse,
  type ChatQueryPlan,
  type DatasetMetadata,
} from "@/lib/chat"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function buildChatSessionId(input: {
  userId: string
  companyId: string
  workspaceId: string
  datasetId: string
}) {
  return `admin:${input.userId}:${input.companyId}:${input.workspaceId}:${input.datasetId}`
}

function parseQueryPlan(raw: string): ChatQueryPlan | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (!parsed.daxQuery || typeof parsed.daxQuery !== "string") return null
    return {
      selectedColumns: Array.isArray(parsed.selectedColumns) ? parsed.selectedColumns as ChatQueryPlan["selectedColumns"] : [],
      selectedMeasures: Array.isArray(parsed.selectedMeasures) ? parsed.selectedMeasures as ChatQueryPlan["selectedMeasures"] : [],
      filters: Array.isArray(parsed.filters) ? parsed.filters as ChatQueryPlan["filters"] : [],
      daxQuery: parsed.daxQuery,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "Consulta gerada.",
      confidence: (["high", "medium", "low"].includes(String(parsed.confidence)) ? parsed.confidence : "medium") as ChatQueryPlan["confidence"],
    }
  } catch {
    return null
  }
}

async function callOpenAIDirect(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  attempt = 0
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages,
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  })

  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "") || (attempt + 1) * 2
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
    return callOpenAIDirect(messages, attempt + 1)
  }

  if (!response.ok) throw new Error(`OpenAI error ${response.status}`)
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices?.[0]?.message?.content ?? ""
}

async function loadMetadata(token: string, datasetId: string, companyId: string): Promise<DatasetMetadata> {
  const catalogs = await getCatalogMap(companyId)
  const entry = catalogs[datasetId]
  if (entry?.catalog && (
    (entry.catalog.tables?.length ?? 0) > 0 ||
    (entry.catalog.columns?.length ?? 0) > 0 ||
    (entry.catalog.measures?.length ?? 0) > 0
  )) {
    return {
      tables: (entry.catalog.tables ?? []) as unknown as DatasetMetadata["tables"],
      columns: (entry.catalog.columns ?? []) as unknown as DatasetMetadata["columns"],
      measures: (entry.catalog.measures ?? []) as unknown as DatasetMetadata["measures"],
    }
  }

  const { getDatasetMetadata } = await import("@/lib/powerbi")
  const metadata = await getDatasetMetadata(token, datasetId)
  return { tables: metadata.tables ?? [], columns: metadata.columns ?? [], measures: metadata.measures ?? [] }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdminContext()
    const supabase = getAdminClient()

    const body = (await request.json()) as ChatRequest & { companyId: string; chartType?: string }
    const { question, datasetId, workspaceId, conversationHistory = [], companyId, chartType } = body

    if (!companyId) {
      return NextResponse.json<ChatApiResponse>(
        { answer: "Selecione uma empresa.", data: null, daxQuery: null, confidence: "low" },
        { status: 400 }
      )
    }

    if (!question?.trim()) {
      return NextResponse.json<ChatApiResponse>(
        { answer: "Por favor, faça uma pergunta.", data: null, daxQuery: null, confidence: "low" },
        { status: 400 }
      )
    }

    if (!datasetId || !workspaceId) {
      return NextResponse.json<ChatApiResponse>(
        { answer: "Selecione um workspace e dataset.", data: null, daxQuery: null, confidence: "low" },
        { status: 400 }
      )
    }

    const sessionId = buildChatSessionId({
      userId: adminContext.userId,
      companyId,
      workspaceId,
      datasetId,
    })

    // Valida que o workspace/dataset pertence à empresa selecionada
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id, pbi_workspace_id")
      .eq("company_id", companyId)
      .eq("pbi_workspace_id", workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json<ChatApiResponse>(
        { answer: "Workspace não pertence a esta empresa.", data: null, daxQuery: null, confidence: "low" },
        { status: 403 }
      )
    }

    const token = await getAccessToken(companyId)
    const metadata = withCustomChatMeasures(await loadMetadata(token, datasetId, companyId))

    if (metadata.columns.length === 0 && metadata.measures.length === 0) {
      return NextResponse.json<ChatApiResponse>({
        answer: "Não foi possível carregar os metadados do dataset. Importe o catálogo via Scanner API primeiro.",
        data: null,
        daxQuery: null,
        confidence: "low",
      })
    }

    const todayDate = getTodayDate()
    const systemPrompt = buildChatSystemPrompt(metadata, todayDate)
    const messages = buildConversationMessages(systemPrompt, conversationHistory, question)

    // Busca webhook: prioriza chat_ia da empresa, depois n8n, depois OpenAI
    let rawResponse = ""
    const { data: chatIaRow } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "chat_ia")
      .maybeSingle()

    const chatIaWebhookUrl = typeof (chatIaRow?.value as Record<string, unknown> | null)?.webhook_url === "string"
      ? ((chatIaRow!.value as Record<string, unknown>).webhook_url as string).trim()
      : null

    const { data: n8nRow } = !chatIaWebhookUrl ? await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "n8n")
      .maybeSingle() : { data: null }

    const n8nWebhookUrl = !chatIaWebhookUrl && typeof (n8nRow?.value as Record<string, unknown> | null)?.chat_webhook_url === "string"
      ? (n8nRow!.value as Record<string, unknown>).chat_webhook_url as string
      : null

    const webhookUrl = chatIaWebhookUrl || n8nWebhookUrl

    // ── Fluxo N8N com pedido de gráfico: pede dados estruturados pelo próprio webhook ──
    if (webhookUrl && chartType) {
      const chartQuestion = `[CHART_REQUEST] Repita a última consulta e retorne APENAS um JSON no formato exato (sem markdown, sem texto): {"columns":[{"name":"NomeColuna","dataType":"String"}],"rows":[{"NomeColuna":"valor"}]}`
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, chatInput: chartQuestion, question: chartQuestion, metadata, conversationHistory, todayDate }),
      })
      if (resp.ok) {
        const raw = await resp.json() as Record<string, unknown>
        const rawText = (typeof raw.output === "string" ? raw.output : typeof raw.answer === "string" ? raw.answer : JSON.stringify(raw)).trim()
        try {
          const cleaned = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim()
          const parsed = JSON.parse(cleaned) as { columns?: unknown[]; rows?: unknown[] }
          if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const queryResult = {
              columns: parsed.columns as Array<{ name: string; dataType: string }>,
              rows: parsed.rows as Array<Record<string, unknown>>,
            }
            return NextResponse.json<ChatApiResponse>({
              answer: "Aqui está o gráfico:",
              data: queryResult,
              daxQuery: null,
              confidence: "high",
              chartType: chartType as ChatApiResponse["chartType"],
            })
          }
        } catch { /* fallthrough to OpenAI */ }
      }
    }

    // ── Fluxo N8N normal: AI Agent retorna resposta em texto ──
    if (webhookUrl && !chartType) {
      try {
        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, chatInput: question, question, metadata, conversationHistory, todayDate }),
        })

        if (resp.ok) {
          const data = await resp.json() as Record<string, unknown>
          const answer = extractWebhookAnswer(data)

          return NextResponse.json<ChatApiResponse>({
            answer,
            data: null,
            daxQuery: null,
            confidence: "high",
          })
        }
        // N8N retornou erro (4xx/5xx) — cai no fallback OpenAI abaixo
      } catch {
        // N8N inacessível — cai no fallback OpenAI abaixo
      }
    }

    // ── Fluxo OpenAI direto: gera DAX com retry em caso de erro ──
    const currentMessages = [...messages]
    let plan: ReturnType<typeof parseQueryPlan> = null
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      rawResponse = await callOpenAIDirect(currentMessages)
      plan = parseQueryPlan(rawResponse)

      if (!plan) {
        if (attempt < maxAttempts) {
          currentMessages.push({ role: "assistant", content: rawResponse })
          currentMessages.push({ role: "user", content: "Erro: resposta não é um JSON válido com daxQuery. Retorne APENAS o JSON no formato especificado." })
          continue
        }
        throw new Error("Não foi possível gerar uma query válida.")
      }

      const validation = validateQueryPlan(plan, metadata)
      if (!validation.valid) {
        if (attempt < maxAttempts) {
          currentMessages.push({ role: "assistant", content: rawResponse })
          currentMessages.push({ role: "user", content: `Corrija os erros e retorne o JSON corrigido: ${validation.errors.join("; ")}. Use APENAS tabelas/colunas/medidas do schema fornecido.` })
          plan = null
          continue
        }
        throw new Error(`Query inválida: ${validation.errors.join("; ")}`)
      }

      break
    }

    if (!plan) throw new Error("Não foi possível gerar uma query válida.")

    const executableDax = injectCustomMeasuresIntoDax(plan.daxQuery)
    const rawResult = await executeDAXQuery(token, datasetId, executableDax)
    const queryResult = { columns: rawResult.columns ?? [], rows: rawResult.rows ?? [] }
    const answer = formatDataAnswer(plan.explanation, queryResult.columns, queryResult.rows)

    return NextResponse.json<ChatApiResponse>({
      answer,
      data: queryResult,
      daxQuery: executableDax,
      confidence: plan.confidence,
      chartType: chartType as ChatApiResponse["chartType"] ?? undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido"
    return NextResponse.json<ChatApiResponse>(
      { answer: `Erro: ${message}`, data: null, daxQuery: null, confidence: "low", error: message },
      { status: 500 }
    )
  }
}
