function normalizePageName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function splitPostgresArrayString(value: string) {
  const trimmed = value.trim()

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null
  }

  const inner = trimmed.slice(1, -1)
  if (!inner.trim()) {
    return []
  }

  const items: string[] = []
  let current = ""
  let inQuotes = false
  let escaping = false

  for (const char of inner) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === "," && !inQuotes) {
      items.push(current)
      current = ""
      continue
    }

    current += char
  }

  items.push(current)
  return items
}

function normalizeStringifiedPageNames(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // Ignore invalid JSON and fall back to other formats below.
    }
  }

  const postgresArrayItems = splitPostgresArrayString(trimmed)
  if (postgresArrayItems) {
    return postgresArrayItems
  }

  return [trimmed]
}

export function normalizeSchedulePageNames(value: unknown) {
  if (Array.isArray(value)) {
    const uniquePageNames = new Set<string>()

    for (const item of value) {
      const normalized = normalizePageName(item)
      if (normalized) {
        uniquePageNames.add(normalized)
      }
    }

    return [...uniquePageNames]
  }

  if (typeof value === "string") {
    return normalizeSchedulePageNames(normalizeStringifiedPageNames(value))
  }

  const normalized = normalizePageName(value)
  return normalized ? [normalized] : []
}

export function resolveSchedulePageNames(input: {
  pbi_page_names?: unknown
  pbi_page_name?: unknown
}) {
  const normalizedPageNames = normalizeSchedulePageNames(input.pbi_page_names)

  if (normalizedPageNames.length > 0) {
    return normalizedPageNames
  }

  return normalizeSchedulePageNames(input.pbi_page_name)
}

export function getPrimarySchedulePageName(pageNames: string[]) {
  return pageNames[0] ?? null
}
