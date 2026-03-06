"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import { Plus, Search, Trash2, Pencil, Phone, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Contact } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function ContactsPage() {
  const { data: contacts, isLoading } = useSWR<Contact[]>("/api/contacts", fetcher)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editContact, setEditContact] = useState<Contact | null>(null)

  // Form state
  const [formName, setFormName] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formType, setFormType] = useState<"individual" | "group">("individual")
  const [formGroupId, setFormGroupId] = useState("")
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const filtered = (contacts ?? []).filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone ?? "").includes(search)
    const matchesType = typeFilter === "all" || c.type === typeFilter
    return matchesSearch && matchesType
  })

  function openCreate() {
    setEditContact(null)
    setFormName("")
    setFormPhone("")
    setFormType("individual")
    setFormGroupId("")
    setFormActive(true)
    setFormErrors({})
    setDialogOpen(true)
  }

  function openEdit(contact: Contact) {
    setEditContact(contact)
    setFormName(contact.name)
    setFormPhone(contact.phone ?? "")
    setFormType(contact.type)
    setFormGroupId(contact.whatsapp_group_id ?? "")
    setFormActive(contact.is_active)
    setFormErrors({})
    setDialogOpen(true)
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {}
    if (!formName.trim()) {
      errors.name = "Nome obrigatorio"
    }
    if (formType === "individual" && formPhone) {
      const phoneRegex = /^\+?\d{10,15}$/
      if (!phoneRegex.test(formPhone.replace(/[\s\-()]/g, ""))) {
        errors.phone = "Formato invalido. Ex: +5511999999999"
      }
    }
    if (formType === "group" && !formGroupId.trim()) {
      errors.groupId = "ID do grupo obrigatorio"
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validateForm()) return
    setSaving(true)
    try {
      const payload = {
        ...(editContact ? { id: editContact.id } : {}),
        name: formName.trim(),
        phone: formPhone || null,
        type: formType,
        whatsapp_group_id: formGroupId || null,
        is_active: formActive,
      }

      const res = await fetch("/api/contacts", {
        method: editContact ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error("Erro ao salvar")

      toast.success(editContact ? "Contato atualizado!" : "Contato criado!")
      setDialogOpen(false)
      mutate("/api/contacts")
    } catch {
      toast.error("Erro ao salvar contato")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/contacts?id=${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Contato excluido!")
      mutate("/api/contacts")
    } catch {
      toast.error("Erro ao excluir contato")
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Contatos" description="Gerencie contatos e grupos WhatsApp">
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 size-4" />
          Novo Contato
        </Button>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="group">Grupo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {contacts?.length === 0
                  ? "Nenhum contato cadastrado. Clique em 'Novo Contato' para adicionar."
                  : "Nenhum resultado encontrado."}
              </p>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">Telefone</TableHead>
                    <TableHead className="hidden md:table-cell">Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.name}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {contact.phone ?? "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="gap-1">
                          {contact.type === "group" ? (
                            <UsersRound className="size-3" />
                          ) : (
                            <Phone className="size-3" />
                          )}
                          {contact.type === "group" ? "Grupo" : "Individual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={contact.is_active ? "default" : "secondary"}>
                          {contact.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(contact)}
                          >
                            <Pencil className="size-4" />
                            <span className="sr-only">Editar</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(contact.id)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                            <span className="sr-only">Excluir</span>
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
              {editContact ? "Editar Contato" : "Novo Contato"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-name">Nome</Label>
              <Input
                id="contact-name"
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value)
                  setFormErrors((prev) => ({ ...prev, name: "" }))
                }}
                placeholder="Nome do contato ou grupo"
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-type">Tipo</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as "individual" | "group")}>
                <SelectTrigger id="contact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="group">Grupo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formType === "individual" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-phone">Telefone (com DDI)</Label>
                <Input
                  id="contact-phone"
                  value={formPhone}
                  onChange={(e) => {
                    setFormPhone(e.target.value)
                    setFormErrors((prev) => ({ ...prev, phone: "" }))
                  }}
                  placeholder="+5511999999999"
                  className={formErrors.phone ? "border-destructive" : ""}
                />
                {formErrors.phone && (
                  <p className="text-xs text-destructive">{formErrors.phone}</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-group-id">ID do Grupo WhatsApp</Label>
                <Input
                  id="contact-group-id"
                  value={formGroupId}
                  onChange={(e) => {
                    setFormGroupId(e.target.value)
                    setFormErrors((prev) => ({ ...prev, groupId: "" }))
                  }}
                  placeholder="ID do grupo"
                  className={formErrors.groupId ? "border-destructive" : ""}
                />
                {formErrors.groupId && (
                  <p className="text-xs text-destructive">{formErrors.groupId}</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch
                id="contact-active"
                checked={formActive}
                onCheckedChange={setFormActive}
              />
              <Label htmlFor="contact-active">Ativo</Label>
            </div>
            <Button onClick={handleSave} disabled={saving || !formName}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. O contato sera removido
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
