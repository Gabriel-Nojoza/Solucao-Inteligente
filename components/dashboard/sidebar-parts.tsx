"use client"

// Pecas da barra lateral usadas pelo cliente (sidebar-nav.tsx) e pelo admin (admin-sidebar.tsx),
// para as duas ficarem sempre no mesmo padrao.
import Link from "next/link"
import { ChevronsUpDown, LogOut, Moon, Sun, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { createClient } from "@/lib/supabase/client"
import { clearTabSessionMarker } from "@/lib/supabase/tab-session"
import { markThemeManualOverride } from "@/components/theme/theme-scheduler"
import type { CurrentUserSummaryData } from "@/components/auth/current-user-summary"
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export type SidebarNavItem = {
  title: string
  href: string
  icon: LucideIcon
}

// Um grupo do menu ("Envios", "Cadastros"...): rotulo e itens com o icone num quadradinho.
export function SidebarNavGroup({
  label,
  items,
  isActive,
}: {
  label: string
  items: SidebarNavItem[]
  isActive: (href: string) => boolean
}) {
  if (items.length === 0) return null

  return (
    <SidebarGroup className="py-1.5">
      <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
        {label}
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
                    className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-full bg-primary group-data-[collapsible=icon]:hidden"
                  />
                ) : null}
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.title}
                  className="group/item h-10 gap-3 text-sidebar-foreground/75 hover:text-sidebar-foreground data-[active=true]:bg-primary/10 data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
                >
                  <Link href={item.href}>
                    {/* Icone num quadradinho: no item aberto, degrade azul -> verde. Com a barra
                        recolhida, fica so o icone (o quadradinho nao cabe). */}
                    <span
                      data-testid="icone-do-menu"
                      className={
                        active
                          ? "flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-emerald-500 text-white shadow-md shadow-primary/30 group-data-[collapsible=icon]:size-4 group-data-[collapsible=icon]:bg-none group-data-[collapsible=icon]:text-primary group-data-[collapsible=icon]:shadow-none"
                          : "flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/60 ring-1 ring-sidebar-border/70 transition-all group-hover/item:-rotate-6 group-hover/item:scale-105 group-hover/item:bg-primary/15 group-hover/item:text-primary group-hover/item:ring-primary/30 group-data-[collapsible=icon]:size-4 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:ring-0"
                      }
                    >
                      <item.icon className="size-4" />
                    </span>
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
}

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

// Rodape: o usuario vira um menu com nome, e-mail, tema e Sair.
export function SidebarUserMenu({ currentUser }: { currentUser: CurrentUserSummaryData | null }) {
  const { resolvedTheme, setTheme } = useTheme()
  const displayName = getDisplayName(currentUser)
  const isDark = resolvedTheme === "dark"

  const handleLogout = () => {
    const supabase = createClient()
    clearTabSessionMarker()
    supabase.auth.signOut({ scope: "local" })
    window.location.href = "/auth/login"
  }

  return (
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
  )
}
