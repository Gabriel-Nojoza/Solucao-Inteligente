"use client"

import { useEffect, useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  Loader2,
  Phone,
  UsersRound,
  Bot,
  QrCode,
  RotateCcw,
  RefreshCw,
  PlugZap,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { matchesContactSearch } from "@/lib/contact-search"
import { formatDateTimePtBr } from "@/lib/datetime"
import { useBotContactSync } from "@/hooks/use-bot-contact-sync"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { Contact } from "@/lib/types"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar dados")
  }

  return data
}

type BotQrConfig = {
  qr_code_url: string
  updated_at: string | null
  manual_qr_code_url: string
  runtime_qr_code_url: string
  manual_updated_at: string | null
  connected_at: string | null
  status:
    | "starting"
    | "awaiting_qr"
    | "connected"
    | "reconnecting"
    | "offline"
    | "error"
  last_error: string | null
  phone_number: string | null
  display_name: string | null
  jid: string | null
  source: "runtime" | "manual" | "none"
}

export default function ContactsPage() {
  const { data: contacts, isLoading } = useSWR<Contact[]>("/api/contacts", fetcher)
  const { data: botQrConfig, isLoading: isLoadingBotQr } = useSWR<BotQrConfig>(
    "/api/bot/qr",
    fetcher,
    { refreshInterval: 5000 }
  )
  const { syncingBotContacts, syncContactsFromBot } = useBotContactSync(botQrConfig)

  const [mounted, setMounted] = useState(false)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [manualBotQrUrl, setManualBotQrUrl] = useState("")
  const [savingBotQr, setSavingBotQr] = useState(false)
  const [botActionLoading, setBotActionLoading] = useState<"disconnect" | "restart" | null>(
    null
  )

  const [formName, setFormName] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formType, setFormType] = useState<"individual" | "group">("individual")
  const [formGroupId, setFormGroupId] = useState("")
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setManualBotQrUrl(botQrConfig?.manual_qr_code_url ?? "")
  }, [botQrConfig?.manual_qr_code_url])

  if (!mounted) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <Skeleton className="h-10 w-56" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const filtered = (contacts ?? []).filter((contact) => {
    const matchesSearch = matchesContactSearch(contact, search)
    const matchesType = typeFilter === "all" || contact.type === typeFilter
    return matchesSearch && matchesType
  })

  const shouldShowContacts = botQrConfig?.status === "connected"
  const visibleContacts = shouldShowContacts ? filtered : []

  const savedManualBotQrUrl = (botQrConfig?.manual_qr_code_url ?? "").trim()
  const currentManualBotQrUrl = manualBotQrUrl.trim()
  const botQrChanged = currentManualBotQrUrl !== savedManualBotQrUrl

  const previewBotQrUrl =
    (botQrConfig?.runtime_qr_code_url ?? "").trim() || currentManualBotQrUrl

  const botQrUpdatedAt = botQrConfig?.updated_at
    ? formatDateTimePtBr(botQrConfig.updated_at)
    : null

  const botConnectedAt = botQrConfig?.connected_at
    ? formatDateTimePtBr(botQrConfig.connected_at)
    : null

  const botStatusLabel =
    botQrConfig?.status === "connected"
      ? "Conectado"
      : botQrConfig?.status === "awaiting_qr"
        ? "Aguardando leitura"
        : botQrConfig?.status === "reconnecting"
          ? "Reconectando"
          : botQrConfig?.status === "starting"
            ? "Iniciando"
            : botQrConfig?.status === "error"
              ? "Erro"
              : "Offline"

  const botStatusVariant =
    botQrConfig?.status === "connected"
      ? "default"
      : botQrConfig?.status === "error"
        ? "destructive"
        : "secondary"

  const botStatusMessage =
    botQrConfig?.status === "connected"
      ? "Bot conectado ao WhatsApp."
      : botQrConfig?.status === "awaiting_qr"
        ? "Leia o QR Code ao lado em Dispositivos conectados no WhatsApp."
        : botQrConfig?.status === "starting"
          ? "Gerando um novo QR Code para conexao."
          : botQrConfig?.status === "reconnecting"
            ? "Reconectando o bot ao WhatsApp."
            : "Bot desconectado. Clique em Gerar QR para conectar novamente."

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

      if (!res.ok) {
        throw new Error("Erro ao salvar")
      }

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

      if (!res.ok) {
        throw new Error()
      }

      toast.success("Contato excluido!")
      mutate("/api/contacts")
    } catch {
      toast.error("Erro ao excluir contato")
    } finally {
      setDeleteId(null)
    }
  }

  async function handleSaveBotQr() {
    setSavingBotQr(true)

    try {
      const res = await fetch("/api/bot/qr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_code_url: currentManualBotQrUrl,
        }),
      })

      const data = (await res.json().catch(() => null)) as
        | {
            error?: string
            qr_code_url?: string
            manual_qr_code_url?: string
            runtime_qr_code_url?: string
            updated_at?: string | null
            manual_updated_at?: string | null
            connected_at?: string | null
            status?:
              | "starting"
              | "awaiting_qr"
              | "connected"
              | "reconnecting"
              | "offline"
              | "error"
            last_error?: string | null
            source?: "runtime" | "manual" | "none"
          }
        | null

      if (!res.ok) {
        throw new Error(data?.error || "Erro ao salvar QR Code")
      }

      await mutate("/api/bot/qr", data, false)
      toast.success("QR Code do bot atualizado!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar QR Code")
    } finally {
      setSavingBotQr(false)
    }
  }

  async function handleBotControl(action: "disconnect" | "restart") {
    setBotActionLoading(action)

    try {
      const res = await fetch("/api/bot/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })

      const data = (await res.json().catch(() => null)) as { error?: string } | null

      if (!res.ok) {
        throw new Error(data?.error || "Erro ao controlar bot")
      }

      await mutate("/api/bot/qr")
      toast.success(
        action === "restart"
          ? "Novo QR solicitado. Aguarde ele aparecer."
          : "Bot desconectado. Clique em Gerar QR para conectar novamente."
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao controlar bot")
    } finally {
      setBotActionLoading(null)
    }
  }

  async function handleSyncBotContacts() {
    if (!shouldShowContacts) {
      toast.error("Conecte o WhatsApp pela leitura do QR Code antes de sincronizar.")
      return
    }

    try {
      const data = await syncContactsFromBot()

      if ((data.inserted ?? 0) === 0 && (data.updated ?? 0) === 0) {
        toast.success("Contatos do bot ja estao atualizados.")
        return
      }

      toast.success(
        `${data.inserted ?? 0} contato(s) novo(s) e ${data.updated ?? 0} atualizado(s).`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao sincronizar contatos do bot"
      )
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
              placeholder="Buscar por nome, telefone ou ID..."
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
          <CardHeader className="gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                <Bot className="size-5" />
              </div>

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>QR Code do Bot WhatsApp</CardTitle>
                  <Badge variant={botStatusVariant}>{botStatusLabel}</Badge>
                  {botQrConfig?.source === "runtime" ? (
                    <Badge variant="outline">Automatico</Badge>
                  ) : null}
                </div>

                <CardDescription>
                  O bot agora publica o QR automaticamente neste painel quando precisar
                  reconectar. O campo abaixo fica como fallback manual.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/10 p-4 text-sm">
                <p className="font-medium">{botStatusMessage}</p>

                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {botQrUpdatedAt ? <p>Ultima atualizacao: {botQrUpdatedAt}</p> : null}
                  {botConnectedAt ? <p>Conectado em: {botConnectedAt}</p> : null}
                  {botQrConfig?.last_error ? <p>Erro: {botQrConfig.last_error}</p> : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">Nome da conta</p>
                  <p className="mt-1 text-sm font-medium">
                    {botQrConfig?.display_name || "-"}
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">Numero conectado</p>
                  <p className="mt-1 text-sm font-medium">
                    {botQrConfig?.phone_number || "-"}
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">JID</p>
                  <p className="mt-1 break-all text-sm font-medium">
                    {botQrConfig?.jid || "-"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={handleSyncBotContacts}
                  disabled={syncingBotContacts || !shouldShowContacts}
                >
                  {syncingBotContacts ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  {syncingBotContacts ? "Sincronizando..." : "Sincronizar contatos"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => handleBotControl("disconnect")}
                  disabled={botActionLoading !== null || botQrConfig?.status === "offline"}
                >
                  <PlugZap className="mr-2 size-4" />
                  {botActionLoading === "disconnect" ? "Desconectando..." : "Desconectar"}
                </Button>

                <Button
                  onClick={() => handleBotControl("restart")}
                  disabled={botActionLoading !== null}
                >
                  <RotateCcw className="mr-2 size-4" />
                  {botActionLoading === "restart" ? "Gerando QR..." : "Gerar QR"}
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="bot-qr-url">QR Code do bot</Label>
                <Textarea
                  id="bot-qr-url"
                  value={manualBotQrUrl}
                  onChange={(e) => setManualBotQrUrl(e.target.value)}
                  placeholder="Opcional: cole aqui uma URL publica do QR Code ou uma data URL para fallback manual"
                  className="min-h-28 resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Se o bot estiver rodando, o preview acima usa o QR automatico. Esse campo
                  so entra como reserva manual.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button onClick={handleSaveBotQr} disabled={savingBotQr || !botQrChanged}>
                  {savingBotQr ? "Salvando..." : "Salvar QR Manual"}
                </Button>

                {botQrConfig?.manual_updated_at ? (
                  <span className="text-xs text-muted-foreground">
                    Fallback manual atualizado em{" "}
                    {formatDateTimePtBr(botQrConfig.manual_updated_at)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Preview</Label>
              <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed bg-muted/10 p-4">
                {isLoadingBotQr ? (
                  <Skeleton className="size-[220px] rounded-xl" />
                ) : previewBotQrUrl ? (
                  <img
                    src={previewBotQrUrl}
                    alt="QR Code do bot WhatsApp"
                    className="max-h-[220px] w-full max-w-[220px] rounded-lg border bg-white object-contain p-2"
                  />
                ) : botQrConfig?.status === "connected" ? (
                  <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                    <div className="rounded-full border border-dashed p-3">
                      <Bot className="size-6" />
                    </div>
                    <p>
                      Bot conectado. O QR so aparece novamente quando o WhatsApp pedir uma
                      nova leitura.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                    <div className="rounded-full border border-dashed p-3">
                      <QrCode className="size-6" />
                    </div>
                    <p>
                      Nenhum QR disponivel no momento. Inicie o bot ou salve um fallback
                      manual para exibir aqui.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : syncingBotContacts && visibleContacts.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Sincronizando contatos do telefone conectado...
              </div>
            ) : visibleContacts.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {!shouldShowContacts
                  ? "Bot desconectado. Conecte o WhatsApp para exibir novamente os contatos sincronizados."
                  : contacts?.length === 0
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
                    {visibleContacts.map((contact) => (
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editContact ? "Editar Contato" : "Novo Contato"}</DialogTitle>
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
              {formErrors.name ? (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-type">Tipo</Label>
              <Select
                value={formType}
                onValueChange={(value) => setFormType(value as "individual" | "group")}
              >
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
                {formErrors.phone ? (
                  <p className="text-xs text-destructive">{formErrors.phone}</p>
                ) : null}
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
                {formErrors.groupId ? (
                  <p className="text-xs text-destructive">{formErrors.groupId}</p>
                ) : null}
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

            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. O contato sera removido permanentemente.
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
