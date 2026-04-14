import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { TabSessionGuard } from "@/components/auth/tab-session-guard"
import { createClient } from "@/lib/supabase/server"

export default async function AdminLayout({
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
      <SidebarProvider>
        <AdminSidebar currentUser={currentUser} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </TabSessionGuard>
  )
}
