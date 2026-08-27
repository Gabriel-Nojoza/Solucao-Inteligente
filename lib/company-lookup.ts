import type { createServiceClient } from "@/lib/supabase/server"

type ServiceClient = ReturnType<typeof createServiceClient>

export type CompanyMatch = { id: string; name: string }

export type CompanyLookupResult = {
  match?: CompanyMatch
  candidates?: CompanyMatch[]
}

const COMBINING_MARKS = /[̀-ͯ]/g

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
}

function initialsOf(name: string): string {
  return normalize(name)
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .join("")
}

function toMatch(company: { id: string; name: string }): CompanyMatch {
  return { id: company.id, name: company.name }
}

/**
 * Resolve uma empresa a partir de um trecho do nome informado por humano
 * (sem acento, sem caixa). Estrategia, em ordem:
 *   1. nome exato
 *   2. "contem" o trecho (com prioridade para quem comeca com o trecho)
 *   3. iniciais das palavras (ex.: "JA" -> "Jardim Alvorada")
 *
 * Retorna { match } quando ha exatamente uma; { candidates } quando o trecho
 * e ambiguo; {} quando nao encontra nada.
 */
export async function resolveCompanyByName(
  supabase: ServiceClient,
  query: string
): Promise<CompanyLookupResult> {
  const q = normalize(query)
  if (!q) return {}

  const { data } = await supabase.from("companies").select("id, name")
  const companies = (data ?? []).filter(
    (c): c is { id: string; name: string } =>
      typeof c.name === "string" && c.name.length > 0
  )

  const exact = companies.filter((c) => normalize(c.name) === q)
  if (exact.length === 1) return { match: toMatch(exact[0]) }

  const contains = companies.filter((c) => normalize(c.name).includes(q))
  if (contains.length === 1) return { match: toMatch(contains[0]) }
  if (contains.length > 1) {
    const prefix = contains.filter((c) => normalize(c.name).startsWith(q))
    if (prefix.length === 1) return { match: toMatch(prefix[0]) }
    return { candidates: (prefix.length > 1 ? prefix : contains).map(toMatch) }
  }

  const byInitials = companies.filter((c) => initialsOf(c.name).startsWith(q))
  if (byInitials.length === 1) return { match: toMatch(byInitials[0]) }
  if (byInitials.length > 1) return { candidates: byInitials.map(toMatch) }

  return {}
}
