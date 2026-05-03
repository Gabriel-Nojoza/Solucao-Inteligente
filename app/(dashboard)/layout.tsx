import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/dashboard/sidebar-nav"
import { TabSessionGuard } from "@/components/auth/tab-session-guard"
import { createClient } from "@/lib/supabase/server"
import { PowerBIAutoSyncWatcher } from "@/components/powerbi/auto-sync-watcher"
import { FloatingChatLauncher } from "@/components/chat/floating-chat-launcher"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  return (
    <TabSessionGuard>
      <PowerBIAutoSyncWatcher />
      <SidebarProvider>
        <AppSidebar currentUser={currentUser} />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          {children}
          <FloatingChatLauncher />
        </SidebarInset>
      </SidebarProvider>
    </TabSessionGuard>
  )
}
