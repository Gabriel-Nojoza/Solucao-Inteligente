import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/dashboard/sidebar-nav"
import { SystemAnnouncement } from "@/components/dashboard/system-announcement"
import { TabSessionGuard } from "@/components/auth/tab-session-guard"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/server"
import { PowerBIAutoSyncWatcher } from "@/components/powerbi/auto-sync-watcher"
import { FloatingChatLauncher } from "@/components/chat/floating-chat-launcher"
import { ThemeScheduler } from "@/components/theme/theme-scheduler"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  const currentUser = user
    ? {
        email: user.email ?? null,
        name:
          typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : null,
        role:
          typeof user.app_metadata?.role === "string"
            ? user.app_metadata.role
            : typeof user.user_metadata?.role === "string"
              ? user.user_metadata.role
              : null,
      }
    : null

  const companyId =
    typeof user?.app_metadata?.company_id === "string"
      ? user.app_metadata.company_id
      : typeof user?.user_metadata?.company_id === "string"
        ? user.user_metadata.company_id
        : null

  let reportBuilderEnabled = false
  let campaignsEnabled = false
  let themeSchedule = { enabled: false, light_time: "06:00", dark_time: "18:00" }

  if (companyId) {
    try {
      const service = createServiceClient()
      const featuresResult = await service
        .from("company_settings")
        .select("value")
        .eq("company_id", companyId)
        .eq("key", "features")
        .maybeSingle()
      const features = featuresResult.data?.value as Record<string, unknown> | null
      reportBuilderEnabled = features?.report_builder === true
      campaignsEnabled = features?.campaigns === true
    } catch {
      // silently fallback
    }
  }

  // theme_schedule é configuração global — lê sem filtrar por empresa
  try {
    const service = createServiceClient()
    const themeResult = await service
      .from("company_settings")
      .select("value")
      .eq("key", "theme_schedule")
      .maybeSingle()
    const ts = themeResult.data?.value as Record<string, unknown> | null
    if (ts) {
      themeSchedule = {
        enabled: ts.enabled === true,
        light_time: typeof ts.light_time === "string" ? ts.light_time : "06:00",
        dark_time: typeof ts.dark_time === "string" ? ts.dark_time : "18:00",
      }
    }
  } catch {
    // silently fallback
  }

  return (
    <TabSessionGuard>
      <PowerBIAutoSyncWatcher />
      <ThemeScheduler enabled={themeSchedule.enabled} lightTime={themeSchedule.light_time} darkTime={themeSchedule.dark_time} />
      <SidebarProvider>
        <AppSidebar currentUser={currentUser} reportBuilderEnabled={reportBuilderEnabled} campaignsEnabled={campaignsEnabled} />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <SystemAnnouncement />
          {children}
          <FloatingChatLauncher />
        </SidebarInset>
      </SidebarProvider>
    </TabSessionGuard>
  )
}
