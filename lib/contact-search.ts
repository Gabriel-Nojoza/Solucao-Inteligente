import type { Contact } from "@/lib/types"

type SearchableContact = Pick<Contact, "name" | "phone" | "type" | "whatsapp_group_id">

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "")
}

export function matchesContactSearch(contact: SearchableContact, query: string) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) {
    return true
  }

  const normalizedDigitsQuery = normalizeDigits(query)
  const combinedText = [
    contact.name,
    contact.phone,
    contact.whatsapp_group_id,
    contact.type === "group" ? "grupo" : "individual",
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ")

  const combinedDigits = [contact.phone, contact.whatsapp_group_id]
    .map((value) => normalizeDigits(value))
    .filter(Boolean)
    .join(" ")

  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((term) => combinedText.includes(term))
    ? true
    : Boolean(normalizedDigitsQuery) && combinedDigits.includes(normalizedDigitsQuery)
}

export function getContactSearchDetail(contact: SearchableContact) {
  return contact.type === "group" ? contact.whatsapp_group_id : contact.phone
}
