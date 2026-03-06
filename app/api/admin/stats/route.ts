import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Listar usuarios
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const users = usersData?.users ?? []

    const totalUsers = users.length
    const adminUsers = users.filter(
      (u) => u.user_metadata?.role === "admin"
    ).length

    // Usuarios ativos nos ultimos 7 dias
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const activeUsers = users.filter(
      (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) > sevenDaysAgo
    ).length

    // Contar configuracoes
    const { count: settingsCount } = await supabase
      .from("settings")
      .select("*", { count: "exact", head: true })

    return NextResponse.json({
      totalUsers,
      activeUsers,
      adminUsers,
      settingsCount: settingsCount ?? 0,
    })
  } catch (error) {
    console.error("Error fetching admin stats:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatisticas" },
      { status: 500 }
    )
  }
}
