"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  FolderKanban,
  FileBarChart2,
  Users,
  CalendarClock,
  History,
  Activity,
  Workflow,
  Megaphone,
} from "lucide-react"
import type { CurrentUserSummaryData } from "@/components/auth/current-user-summary"
import { BrandMark } from "@/components/branding/brand-mark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SidebarNavGroup, SidebarUserMenu, type SidebarNavItem } from "@/components/dashboard/sidebar-parts"

type NavItem = SidebarNavItem & { feature?: "reportBuilder" | "campaigns" }

// Menu agrupado por assunto. Os enderecos sao os mesmos de antes.
const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Visão geral",
    items: [
      { title: "Painel", href: "/", icon: LayoutDashboard },
      { title: "Resumo operacional", href: "/operational-summary", icon: Activity },
    ],
  },
  {
    label: "Envios",
    items: [
      { title: "Rotinas de disparo", href: "/schedules", icon: CalendarClock },
      { title: "Campanhas", href: "/campaigns", icon: Megaphone, feature: "campaigns" },
      { title: "Histórico de envios", href: "/logs", icon: History },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Relatórios", href: "/reports", icon: FileBarChart2 },
      { title: "Workspaces", href: "/workspaces", icon: FolderKanban },
      { title: "Contatos", href: "/contacts", icon: Users },
      { title: "Construtor de relatórios", href: "/automations", icon: Workflow, feature: "reportBuilder" },
    ],
  },
]

type AppSidebarProps = {
  currentUser: CurrentUserSummaryData | null
  reportBuilderEnabled?: boolean
  campaignsEnabled?: boolean
}

export function AppSidebar({ currentUser, reportBuilderEnabled = false, campaignsEnabled = false }: AppSidebarProps) {
  const pathname = usePathname()

  const isEnabled = (item: NavItem) =>
    item.feature === "reportBuilder" ? reportBuilderEnabled : item.feature === "campaigns" ? campaignsEnabled : true

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" className="flex items-center gap-3">
                <BrandMark imageSize={36} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {navGroups.map((group) => (
          <SidebarNavGroup
            key={group.label}
            label={group.label}
            items={group.items.filter(isEnabled)}
            isActive={isActive}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarUserMenu currentUser={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
