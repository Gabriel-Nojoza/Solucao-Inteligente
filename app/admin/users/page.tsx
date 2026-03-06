"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import { Plus, Pencil, Trash2, Shield, User, Loader2, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface UserData {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  user_metadata: {
    name?: string
    role?: string
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function UsersPage() {
  const { data: users, isLoading } = useSWR<UserData[]>("/api/admin/users", fetcher)
  
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserData | null>(null)
  const [deleteUser, setDeleteUser] = useState<UserData | null>(null)
  
  const [formEmail, setFormEmail] = useState("")
  const [formPassword, setFormPassword] = useState("")
  const [formName, setFormName] = useState("")
  const [formRole, setFormRole] = useState<"client" | "admin">("client")
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function openCreate() {
    setEditUser(null)
    setFormEmail("")
    setFormPassword("")
    setFormName("")
    setFormRole("client")
    setDialogOpen(true)
  }

  function openEdit(user: UserData) {
    setEditUser(user)
    setFormEmail(user.email)
    setFormPassword("")
    setFormName(user.user_metadata?.name || "")
    setFormRole((user.user_metadata?.role as "client" | "admin") || "client")
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formEmail || (!editUser && !formPassword)) {
      toast.error("Preencha todos os campos obrigatorios")
      return
    }

    setSaving(true)
    try {
      const payload = {
        id: editUser?.id,
        email: formEmail,
        password: formPassword || undefined,
        name: formName,
        role: formRole,
      }

      const res = await fetch("/api/admin/users", {
        method: editUser ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Erro ao salvar")
      }

      toast.success(editUser ? "Usuario atualizado!" : "Usuario criado!")
      setDialogOpen(false)
      mutate("/api/admin/users")
      mutate("/api/admin/stats")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteUser) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/users?id=${deleteUser.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      toast.success("Usuario removido!")
      setDeleteDialogOpen(false)
      setDeleteUser(null)
      mutate("/api/admin/users")
      mutate("/api/admin/stats")
    } catch {
      toast.error("Erro ao remover usuario")
    } finally {
      setDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Usuarios" />
        <div className="p-6">
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      </div>
    )
  }

  const userList = Array.isArray(users) ? users : []

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Usuarios"
        description="Gerencie os usuarios do sistema"
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            Novo Usuario
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lista de Usuarios</CardTitle>
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-2 size-4" />
              Adicionar Usuario
            </Button>
          </CardHeader>
          <CardContent>
            {userList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <User className="mb-3 size-12 opacity-30" />
                <p className="text-sm font-medium">Nenhum usuario cadastrado</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="hidden md:table-cell">Criado em</TableHead>
                      <TableHead className="hidden md:table-cell">Ultimo acesso</TableHead>
                      <TableHead className="text-right">Acoes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userList.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          {user.user_metadata?.name || "-"}
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge
                            variant={user.user_metadata?.role === "admin" ? "destructive" : "secondary"}
                            className="gap-1"
                          >
                            {user.user_metadata?.role === "admin" ? (
                              <Shield className="size-3" />
                            ) : (
                              <User className="size-3" />
                            )}
                            {user.user_metadata?.role === "admin" ? "Admin" : "Cliente"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {new Date(user.created_at).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {user.last_sign_in_at
                            ? new Date(user.last_sign_in_at).toLocaleDateString("pt-BR")
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(user)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setDeleteUser(user)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editUser ? "Editar Usuario" : "Novo Usuario"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label>Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nome do usuario"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="email@exemplo.com"
                disabled={!!editUser}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{editUser ? "Nova Senha (deixe vazio para manter)" : "Senha *"}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editUser ? "Nova senha" : "Senha"}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Tipo de Usuario</Label>
              <Select value={formRole} onValueChange={(v) => setFormRole(v as "client" | "admin")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">
                    <div className="flex items-center gap-2">
                      <User className="size-4" />
                      Cliente
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="size-4" />
                      Administrador
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editUser ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o usuario {deleteUser?.email}? Esta acao nao pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
