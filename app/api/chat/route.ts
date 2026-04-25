import { NextResponse } from "next/server"
import { getAccessToken, getDatasetMetadata, listDatasets, executeDAXQuery } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import {
  buildDisabledExpiredChatIASettingsValue,
  normalizeChatIASettings,
} from "@/lib/chat-ia-config"
import { getRequestContext } from "@/lib/tenant"
import { getWorkspaceAccessScope, isDatasetAllowed, isWorkspaceAllowed } from "@/lib/workspace-access"
import { getCatalogMap } from "@/lib/automation-catalog"
import {
  buildChatSystemPrompt,
  buildConversationMessages,
  injectCustomMeasuresIntoDax,
  validateQueryPlan,
  formatDataAnswer,
  type ChatRequest,
  type ChatApiResponse,
  type ChatQueryPlan,
  type DatasetMetadata,
  withCustomChatMeasures,
} from "@/lib/chat"

// ─── helpers ─────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function parseQueryPlan(raw: string): ChatQueryPlan | null {
  try {
    // remove possíveis blocos markdown
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim()

    const parsed = JSON.parse(cleaned) as Record<string, unknown>

    if (!parsed.daxQuery || typeof parsed.daxQuery !== "string") return null

    return {
      selectedColumns: Array.isArray(parsed.selectedColumns) ? parsed.selectedColumns as ChatQueryPlan["selectedColumns"] : [],
      selectedMeasures: Array.isArray(parsed.selectedMeasures) ? parsed.selectedMeasures as ChatQueryPlan["selectedMeasures"] : [],
      filters: Array.isArray(parsed.filters) ? parsed.filters as ChatQueryPlan["filters"] : [],
      daxQuery: parsed.daxQuery,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "Consulta gerada com sucesso.",
      confidence: (["high", "medium", "low"].includes(String(parsed.confidence)) ? parsed.confidence : "medium") as ChatQueryPlan["confidence"],
    }
  } catch {
    return null
  }
}

// ─── OpenAI direct call (fallback quando n8n não está configurado) ────────────

async function callOpenAIDirect(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages,
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`OpenAI API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>
  }

  return data.choices?.[0]?.message?.content ?? ""
}

// ─── n8n call (quando chat_webhook_url está configurado) ──────────────────────

async function callN8nChatWebhook(
  webhookUrl: string,
  question: string,
  metadata: DatasetMetadata,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  todayDate: string
): Promise<string> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      metadata,
      conversationHistory,
      todayDate,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`n8n webhook error ${response.status}: ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>

  // Aceita tanto { daxQuery, ... } direto quanto { answer: "..." } com JSON embutido
  if (typeof data.daxQuery === "string") {
    return JSON.stringify(data)
  }

  if (typeof data.answer === "string") {
    return data.answer
  }

  return JSON.stringify(data)
}

// ─── load n8n settings ────────────────────────────────────────────────────────

async function getChatWebhookUrl(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  preferredWebhookUrl = ""
): Promise<string | null> {
  try {
    if (preferredWebhookUrl) {
      return preferredWebhookUrl
    }

    const { data: row } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "n8n")
      .maybeSingle()

    const n8n = row?.value as Record<string, unknown> | null

    // Usa o webhook de chat configurado na chave n8n quando nao houver sobrescrita no chat_ia
    if (typeof n8n?.chat_webhook_url === "string" && n8n.chat_webhook_url.trim()) {
      return n8n.chat_webhook_url.trim()
    }

    return null
  } catch {
    return null
  }
}

// ─── load effective metadata ──────────────────────────────────────────────────

async function loadEffectiveMetadata(
  token: string,
  datasetId: string,
  companyId: string
): Promise<DatasetMetadata> {
  // Tenta catálogo fixo primeiro (scanner API)
  try {
    const { getCatalogMap } = await import("@/lib/automation-catalog")
    const catalogs = await getCatalogMap(companyId)
    const entry = catalogs[datasetId]

    if (
      entry?.catalog &&
      (
        (entry.catalog.tables?.length ?? 0) > 0 ||
        (entry.catalog.columns?.length ?? 0) > 0 ||
        (entry.catalog.measures?.length ?? 0) > 0
      )
    ) {
      return {
        tables: (entry.catalog.tables ?? []) as unknown as DatasetMetadata["tables"],
        columns: (entry.catalog.columns ?? []) as unknown as DatasetMetadata["columns"],
        measures: (entry.catalog.measures ?? []) as unknown as DatasetMetadata["measures"],
      }
    }
  } catch {
    // fallback para metadata ao vivo
  }

  // Metadata ao vivo via Power BI API
  const metadata = await getDatasetMetadata(token, datasetId)
  return {
    tables: metadata.tables ?? [],
    columns: metadata.columns ?? [],
    measures: metadata.measures ?? [],
  }
}

// ─── retry com feedback de erro ───────────────────────────────────────────────

async function generateQueryPlanWithRetry(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  metadata: DatasetMetadata,
  n8nWebhookUrl: string | null,
  question: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  todayDate: string,
  maxAttempts = 2
): Promise<ChatQueryPlan> {
  let lastError = ""
  const currentMessages = [...messages]

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let rawResponse: string

    if (n8nWebhookUrl) {
      rawResponse = await callN8nChatWebhook(n8nWebhookUrl, question, metadata, conversationHistory, todayDate)
    } else {
      rawResponse = await callOpenAIDirect(currentMessages)
    }

    const plan = parseQueryPlan(rawResponse)

    if (!plan) {
      lastError = "Resposta da IA não é um JSON válido com daxQuery"
      if (attempt < maxAttempts) {
        currentMessages.push({
          role: "assistant",
          content: rawResponse,
        })
        currentMessages.push({
          role: "user",
          content: `Erro: ${lastError}. Responda APENAS com o JSON válido conforme o formato especificado.`,
        })
      }
      continue
    }

    const validation = validateQueryPlan(plan, metadata)

    if (!validation.valid && attempt < maxAttempts) {
      lastError = `Query inválida: ${validation.errors.join("; ")}`
      currentMessages.push({
        role: "assistant",
        content: rawResponse,
      })
      currentMessages.push({
        role: "user",
        content: `Corrija os seguintes erros e retorne o JSON corrigido: ${validation.errors.join("; ")}. Use APENAS tabelas/colunas/medidas do schema fornecido.`,
      })
      continue
    }

    return plan
  }

  throw new Error(`Não foi possível gerar uma query válida após ${maxAttempts} tentativas. Último erro: ${lastError}`)
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)

    const body = (await request.json()) as ChatRequest
    const { question, datasetId, workspaceId, conversationHistory = [] } = body

    const { data: chatSettingsRow } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "chat_ia")
      .maybeSingle()

    const chatSettings = normalizeChatIASettings(chatSettingsRow?.value)
    const chatIAIsManaged =
      chatSettings.enabled ||
      !!chatSettings.workspaceId ||
      !!chatSettings.datasetId ||
      !!chatSettings.webhookUrl ||
      chatSettings.trialDays !== null ||
      !!chatSettings.trialEndsAt

    if (chatSettings.isExpired && chatSettings.enabled) {
      await supabase
        .from("company_settings")
        .update({
          value: buildDisabledExpiredChatIASettingsValue(chatSettingsRow?.value),
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("key", "chat_ia")
    }

    if (chatIAIsManaged && !chatSettings.effectiveEnabled) {
      const answer = chatSettings.isExpired
        ? "O periodo de teste do Chat IA expirou. Fale com o administrador para renovar o acesso."
        : "O Chat IA esta desativado para esta empresa."

      return NextResponse.json<ChatApiResponse>(
        {
          answer,
          data: null,
          daxQuery: null,
          confidence: "low",
          error: chatSettings.isExpired ? "Teste do Chat IA expirado" : "Chat IA desativado",
        },
        { status: 403 }
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
        { answer: "Selecione um workspace e dataset antes de fazer perguntas.", data: null, daxQuery: null, confidence: "low" },
        { status: 400 }
      )
    }

    // ── Validar permissões ──
    if (!isWorkspaceAllowed(scope, { pbiWorkspaceId: workspaceId })) {
      return NextResponse.json({ error: "Workspace não permitido" }, { status: 403 })
    }

    if (!isDatasetAllowed(scope, datasetId)) {
      return NextResponse.json({ error: "Dataset não permitido" }, { status: 403 })
    }

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("company_id", companyId)
      .eq("pbi_workspace_id", workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: "Workspace não pertence à empresa" }, { status: 403 })
    }

    const { data: report } = await supabase
      .from("reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("dataset_id", datasetId)
      .limit(1)
      .maybeSingle()

    const catalogs = await getCatalogMap(companyId)
    const catalogEntry = catalogs[datasetId]

    if (!report && !catalogEntry) {
      const token = await getAccessToken()
      const datasets = await listDatasets(token, workspaceId)
      const datasetExists = datasets.some((d) => d.id === datasetId)

      if (!datasetExists) {
        return NextResponse.json({ error: "Dataset não pertence à empresa" }, { status: 403 })
      }
    }

    // ── Carregar metadata ──
    const token = await getAccessToken()
    const metadata = withCustomChatMeasures(
      await loadEffectiveMetadata(token, datasetId, companyId)
    )

    if (
      metadata.columns.length === 0 &&
      metadata.measures.length === 0
    ) {
      return NextResponse.json<ChatApiResponse>({
        answer: "Não foi possível carregar os metadados do dataset. Importe o catálogo via Scanner API primeiro.",
        data: null,
        daxQuery: null,
        confidence: "low",
      })
    }

    // ── Construir prompt e mensagens ──
    const todayDate = getTodayDate()
    const systemPrompt = buildChatSystemPrompt(metadata, todayDate)
    const messages = buildConversationMessages(systemPrompt, conversationHistory, question)

    // ── Verificar se n8n chat webhook está configurado ──
    const n8nWebhookUrl = await getChatWebhookUrl(
      supabase,
      companyId,
      chatSettings.webhookUrl
    )

    // ── Gerar plano de query (com retry) ──
    const plan = await generateQueryPlanWithRetry(
      messages,
      metadata,
      n8nWebhookUrl,
      question,
      conversationHistory,
      todayDate
    )

    // ── Executar DAX ──
    let queryResult: { columns: Array<{ name: string; dataType: string }>; rows: Array<Record<string, unknown>> } | null = null
    let executionError: string | null = null

    try {
      const executableDaxQuery = injectCustomMeasuresIntoDax(plan.daxQuery)
      const rawResult = await executeDAXQuery(token, datasetId, executableDaxQuery)
      queryResult = {
        columns: rawResult.columns ?? [],
        rows: rawResult.rows ?? [],
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : "Erro ao executar query"

      // Retorna resposta parcial com erro de execução
      return NextResponse.json<ChatApiResponse>({
        answer: `${plan.explanation}\n\n⚠️ Não foi possível executar a consulta: ${executionError}`,
        data: null,
        daxQuery: injectCustomMeasuresIntoDax(plan.daxQuery),
        confidence: "low",
        error: executionError,
      })
    }

    // ── Formatar resposta ──
    const answer = formatDataAnswer(
      plan.explanation,
      queryResult.columns,
      queryResult.rows
    )

    return NextResponse.json<ChatApiResponse>({
      answer,
      data: queryResult,
      daxQuery: injectCustomMeasuresIntoDax(plan.daxQuery),
      confidence: plan.confidence,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido"
    return NextResponse.json<ChatApiResponse>(
      {
        answer: `Ocorreu um erro ao processar sua pergunta: ${message}`,
        data: null,
        daxQuery: null,
        confidence: "low",
        error: message,
      },
      { status: 500 }
    )
  }
}
