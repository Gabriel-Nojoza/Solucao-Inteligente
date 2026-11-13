"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import useSWR from "swr"
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
  Moon,
  Sun,
  LogOut,
  ChevronsUpDown,
  Plus,
  Radio,
  type LucideIcon,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTheme } from "next-themes"
import { markThemeManualOverride } from "@/components/theme/theme-scheduler"
import type { CurrentUserSummaryData } from "@/components/auth/current-user-summary"
import { BrandMark } from "@/components/branding/brand-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { clearTabSessionMarker } from "@/lib/supabase/tab-session"

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  feature?: "reportBuilder" | "campaigns"
}

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

function getDisplayName(user: CurrentUserSummaryData | null) {
  const name = user?.name?.trim()
  if (name) return name
  const email = user?.email?.trim()
  return email ? email.split("@")[0] || email : "Usuário"
}

function getInitials(displayName: string) {
  const words = displayName.split(/\s+/).filter(Boolean)
  if (words.length === 0) return "US"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase()
}

// ── Cartao "Ao vivo": WhatsApp, proximo envio e numeros do dia ──
// Usa o mesmo /api/stats do Painel (cache de 30 s), atualizando a cada minuto.
type LiveStats = {
  whatsappConnected?: boolean
  whatsappBotStatus?: string
  dispatchesToday?: number
  successRate?: number | null
  nextDispatches?: Array<{ scheduleName: string; nextRunLabel: string }>
}

const statsFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("stats")
  return res.json() as Promise<LiveStats>
}

function whatsappState(stats: LiveStats | undefined) {
  if (!stats) return { label: "Verificando...", tone: "muted" as const }
  if (stats.whatsappConnected) return { label: "WhatsApp conectado", tone: "ok" as const }
  if (stats.whatsappBotStatus === "reconnecting" || stats.whatsappBotStatus === "starting") {
    return { label: "WhatsApp reconectando", tone: "warn" as const }
  }
  return { label: "WhatsApp desconectado", tone: "bad" as const }
}

const TONE_DOT = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-500",
  muted: "bg-sidebar-foreground/30",
} as const

function LiveStatusCard() {
  const { data } = useSWR("/api/stats", statsFetcher, { refreshInterval: 60_000, revalidateOnFocus: false })
  const state = whatsappState(data)
  const next = data?.nextDispatches?.[0]

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-sidebar-border/70 bg-gradient-to-br from-primary/10 via-sidebar-accent/40 to-emerald-500/10 p-3 group-data-[collapsible=icon]:hidden"
      data-testid="cartao-ao-vivo"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
        <Radio className="size-3" />
        Ao vivo
      </div>

      <div className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground">
        <span className="relative flex size-2.5">
          {state.tone === "ok" ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          ) : null}
          <span className={`relative inline-flex size-2.5 rounded-full ${TONE_DOT[state.tone]}`} />
        </span>
        {state.label}
      </div>

      <div className="mt-2.5 space-y-1 text-[11px] text-sidebar-foreground/65">
        <p className="truncate" title={next ? `${next.nextRunLabel} · ${next.scheduleName}` : undefined}>
          <span className="text-sidebar-foreground/45">Próximo envio: </span>
          {next ? (
            <>
              <span className="font-medium text-sidebar-foreground">{next.nextRunLabel}</span> · {next.scheduleName}
            </>
          ) : (
            "nenhum agendado"
          )}
        </p>
        <p>
          <span className="text-sidebar-foreground/45">Hoje: </span>
          <span className="font-medium text-sidebar-foreground">{data?.dispatchesToday ?? 0}</span> envio(s)
          {typeof data?.successRate === "number" ? <> · {data.successRate}% de sucesso</> : null}
        </p>
      </div>
    </div>
  )
}

type AppSidebarProps = {
  currentUser: CurrentUserSummaryData | null
  reportBuilderEnabled?: boolean
  campaignsEnabled?: boolean
}

export function AppSidebar({ currentUser, reportBuilderEnabled = false, campaignsEnabled = false }: AppSidebarProps) {
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const displayName = getDisplayName(currentUser)
  const isDark = resolvedTheme === "dark"

  const handleLogout = () => {
    const supabase = createClient()
    clearTabSessionMarker()
    supabase.auth.signOut({ scope: "local" })
    window.location.href = "/auth/login"
  }

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
        {/* Acao rapida: abre o formulario de nova rotina */}
        <SidebarGroup className="pb-1 pt-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Nova rotina"
                className="h-9 justify-center bg-gradient-to-r from-primary to-emerald-500 font-medium text-white shadow-md shadow-primary/25 transition-all hover:from-primary/90 hover:to-emerald-500/90 hover:text-white hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98] group-data-[collapsible=icon]:justify-center"
              >
                <Link href="/schedules?nova=1" data-testid="atalho-nova-rotina">
                  <Plus className="size-4" />
                  <span>Nova rotina</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {navGroups.map((group) => {
          const items = group.items.filter(isEnabled)
          if (items.length === 0) return null
          return (
            <SidebarGroup key={group.label} className="py-1.5">
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {items.map((item) => {
                    const active = isActive(item.href)
                    return (
                      <SidebarMenuItem key={item.href} className="relative">
                        {/* Barrinha colorida do item ativo */}
                        {active ? (
                          <span
                            aria-hidden
                            className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-primary to-emerald-400 shadow-[0_0_10px] shadow-primary/60 group-data-[collapsible=icon]:hidden"
                          />
                        ) : null}
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className="group/item h-9 text-sidebar-foreground/75 transition-all hover:translate-x-0.5 hover:text-sidebar-foreground data-[active=true]:bg-gradient-to-r data-[active=true]:from-primary/15 data-[active=true]:to-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
                        >
                          <Link href={item.href}>
                            <item.icon
                              className={
                                active
                                  ? "size-4 text-primary drop-shadow-[0_0_5px_var(--primary)]"
                                  : "size-4 transition-transform group-hover/item:scale-110"
                              }
                            />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      {/* Rodape: o usuario vira um menu (tema e sair) */}
      <SidebarFooter className="gap-2 border-t border-sidebar-border">
        <LiveStatusCard />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={displayName}
                  className="data-[state=open]:bg-sidebar-accent"
                  data-testid="menu-do-usuario"
                >
                  <Avatar className="size-8 rounded-lg border border-sidebar-border/60">
                    <AvatarFallback className="rounded-lg bg-primary/15 text-xs font-semibold text-primary">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{displayName}</span>
                    <span className="truncate text-xs text-sidebar-foreground/55">
                      {currentUser?.email || (currentUser?.role === "admin" ? "Administrador" : "Cliente")}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{displayName}</span>
                    {currentUser?.email ? (
                      <span className="text-xs text-muted-foreground">{currentUser.email}</span>
                    ) : null}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    markThemeManualOverride()
                    setTheme(isDark ? "light" : "dark")
                  }}
                >
                  {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {isDark ? "Tema claro" : "Tema escuro"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="size-4 text-destructive" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
