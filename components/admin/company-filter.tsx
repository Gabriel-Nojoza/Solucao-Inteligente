"use client"

import useSWR from "swr"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Building2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CompanyListItem } from "@/app/api/admin/companies/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function CompanyFilter() {
  const { data: companies } = useSWR<CompanyListItem[]>("/api/admin/companies", fetcher)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selected = searchParams.get("empresa") ?? "all"

  if (!companies || companies.length <= 1) return null

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") {
      params.delete("empresa")
    } else {
      params.set("empresa", value)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="px-2 py-1">
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-sidebar-foreground/60">
        <Building2 className="size-3.5 shrink-0" />
        <span className="truncate">Empresa</span>
      </div>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-full text-xs bg-sidebar-accent/40 border-sidebar-border">
          <SelectValue placeholder="Todas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">Todas as empresas</SelectItem>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
