"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import { Plus, Pencil, Trash2, Shield, User, Loader2, Eye, EyeOff, Database, AlertCircle, Bot } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { calculateChatIATrialEndsAt } from "@/lib/chat-ia-config"
import { formatDatePtBr } from "@/lib/datetime"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
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
  company_id?: string
  company_name?: string
  powerbi?: {
    tenant_id?: string
    client_id?: string
    client_secret?: string
  }
  n8n?: {
    webhook_url?: string
    callback_secret?: string
    chat_webhook_url?: string
  }
  chat_ia?: {
    enabled?: boolean
    workspace_id?: string
    dataset_id?: string
    dataset_name?: string
    webhook_url?: string
    trial_days?: number | null
    trial_started_at?: string
    trial_ends_at?: string
  }
  workspace_access_configured?: boolean
  dataset_access_configured?: boolean
  available_workspaces?: WorkspaceOption[]
  selected_pbi_workspace_ids?: string[]
  selected_pbi_dataset_ids?: string[]
  app_metadata?: {
    role?: string
    company_id?: string
  }
  user_metadata: {
    name?: string
    role?: string
    company_id?: string
  }
}

interface DatasetOption {
  id: string
  name: string
}

interface PowerBIPreview {
  workspace_count: number
  dataset_count: number
  workspaces: Array<{
    id: string
    name: string
    dataset_count: number
    datasets: DatasetOption[]
  }>
}

interface WorkspaceOption {
  id: string
  name: string
  dataset_count?: number
  datasets?: DatasetOption[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatDateTimePtBr(value: string) {
  if (!value) return ""

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ""
  }

  return parsed.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

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
  const [formCompanyName, setFormCompanyName] = useState("")
  const [formPbiTenantId, setFormPbiTenantId] = useState("")
  const [formPbiClientId, setFormPbiClientId] = useState("")
  const [formPbiClientSecret, setFormPbiClientSecret] = useState("")
  const [formN8nWebhookUrl, setFormN8nWebhookUrl] = useState("")
  const [formN8nCallbackSecret, setFormN8nCallbackSecret] = useState("")
  const [formN8nChatWebhookUrl, setFormN8nChatWebhookUrl] = useState("")
  const [formChatIaEnabled, setFormChatIaEnabled] = useState(false)
  const [formChatIaWorkspaceId, setFormChatIaWorkspaceId] = useState("")
  const [formChatIaDatasetId, setFormChatIaDatasetId] = useState("")
  const [formChatIaDatasetName, setFormChatIaDatasetName] = useState("")
  const [formChatIaWebhookUrl, setFormChatIaWebhookUrl] = useState("")
  const [formChatIaTrialDays, setFormChatIaTrialDays] = useState("")
  const [formChatIaTrialEndsAt, setFormChatIaTrialEndsAt] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showN8nCallbackSecret, setShowN8nCallbackSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadingEditDetails, setLoadingEditDetails] = useState(false)
  const [testingPowerBI, setTestingPowerBI] = useState(false)
  const [powerbiPreview, setPowerbiPreview] = useState<PowerBIPreview | null>(null)
  const [powerbiPreviewError, setPowerbiPreviewError] = useState<string | null>(null)
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([])
  const [selectedPbiWorkspaceIds, setSelectedPbiWorkspaceIds] = useState<string[]>([])
  const [selectedPbiDatasetIds, setSelectedPbiDatasetIds] = useState<string[]>([])
  const totalAvailableDatasets = workspaceOptions.reduce(
    (count, workspace) =>
      count + (Array.isArray(workspace.datasets) ? workspace.datasets.length : 0),
    0
  )
  const parsedChatIaTrialDays = formChatIaTrialDays.trim()
    ? Number.parseInt(formChatIaTrialDays.trim(), 10)
    : null
  const chatIaTrialEndsAtLabel = formatDateTimePtBr(formChatIaTrialEndsAt)
  const chatIaTrialExpired = formChatIaTrialEndsAt
    ? Date.parse(formChatIaTrialEndsAt) <= Date.now()
    : false
  const showChatIaDetails =
    formChatIaEnabled ||
    !!formChatIaWebhookUrl ||
    !!formChatIaTrialDays.trim() ||
    !!formChatIaTrialEndsAt

  function notifySuccess(message: string) {
    window.setTimeout(() => {
      toast.success(message)
    }, 0)
  }

  function notifyError(message: string) {
    window.setTimeout(() => {
      toast.error(message)
    }, 0)
  }

  function openCreate() {
    setEditUser(null)
    setFormEmail("")
    setFormPassword("")
    setFormName("")
    setFormRole("client")
    setFormCompanyName("")
    setFormPbiTenantId("")
    setFormPbiClientId("")
    setFormPbiClientSecret("")
    setFormN8nWebhookUrl("")
    setFormN8nCallbackSecret("")
    setFormN8nChatWebhookUrl("")
    setFormChatIaEnabled(false)
    setFormChatIaWorkspaceId("")
    setFormChatIaDatasetId("")
    setFormChatIaDatasetName("")
    setFormChatIaWebhookUrl("")
    setFormChatIaTrialDays("")
    setFormChatIaTrialEndsAt("")
    setLoadingEditDetails(false)
    setShowPassword(false)
    setShowN8nCallbackSecret(false)
    setPowerbiPreview(null)
      setPowerbiPreviewError(null)
      setWorkspaceOptions([])
      setSelectedPbiWorkspaceIds([])
      setSelectedPbiDatasetIds([])
      setDialogOpen(true)
  }

  async function openEdit(user: UserData) {
    setEditUser(user)
    setFormEmail(user.email)
    setFormPassword("")
    setFormName(user.user_metadata?.name || "")
    const role = user.app_metadata?.role || user.user_metadata?.role
    setFormRole((role as "client" | "admin") || "client")
    setFormCompanyName("")
    setFormPbiTenantId("")
    setFormPbiClientId("")
    setFormPbiClientSecret("")
    setFormN8nWebhookUrl("")
    setFormN8nCallbackSecret("")
    setFormN8nChatWebhookUrl("")
    setFormChatIaEnabled(false)
    setFormChatIaWorkspaceId("")
    setFormChatIaDatasetId("")
    setFormChatIaDatasetName("")
    setFormChatIaWebhookUrl("")
    setFormChatIaTrialDays("")
    setFormChatIaTrialEndsAt("")
    setShowPassword(false)
    setShowN8nCallbackSecret(false)
    setPowerbiPreview(null)
    setPowerbiPreviewError(null)
    setWorkspaceOptions([])
    setSelectedPbiWorkspaceIds([])
    setSelectedPbiDatasetIds([])
    setLoadingEditDetails(true)
    setDialogOpen(true)

    try {
      const res = await fetch(`/api/admin/users?id=${user.id}`)
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || "Erro ao carregar dados do usuario")
      }

      const details = data as UserData
      setFormCompanyName(details.company_name || "")
      setFormPbiTenantId(details.powerbi?.tenant_id || "")
      setFormPbiClientId(details.powerbi?.client_id || "")
      setFormPbiClientSecret(details.powerbi?.client_secret || "")
      setFormN8nWebhookUrl(details.n8n?.webhook_url || "")
      setFormN8nCallbackSecret(details.n8n?.callback_secret || "")
      setFormN8nChatWebhookUrl(details.n8n?.chat_webhook_url || "")
      setFormChatIaEnabled(details.chat_ia?.enabled ?? false)
      setFormChatIaWorkspaceId(details.chat_ia?.workspace_id ?? "")
      setFormChatIaDatasetId(details.chat_ia?.dataset_id ?? "")
      setFormChatIaDatasetName(details.chat_ia?.dataset_name ?? "")
      setFormChatIaWebhookUrl(details.chat_ia?.webhook_url ?? "")
      setFormChatIaTrialDays(
        details.chat_ia?.trial_days ? String(details.chat_ia.trial_days) : ""
      )
      setFormChatIaTrialEndsAt(details.chat_ia?.trial_ends_at ?? "")
      setWorkspaceOptions(details.available_workspaces || [])
      setSelectedPbiWorkspaceIds(details.selected_pbi_workspace_ids || [])
      setSelectedPbiDatasetIds(details.selected_pbi_dataset_ids || [])
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Erro ao carregar dados do usuario")
    } finally {
      setLoadingEditDetails(false)
    }
  }

  function toggleWorkspace(workspaceId: string, checked: boolean) {
    const workspace = workspaceOptions.find((item) => item.id === workspaceId)
    const datasetIds = Array.isArray(workspace?.datasets)
      ? workspace.datasets.flatMap((dataset) =>
          dataset.id.trim() ? [dataset.id.trim()] : []
        )
      : []

    setSelectedPbiWorkspaceIds((current) =>
      checked
        ? Array.from(new Set([...current, workspaceId]))
        : current.filter((id) => id !== workspaceId)
    )

    if (datasetIds.length > 0) {
      setSelectedPbiDatasetIds((current) =>
        checked
          ? Array.from(new Set([...current, ...datasetIds]))
          : current.filter((id) => !datasetIds.includes(id))
      )
    }
  }

  function toggleDataset(workspaceId: string, datasetId: string, checked: boolean) {
    setSelectedPbiDatasetIds((current) =>
      checked
        ? Array.from(new Set([...current, datasetId]))
        : current.filter((id) => id !== datasetId)
    )

    if (checked) {
      setSelectedPbiWorkspaceIds((current) =>
        current.includes(workspaceId) ? current : [...current, workspaceId]
      )
    }
  }

  function toggleAllDatasetsForWorkspace(workspaceId: string, checked: boolean) {
    const workspace = workspaceOptions.find((item) => item.id === workspaceId)
    const datasetIds = Array.isArray(workspace?.datasets)
      ? workspace.datasets.flatMap((dataset) =>
          dataset.id.trim() ? [dataset.id.trim()] : []
        )
      : []

    if (datasetIds.length === 0) return

    setSelectedPbiDatasetIds((current) =>
      checked
        ? Array.from(new Set([...current, ...datasetIds]))
        : current.filter((id) => !datasetIds.includes(id))
    )

    if (checked) {
      setSelectedPbiWorkspaceIds((current) =>
        current.includes(workspaceId) ? current : [...current, workspaceId]
      )
    }
  }

  async function handleTestPowerBI() {
    if (!formPbiTenantId || !formPbiClientId || !formPbiClientSecret) {
      notifyError("Preencha Tenant ID, Client ID e Client Secret")
      return
    }

    setTestingPowerBI(true)
    setPowerbiPreview(null)
    setPowerbiPreviewError(null)

    try {
      const res = await fetch("/api/admin/powerbi/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: formPbiTenantId,
          client_id: formPbiClientId,
          client_secret: formPbiClientSecret,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Falha ao validar credenciais")
      }
      const preview = data as PowerBIPreview
      const nextWorkspaceOptions = preview.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        dataset_count: workspace.dataset_count,
        datasets: workspace.datasets || [],
      }))
      const nextDatasetIds = nextWorkspaceOptions.flatMap((workspace) =>
        Array.isArray(workspace.datasets)
          ? workspace.datasets.flatMap((dataset) =>
              dataset.id.trim() ? [dataset.id.trim()] : []
            )
          : []
      )

      setPowerbiPreview(preview)
      setWorkspaceOptions(nextWorkspaceOptions)
      setSelectedPbiWorkspaceIds((current) => {
        if (workspaceOptions.length === 0 && current.length === 0) {
          return nextWorkspaceOptions.map((workspace) => workspace.id)
        }

        const nextIds = new Set(nextWorkspaceOptions.map((workspace) => workspace.id))
        return current.filter((id) => nextIds.has(id))
      })
      setSelectedPbiDatasetIds((current) => {
        if (workspaceOptions.length === 0 && current.length === 0) {
          return nextDatasetIds
        }

        const nextIds = new Set(nextDatasetIds)
        return current.filter((id) => nextIds.has(id))
      })
      notifySuccess("Credenciais validadas e dados carregados")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao validar credenciais"
      setPowerbiPreviewError(message)
      notifyError(message)
    } finally {
      setTestingPowerBI(false)
    }
  }

  async function handleSave() {
    if (!formEmail || (!editUser && !formPassword)) {
      notifyError("Preencha todos os campos obrigatorios")
      return
    }
    if (
      formRole === "client" &&
      (!formCompanyName || !formPbiTenantId || !formPbiClientId || !formPbiClientSecret)
    ) {
      notifyError("Para cliente, preencha empresa e credenciais Power BI")
      return
    }
    if (
      formRole === "client" &&
      formChatIaTrialDays.trim() &&
      (
        parsedChatIaTrialDays === null ||
        !Number.isInteger(parsedChatIaTrialDays) ||
        parsedChatIaTrialDays <= 0
      )
    ) {
      notifyError("Dias de teste do Chat IA deve ser um numero inteiro maior que zero")
      return
    }

    setSaving(true)
    try {
      const selectedPbiDatasetAccess =
        formRole === "client" && workspaceOptions.length > 0
          ? workspaceOptions.flatMap((workspace) => {
              if (
                !selectedPbiWorkspaceIds.includes(workspace.id) ||
                !Array.isArray(workspace.datasets)
              ) {
                return []
              }

              return workspace.datasets.flatMap((dataset) =>
                selectedPbiDatasetIds.includes(dataset.id)
                  ? [{ workspace_id: workspace.id, dataset_id: dataset.id }]
                  : []
              )
            })
          : undefined

      const payload = {
        id: editUser?.id,
        email: formEmail,
        password: formPassword || undefined,
        name: formName,
        role: formRole,
        company_name: formRole === "client" ? formCompanyName : undefined,
        powerbi:
          formRole === "client"
            ? {
                tenant_id: formPbiTenantId,
                client_id: formPbiClientId,
                client_secret: formPbiClientSecret,
              }
            : undefined,
        n8n:
          formRole === "client"
            ? {
                webhook_url: formN8nWebhookUrl,
                callback_secret: formN8nCallbackSecret,
                chat_webhook_url: formN8nChatWebhookUrl,
              }
            : undefined,
        chat_ia:
          formRole === "client"
            ? {
                enabled: formChatIaEnabled,
                webhook_url: formChatIaWebhookUrl,
                trial_days: formChatIaTrialDays.trim() || null,
              }
            : undefined,
        selected_pbi_workspace_ids:
          formRole === "client" && workspaceOptions.length > 0
            ? selectedPbiWorkspaceIds
            : undefined,
        selected_pbi_dataset_ids:
          formRole === "client" && workspaceOptions.length > 0
            ? selectedPbiDatasetIds
            : undefined,
        selected_pbi_dataset_access: selectedPbiDatasetAccess,
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

      setDialogOpen(false)
      void mutate("/api/admin/users")
      void mutate("/api/admin/stats")
      notifySuccess(editUser ? "Usuario atualizado!" : "Usuario criado!")
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Erro ao salvar")
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
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Erro ao remover usuario")
      }
      setDeleteDialogOpen(false)
      setDeleteUser(null)
      void mutate("/api/admin/users")
      void mutate("/api/admin/stats")
      notifySuccess("Usuario removido!")
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Erro ao remover usuario")
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
                            variant={(user.app_metadata?.role || user.user_metadata?.role) === "admin" ? "destructive" : "secondary"}
                            className="gap-1"
                          >
                            {(user.app_metadata?.role || user.user_metadata?.role) === "admin" ? (
                              <Shield className="size-3" />
                            ) : (
                              <User className="size-3" />
                            )}
                            {(user.app_metadata?.role || user.user_metadata?.role) === "admin" ? "Admin" : "Cliente"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {formatDatePtBr(user.created_at)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {user.last_sign_in_at
                            ? formatDatePtBr(user.last_sign_in_at)
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
        <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border/60 px-4 py-3 sm:px-6">
            <DialogTitle>
              {editUser ? "Editar Usuario" : "Novo Usuario"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid gap-4 md:grid-cols-2">
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
                />
                {editUser ? (
                  <p className="text-xs text-muted-foreground">
                    Altere o email e clique em Salvar para gravar.
                  </p>
                ) : null}
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

              {formRole === "client" && loadingEditDetails ? (
                <div className="flex min-h-40 items-center justify-center rounded-lg border border-border/60 md:col-span-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Carregando configuracoes do cliente...
                  </div>
                </div>
              ) : null}

              {formRole === "client" && !loadingEditDetails && (
                <>
                  <div className="rounded-lg border border-border/60 p-3 md:col-span-2">
                    <p className="mb-3 text-sm font-medium">Empresa do Cliente</p>
                    <div className="flex flex-col gap-2">
                      <Label>Nome da Empresa *</Label>
                      <Input
                        value={formCompanyName}
                        onChange={(e) => setFormCompanyName(e.target.value)}
                        placeholder="Ex: JA"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 p-3 md:col-span-2">
                    <p className="mb-3 text-sm font-medium">Power BI (Cliente)</p>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Tenant ID *</Label>
                        <Input
                          value={formPbiTenantId}
                          onChange={(e) => {
                            setFormPbiTenantId(e.target.value)
                            setPowerbiPreview(null)
                            setPowerbiPreviewError(null)
                            setWorkspaceOptions([])
                            setSelectedPbiWorkspaceIds([])
                            setSelectedPbiDatasetIds([])
                          }}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Client ID *</Label>
                        <Input
                          value={formPbiClientId}
                          onChange={(e) => {
                            setFormPbiClientId(e.target.value)
                            setPowerbiPreview(null)
                            setPowerbiPreviewError(null)
                            setWorkspaceOptions([])
                            setSelectedPbiWorkspaceIds([])
                            setSelectedPbiDatasetIds([])
                          }}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Client Secret *</Label>
                        <Input
                          type="password"
                          value={formPbiClientSecret}
                          onChange={(e) => {
                            setFormPbiClientSecret(e.target.value)
                            setPowerbiPreview(null)
                            setPowerbiPreviewError(null)
                            setWorkspaceOptions([])
                            setSelectedPbiWorkspaceIds([])
                            setSelectedPbiDatasetIds([])
                          }}
                          placeholder="Client secret"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleTestPowerBI}
                        disabled={testingPowerBI}
                      >
                        {testingPowerBI && <Loader2 className="mr-2 size-4 animate-spin" />}
                        Validar e Mostrar Dados
                      </Button>

                      {powerbiPreview && (
                        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                          <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                            <Database className="size-4 text-primary" />
                            {powerbiPreview.workspace_count} workspaces e {powerbiPreview.dataset_count} datasets encontrados
                          </div>
                          <div className="max-h-36 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                            {powerbiPreview.workspaces.map((ws) => (
                              <div key={ws.id} className="flex items-center justify-between rounded-sm border border-border/40 px-2 py-1">
                                <span className="truncate pr-2">{ws.name}</span>
                                <span>{ws.dataset_count} datasets</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {powerbiPreviewError && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                          <div className="flex items-center gap-1.5">
                            <AlertCircle className="size-3.5" />
                            <span>{powerbiPreviewError}</span>
                          </div>
                        </div>
                      )}

                      <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">Workspaces liberados</p>
                            <p className="text-xs text-muted-foreground">
                              Selecione quais workspaces este usuario podera acessar.
                            </p>
                          </div>
                          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedPbiWorkspaceIds(workspaceOptions.map((workspace) => workspace.id))}
                              disabled={workspaceOptions.length === 0}
                              className="h-8 px-3 text-xs whitespace-nowrap"
                            >
                              Marcar todos
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedPbiWorkspaceIds([])}
                              disabled={workspaceOptions.length === 0}
                              className="h-8 px-3 text-xs whitespace-nowrap"
                            >
                              Limpar
                            </Button>
                          </div>
                        </div>

                        {workspaceOptions.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                            Valide as credenciais do Power BI para carregar os workspaces disponiveis.
                          </div>
                        ) : (
                          <>
                            <div className="mb-3 flex flex-wrap gap-2">
                              <Badge variant="secondary" className="font-normal">
                                {selectedPbiWorkspaceIds.length} de {workspaceOptions.length} workspaces selecionados
                              </Badge>
                              <Badge variant="outline" className="font-normal">
                                {selectedPbiDatasetIds.length} de {totalAvailableDatasets} datasets selecionados
                              </Badge>
                            </div>
                            <ScrollArea className="h-80 rounded-md border border-border/60">
                              <div className="space-y-3 p-3">
                                {workspaceOptions.map((workspace) => {
                                  const checked = selectedPbiWorkspaceIds.includes(workspace.id)
                                  const datasets = Array.isArray(workspace.datasets)
                                    ? workspace.datasets
                                    : []
                                  const selectedDatasetCount = datasets.filter((dataset) =>
                                    selectedPbiDatasetIds.includes(dataset.id)
                                  ).length

                                  return (
                                    <div
                                      key={workspace.id}
                                      className="rounded-xl border border-border/50 bg-background/60 p-3 text-sm shadow-sm"
                                    >
                                      <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/30">
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(value) => toggleWorkspace(workspace.id, value === true)}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-medium text-foreground" title={workspace.name}>
                                            {workspace.name}
                                          </div>
                                          <div className="mt-1 truncate text-[11px] text-muted-foreground" title={workspace.id}>
                                            ID: {workspace.id}
                                          </div>
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {typeof workspace.dataset_count === "number" ? (
                                              <Badge variant="outline" className="font-normal">
                                                {workspace.dataset_count} datasets
                                              </Badge>
                                            ) : null}
                                            {datasets.length > 0 ? (
                                              <Badge variant="secondary" className="font-normal">
                                                {selectedDatasetCount} selecionados
                                              </Badge>
                                            ) : null}
                                          </div>
                                        </div>
                                      </label>

                                      {checked ? (
                                        <div className="mt-3 border-t border-border/40 pt-3">
                                          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                            <p className="text-xs font-medium text-foreground">
                                              Datasets deste workspace
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => toggleAllDatasetsForWorkspace(workspace.id, true)}
                                                disabled={datasets.length === 0}
                                                className="h-8 px-3 text-xs whitespace-nowrap"
                                              >
                                                Todos datasets
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => toggleAllDatasetsForWorkspace(workspace.id, false)}
                                                disabled={datasets.length === 0}
                                                className="h-8 px-3 text-xs whitespace-nowrap"
                                              >
                                                Limpar datasets
                                              </Button>
                                            </div>
                                          </div>

                                          {datasets.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">
                                              Nenhum dataset encontrado neste workspace.
                                            </div>
                                          ) : (
                                            <div className="space-y-2">
                                              {datasets.map((dataset) => (
                                                <label
                                                  key={dataset.id}
                                                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border/40 bg-background px-3 py-3 transition-colors hover:bg-muted/20"
                                                >
                                                  <Checkbox
                                                    checked={selectedPbiDatasetIds.includes(dataset.id)}
                                                    onCheckedChange={(value) =>
                                                      toggleDataset(
                                                        workspace.id,
                                                        dataset.id,
                                                        value === true
                                                      )
                                                    }
                                                  />
                                                  <div className="min-w-0 flex-1">
                                                    <div
                                                      className="truncate font-medium leading-snug text-foreground"
                                                      title={dataset.name}
                                                    >
                                                      {dataset.name}
                                                    </div>
                                                    <div
                                                      className="mt-1 truncate text-[11px] text-muted-foreground"
                                                      title={dataset.id}
                                                    >
                                                      ID: {dataset.id}
                                                    </div>
                                                  </div>
                                                </label>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            </ScrollArea>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 p-3 md:col-span-2">
                    <p className="mb-3 text-sm font-medium">N8N (Cliente)</p>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Webhook URL</Label>
                        <Input
                          value={formN8nWebhookUrl}
                          onChange={(e) => setFormN8nWebhookUrl(e.target.value)}
                          placeholder="https://n8n.dominio.com/webhook/..."
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Callback Secret (obrigatorio com webhook)</Label>
                        <div className="relative">
                          <Input
                            type={showN8nCallbackSecret ? "text" : "password"}
                            value={formN8nCallbackSecret}
                            onChange={(e) => setFormN8nCallbackSecret(e.target.value)}
                            placeholder="Segredo usado pelo n8n para callbacks e envio"
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowN8nCallbackSecret((current) => !current)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            aria-label={
                              showN8nCallbackSecret
                                ? "Ocultar Callback Secret"
                                : "Mostrar Callback Secret"
                            }
                          >
                            {showN8nCallbackSecret ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Chat IA — Webhook URL</Label>
                        <Input
                          value={formN8nChatWebhookUrl}
                          onChange={(e) => setFormN8nChatWebhookUrl(e.target.value)}
                          placeholder="https://n8n.dominio.com/webhook/dashpro-chat"
                        />
                        <p className="text-xs text-muted-foreground">
                          Deixe vazio para usar OpenAI diretamente via OPENAI_API_KEY.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 p-3 md:col-span-2">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-primary" />
                        <p className="text-sm font-medium">Chat IA</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="chat-ia-enabled" className="text-xs text-muted-foreground">
                          {formChatIaEnabled ? "Ativado" : "Desativado"}
                        </Label>
                        <Switch
                          id="chat-ia-enabled"
                          checked={formChatIaEnabled}
                          onCheckedChange={setFormChatIaEnabled}
                        />
                      </div>
                    </div>

                    {showChatIaDetails && (
                      <div className="flex flex-col gap-3">
                        <p className="text-xs text-muted-foreground">
                          Configure apenas o webhook do Chat IA. Workspace e dataset serao definidos automaticamente pelo sistema.
                        </p>

                        <div className="flex flex-col gap-2">
                          <Label>Webhook URL especifico (opcional)</Label>
                          <Input
                            value={formChatIaWebhookUrl}
                            onChange={(e) => setFormChatIaWebhookUrl(e.target.value)}
                            placeholder="Deixe vazio para usar o webhook do N8N ou OpenAI"
                          />
                          <p className="text-xs text-muted-foreground">
                            Sobrescreve o webhook do N8N para este cliente. Deixe vazio para usar o padrao.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <Label>Dias de teste (opcional)</Label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={formChatIaTrialDays}
                            onChange={(e) => {
                              const nextValue = e.target.value
                              const nextTrialDays = nextValue.trim()
                                ? Number.parseInt(nextValue.trim(), 10)
                                : null

                              setFormChatIaTrialDays(nextValue)
                              setFormChatIaTrialEndsAt(
                                nextTrialDays && Number.isInteger(nextTrialDays) && nextTrialDays > 0
                                  ? calculateChatIATrialEndsAt(nextTrialDays)
                                  : ""
                              )
                            }}
                            placeholder="Ex.: 7"
                          />
                          <p className="text-xs text-muted-foreground">
                            Deixe vazio para manter o Chat IA sem data de expiracao. Ao alterar este campo e salvar, uma nova data final sera calculada automaticamente.
                          </p>
                        </div>

                        {(chatIaTrialEndsAtLabel || formChatIaTrialDays.trim()) && (
                          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              {formChatIaTrialDays.trim() ? (
                                <Badge variant="secondary" className="font-normal">
                                  {formChatIaTrialDays.trim()} dia(s) de teste
                                </Badge>
                              ) : null}
                              {chatIaTrialEndsAtLabel ? (
                                <Badge
                                  variant={chatIaTrialExpired ? "destructive" : "outline"}
                                  className="font-normal"
                                >
                                  {chatIaTrialExpired ? "Teste expirado" : `Expira em ${chatIaTrialEndsAtLabel}`}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="font-normal">
                                  A data final sera gerada ao salvar
                                </Badge>
                              )}
                            </div>
                            <p className="mt-2 text-muted-foreground">
                              Quando a data final chegar, o sistema desabilita o Chat IA automaticamente para este cliente.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter className="border-t border-border/60 px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || loadingEditDetails}>
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
