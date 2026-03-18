import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { fetchWhatsAppBotDirectory } from "@/lib/whatsapp-bot"
import {
  buildContactWritePayload,
  contactsSupportWhatsappGroupId,
  getEffectiveWhatsAppGroupId,
  normalizeContactForResponse,
} from "@/lib/contact-compat"

type ExistingContact = {
  id: string
  name: string
  phone: string | null
  type: "individual" | "group"
  whatsapp_group_id: string | null
  is_active: boolean
}

function normalizePhone(phone: string | null | undefined) {
  const normalized = typeof phone === "string" ? phone.replace(/\D/g, "") : ""
  return normalized || null
}

function formatPhoneForStorage(phone: string | null | undefined) {
  const normalized = normalizePhone(phone)
  return normalized ? `+${normalized}` : null
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export async function POST() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const directory = await fetchWhatsAppBotDirectory()
    const supportsWhatsappGroupId = await contactsSupportWhatsappGroupId(supabase)

    const seenDirectoryKeys = new Set<string>()
    const syncableItems = directory.filter((item) => {
      const key =
        item.type === "group"
          ? `group:${item.whatsapp_group_id ?? ""}`
          : `individual:${normalizePhone(item.phone) ?? ""}`

      const isValid =
        item.type === "group"
          ? Boolean(item.whatsapp_group_id)
          : Boolean(normalizePhone(item.phone))

      if (!isValid || seenDirectoryKeys.has(key)) {
        return false
      }

      seenDirectoryKeys.add(key)
      return true
    })

    const { data: existingContacts, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("company_id", companyId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const existing = (existingContacts ?? []).map((contact) =>
      normalizeContactForResponse(contact as ExistingContact)
    ) as ExistingContact[]
    const existingGroups = new Map(
      existing
        .filter((contact) => contact.type === "group" && getEffectiveWhatsAppGroupId(contact))
        .map((contact) => [getEffectiveWhatsAppGroupId(contact) as string, contact])
    )
    const existingIndividuals = new Map(
      existing
        .filter((contact) => contact.type === "individual" && normalizePhone(contact.phone))
        .map((contact) => [normalizePhone(contact.phone) as string, contact])
    )

    const inserts: Array<{
      [key: string]: unknown
    }> = []
    const updates: Array<{
      id: string
      payload: Record<string, unknown>
    }> = []
    const failedItems: Array<{ key: string; error: string }> = []

    for (const item of syncableItems) {
      if (item.type === "group") {
        const groupId = item.whatsapp_group_id as string
        const existingGroup = existingGroups.get(groupId)

        if (!existingGroup) {
          inserts.push(
            buildContactWritePayload(
              {
                company_id: companyId,
                name: item.name,
                phone: null,
                type: "group",
                whatsapp_group_id: groupId,
                is_active: true,
              },
              supportsWhatsappGroupId
            )
          )
          continue
        }

        if (
          existingGroup.name !== item.name ||
          existingGroup.type !== "group" ||
          getEffectiveWhatsAppGroupId(existingGroup) !== groupId ||
          !existingGroup.is_active
        ) {
          updates.push({
            id: existingGroup.id,
            payload: buildContactWritePayload(
              {
                name: item.name,
                phone: null,
                type: "group",
                whatsapp_group_id: groupId,
                is_active: true,
                updated_at: new Date().toISOString(),
              },
              supportsWhatsappGroupId
            ),
          })
        }

        continue
      }

      const normalizedPhone = normalizePhone(item.phone)
      if (!normalizedPhone) {
        continue
      }

      const existingIndividual = existingIndividuals.get(normalizedPhone)
      if (!existingIndividual) {
        inserts.push(
          buildContactWritePayload(
            {
              company_id: companyId,
              name: item.name,
              phone: formatPhoneForStorage(normalizedPhone),
              type: "individual",
              whatsapp_group_id: null,
              is_active: true,
            },
            supportsWhatsappGroupId
          )
        )
        continue
      }

      if (
        existingIndividual.name !== item.name ||
        normalizePhone(existingIndividual.phone) !== normalizedPhone ||
        existingIndividual.type !== "individual" ||
        existingIndividual.whatsapp_group_id !== null ||
        !existingIndividual.is_active
      ) {
        updates.push({
          id: existingIndividual.id,
          payload: buildContactWritePayload(
            {
              name: item.name,
              phone: formatPhoneForStorage(normalizedPhone),
              type: "individual",
              whatsapp_group_id: null,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            supportsWhatsappGroupId
          ),
        })
      }
    }

    if (inserts.length > 0) {
      for (const insertChunk of chunkArray(inserts, 200)) {
        const { error: insertError } = await supabase.from("contacts").insert(insertChunk)
        if (!insertError) {
          continue
        }

        console.error("Erro em lote ao inserir contatos do bot:", insertError.message)

        for (const insertItem of insertChunk) {
          const { error: singleInsertError } = await supabase
            .from("contacts")
            .insert(insertItem)

          if (singleInsertError) {
            const normalizedInsertItem = normalizeContactForResponse(insertItem)
            const key =
              normalizedInsertItem.type === "group"
                ? `group:${normalizedInsertItem.whatsapp_group_id ?? ""}`
                : `individual:${normalizedInsertItem.phone ?? ""}`
            failedItems.push({ key, error: singleInsertError.message })
          }
        }
      }
    }

    for (const update of updates) {
      const { error: updateError } = await supabase
        .from("contacts")
        .update(update.payload)
        .eq("company_id", companyId)
        .eq("id", update.id)

      if (updateError) {
        failedItems.push({ key: `update:${update.id}`, error: updateError.message })
      }
    }

    if (inserts.length + updates.length > 0 && failedItems.length === inserts.length + updates.length) {
      return NextResponse.json(
        { error: failedItems[0]?.error || "Erro ao sincronizar contatos do bot" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      total_found: syncableItems.length,
      inserted: inserts.length,
      updated: updates.length,
      total_synced: inserts.length + updates.length,
      failed: failedItems.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao sincronizar contatos do bot" },
      { status: 500 }
    )
  }
}
