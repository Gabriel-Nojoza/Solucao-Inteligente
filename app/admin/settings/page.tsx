"use client"

import { useEffect, useState } from "react"
import useSWR, { mutate } from "swr"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { BRAND_NAME } from "@/lib/branding"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function SettingsPage() {
  const { data: settings, isLoading } = useSWR("/api/settings", fetcher)

  // Power BI
  const [tenantId, setTenantId] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [pbiTesting, setPbiTesting] = useState(false)
  const [pbiTestResult, setPbiTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // N8N
  const [webhookUrl, setWebhookUrl] = useState("")
  const [callbackSecret, setCallbackSecret] = useState("")
  const [n8nTesting, setN8nTesting] = useState(false)
  const [n8nTestResult, setN8nTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // General
  const [appName, setAppName] = useState(BRAND_NAME)
  const [timezone, setTimezone] = useState("America/Sao_Paulo")

  const [saving, setSaving] = useState("")

  useEffect(() => {
    if (settings) {
      if (settings.powerbi) {
        setTenantId(settings.powerbi.tenant_id ?? "")
        setClientId(settings.powerbi.client_id ?? "")
        setClientSecret(settings.powerbi.client_secret ?? "")
      }
      if (settings.n8n) {
        setWebhookUrl(settings.n8n.webhook_url ?? "")
        setCallbackSecret(settings.n8n.callback_secret ?? "")
      }
      if (settings.general) {
        setAppName(settings.general.app_name ?? BRAND_NAME)
        setTimezone(settings.general.timezone ?? "America/Sao_Paulo")
      }
    }
  }, [settings])

  async function saveSetting(key: string, value: Record<string, string>) {
    setSaving(key)
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Erro ao salvar configuracao")
      }
      toast.success("Configuracao salva!")
      mutate("/api/settings")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar")
    } finally {
      setSaving("")
    }
  }

  async function testPowerBI() {
    setPbiTesting(true)
    setPbiTestResult(null)
    // Save first
    await saveSetting("powerbi", { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret })
    try {
      const res = await fetch("/api/powerbi/test", { method: "POST" })
      const data = await res.json()
      setPbiTestResult(data)
    } catch {
      setPbiTestResult({ success: false, message: "Erro de conexao" })
    } finally {
      setPbiTesting(false)
    }
  }

  async function testN8N() {
    setN8nTesting(true)
    setN8nTestResult(null)
    if (!callbackSecret.trim()) {
      setN8nTestResult({
        success: false,
        message: "Informe o Callback Secret antes de testar o fluxo do WhatsApp.",
      })
      setN8nTesting(false)
      return
    }
    await saveSetting("n8n", { webhook_url: webhookUrl, callback_secret: callbackSecret })
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, source: BRAND_NAME }),
      })
      setN8nTestResult({
        success: res.ok,
        message: res.ok ? "Webhook respondeu com sucesso!" : `Erro: Status ${res.status}`,
      })
    } catch {
      setN8nTestResult({ success: false, message: "Nao foi possivel conectar ao webhook" })
    } finally {
      setN8nTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Configuracoes" />
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Configuracoes" description="Gerencie integracoes e preferencias" />
      <div className="flex flex-col gap-4 p-6">
        <Tabs defaultValue="powerbi">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="powerbi">Power BI</TabsTrigger>
            <TabsTrigger value="n8n">N8N</TabsTrigger>
            <TabsTrigger value="general">Geral</TabsTrigger>
          </TabsList>

          {/* Power BI Tab */}
          <TabsContent value="powerbi">
            <Card>
              <CardHeader>
                <CardTitle>Power BI - Azure AD</CardTitle>
                <CardDescription>
                  Credenciais do App Registration para acessar a API do Power BI.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tenant-id">Tenant ID</Label>
                  <Input
                    id="tenant-id"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="client-id">Client ID</Label>
                  <Input
                    id="client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="client-secret">Client Secret</Label>
                  <Input
                    id="client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Seu client secret"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() =>
                      saveSetting("powerbi", {
                        tenant_id: tenantId,
                        client_id: clientId,
                        client_secret: clientSecret,
                      })
                    }
                    disabled={saving === "powerbi"}
                  >
                    {saving === "powerbi" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={testPowerBI} disabled={pbiTesting}>
                    {pbiTesting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Testar Conexao
                  </Button>
                </div>
                {pbiTestResult && (
                  <div
                    className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                      pbiTestResult.success
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {pbiTestResult.success ? (
                      <CheckCircle className="size-4" />
                    ) : (
                      <XCircle className="size-4" />
                    )}
                    {pbiTestResult.message}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* N8N Tab */}
          <TabsContent value="n8n">
            <Card>
              <CardHeader>
                <CardTitle>N8N - Webhook</CardTitle>
                <CardDescription>
                  Configure o webhook do N8N para disparos via WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://n8n.seudominio.com/webhook/xxx"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="callback-secret">Callback Secret (obrigatorio)</Label>
                  <Input
                    id="callback-secret"
                    type="password"
                    value={callbackSecret}
                    onChange={(e) => setCallbackSecret(e.target.value)}
                    placeholder="Segredo usado pelo n8n para enviar no WhatsApp e atualizar os logs"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() =>
                      saveSetting("n8n", {
                        webhook_url: webhookUrl,
                        callback_secret: callbackSecret,
                      })
                    }
                    disabled={saving === "n8n"}
                  >
                    {saving === "n8n" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Salvar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={testN8N}
                    disabled={n8nTesting || !webhookUrl}
                  >
                    {n8nTesting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Testar Webhook
                  </Button>
                </div>
                {n8nTestResult && (
                  <div
                    className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                      n8nTestResult.success
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {n8nTestResult.success ? (
                      <CheckCircle className="size-4" />
                    ) : (
                      <XCircle className="size-4" />
                    )}
                    {n8nTestResult.message}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* General Tab */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Geral</CardTitle>
                <CardDescription>Preferencias gerais do sistema.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="app-name">Nome do Sistema</Label>
                  <Input
                    id="app-name"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timezone">Fuso Horario</Label>
                  <Input
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="America/Sao_Paulo"
                  />
                </div>
                <Button
                  onClick={() =>
                    saveSetting("general", { app_name: appName, timezone })
                  }
                  disabled={saving === "general"}
                >
                  {saving === "general" ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Salvar
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
