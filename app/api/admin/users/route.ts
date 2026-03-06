import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  try {
    const supabase = getAdminClient()
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) throw error

    return NextResponse.json(data.users)
  } catch (error) {
    console.error("Error listing users:", error)
    return NextResponse.json(
      { error: "Erro ao listar usuarios" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()
    const { email, password, name, role } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email e senha obrigatorios" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: role || "client" },
    })

    if (error) {
      if (error.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "Este email ja esta cadastrado" },
          { status: 400 }
        )
      }
      throw error
    }

    return NextResponse.json(data.user)
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json(
      { error: "Erro ao criar usuario" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getAdminClient()
    const body = await request.json()
    const { id, password, name, role } = body

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    const updateData: { password?: string; user_metadata?: Record<string, string> } = {
      user_metadata: { name, role },
    }

    if (password) {
      updateData.password = password
    }

    const { data, error } = await supabase.auth.admin.updateUserById(id, updateData)

    if (error) throw error

    return NextResponse.json(data.user)
  } catch (error) {
    console.error("Error updating user:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar usuario" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = getAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    const { error } = await supabase.auth.admin.deleteUser(id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json(
      { error: "Erro ao remover usuario" },
      { status: 500 }
    )
  }
}
