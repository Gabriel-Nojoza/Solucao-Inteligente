import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"

function getUserCompanyId(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) {
  const fromApp = user.app_metadata?.company_id
  const fromUser = user.user_metadata?.company_id
  return typeof fromApp === "string" ? fromApp : typeof fromUser === "string" ? fromUser : ""
}

export async function GET() {
  try {
    const context = await requireAdminContext()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Listar usuarios
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const allUsers = usersData?.users ?? []
    const users = context.isPlatformAdmin
      ? allUsers
      : allUsers.filter((u) => getUserCompanyId(u) === context.companyId)

    const totalUsers = users.length
    const adminUsers = users.filter(
      (u) => (u.app_metadata?.role || u.user_metadata?.role) === "admin"
    ).length

    // Usuarios ativos nos ultimos 7 dias
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const activeUsers = users.filter(
      (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) > sevenDaysAgo
    ).length

    // Contar configuracoes
    let settingsCount = 0
    if (context.isPlatformAdmin) {
      const { count } = await supabase
        .from("company_settings")
        .select("*", { count: "exact", head: true })
      settingsCount = count ?? 0
    } else {
      const { count } = await supabase
        .from("company_settings")
        .select("*", { count: "exact", head: true })
        .eq("company_id", context.companyId)
      settingsCount = count ?? 0
    }

    return NextResponse.json({
      totalUsers,
      activeUsers,
      adminUsers,
      settingsCount,
    })
  } catch (error) {
    console.error("Error fetching admin stats:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatisticas" },
      { status: 500 }
    )
  }
}
