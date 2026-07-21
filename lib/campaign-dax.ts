import type { Campaign } from "@/lib/types"

export function buildCampaignDaxQuery(campaign: Pick<
  Campaign,
  "customer_table" | "date_column" | "days_inactive" | "dax_query" |
  "selected_columns" | "selected_measures" | "filters" | "name_column" | "phone_column"
>): string | null {
  if (campaign.customer_table) {
    const table = campaign.customer_table
    const namCol = campaign.name_column
    const phCol = campaign.phone_column

    const selectCols = namCol && phCol
      ? `  "nome", '${table}'[${namCol}],\n  "telefone", '${table}'[${phCol}]`
      : null

    if (campaign.date_column && campaign.days_inactive != null) {
      const dateCol = campaign.date_column
      const days = campaign.days_inactive
      if (selectCols) {
        return [
          "EVALUATE",
          "ADDCOLUMNS(",
          "  FILTER(",
          `    '${table}',`,
          `    NOT ISBLANK('${table}'[${dateCol}])`,
          `      && DATEDIFF('${table}'[${dateCol}], TODAY(), DAY) >= ${days}`,
          "  ),",
          selectCols,
          ")",
        ].join("\n")
      }
      return [
        "EVALUATE",
        "FILTER(",
        `  '${table}',`,
        `  NOT ISBLANK('${table}'[${dateCol}])`,
        `    && DATEDIFF('${table}'[${dateCol}], TODAY(), DAY) >= ${days}`,
        ")",
      ].join("\n")
    }

    if (selectCols) {
      return [
        "EVALUATE",
        "ADDCOLUMNS(",
        `  '${table}',`,
        selectCols,
        ")",
      ].join("\n")
    }

    return `EVALUATE '${table}'`
  }

  if (campaign.dax_query?.trim()) {
    return campaign.dax_query.trim()
  }

  return null
}
