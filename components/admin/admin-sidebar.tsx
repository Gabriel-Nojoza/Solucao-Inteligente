"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"
import {
  LayoutDashboard,
  Activity,
  Users,
  Settings,
  MessageSquare,
  CalendarClock,
} from "lucide-react"
import type { CurrentUserSummaryData } from "@/components/auth/current-user-summary"
import { BrandMark } from "@/components/branding/brand-mark"
import { BRAND_ADMIN_SUBTITLE } from "@/lib/branding"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { CompanyFilter } from "@/components/admin/company-filter"
import { SidebarNavGroup, SidebarUserMenu, type SidebarNavItem } from "@/components/dashboard/sidebar-parts"

// Mesmo padrao da barra do cliente (components/dashboard/sidebar-parts.tsx). Enderecos iguais.
const adminGroups: Array<{ label: string; items: SidebarNavItem[] }> = [
  {
    label: "Visão geral",
    items: [
      { title: "Painel", href: "/admin", icon: LayoutDashboard },
      { title: "Resumo operacional", href: "/admin/operational-summary", icon: Activity },
      { title: "Uso do Chat", href: "/admin/chat-usage", icon: MessageSquare },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Rotinas", href: "/admin/schedules", icon: CalendarClock },
      { title: "Usuários", href: "/admin/users", icon: Users },
      { title: "Configurações", href: "/admin/settings", icon: Settings },
    ],
  },
]

type AdminSidebarProps = {
  currentUser: CurrentUserSummaryData | null
}

export function AdminSidebar({ currentUser }: AdminSidebarProps) {
  const pathname = usePathname()
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href))

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin" className="flex items-center gap-3">
                <BrandMark imageSize={36} subtitle={BRAND_ADMIN_SUBTITLE} subtitleClassName="text-sidebar-foreground/60" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {adminGroups.map((group) => (
          <SidebarNavGroup key={group.label} label={group.label} items={group.items} isActive={isActive} />
        ))}

        <SidebarGroup className="py-1.5 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
            Filtros
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <Suspense>
              <CompanyFilter />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarUserMenu currentUser={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
