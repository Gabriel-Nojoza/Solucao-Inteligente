"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Save, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CronBuilder } from "@/components/schedules/cron-builder"
import { toast } from "sonner"
import type { Contact } from "@/lib/types"
import { isValidCronValue } from "@/lib/schedule-cron"

interface SaveAutomationDialogProps {
  contacts: Contact[]
  showContacts: boolean
  onSave: (data: {
    name: string
    cron_expression: string | null
    export_format: string
    message_template: string
    contact_ids: string[]
  }) => Promise<void>
  disabled?: boolean
}

export function SaveAutomationDialog({
  contacts,
  showContacts,
  onSave,
  disabled,
}: SaveAutomationDialogProps) {
  const router = useRouter()
  const defaultMessage = "Segue os dados da automacao {name} em anexo."
  const defaultCron = "0 8 * * 1-5"
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [cron, setCron] = useState(defaultCron)
  const [enableSchedule, setEnableSchedule] = useState(false)
  const [exportFormat, setExportFormat] = useState("csv")
  const [message, setMessage] = useState(defaultMessage)
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const activeContacts = showContacts
    ? contacts.filter((contact) => contact.is_active)
    : []

  useEffect(() => {
    if (!showContacts) {
      setSelectedContacts([])
    }
  }, [showContacts])

  const resetForm = () => {
    setName("")
    setCron(defaultCron)
    setEnableSchedule(false)
    setExportFormat("csv")
    setMessage(defaultMessage)
    setSelectedContacts([])
  }

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Informe um nome para a automacao")
      return
    }
    if (enableSchedule && (!cron.trim() || !isValidCronValue(cron))) {
      toast.error("Defina uma frequencia valida para o agendamento")
      return
    }
    if (enableSchedule && !showContacts) {
      toast.error("Conecte o WhatsApp pela leitura do QR Code para liberar os contatos")
      return
    }
    if (enableSchedule && activeContacts.length > 0 && selectedContacts.length === 0) {
      toast.error("Selecione ao menos 1 contato para o envio automatico")
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        cron_expression: enableSchedule ? cron.trim() : null,
        export_format: exportFormat,
        message_template: message,
        contact_ids: selectedContacts,
      })
      setOpen(false)
      resetForm()
      router.push("/reports")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar automacao")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && !saving) {
          resetForm()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={disabled}>
          <Save className="size-3" />
          Salvar Automacao
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Salvar Automacao</DialogTitle>
          <DialogDescription>
            Salve esta query como automacao para executar sob demanda ou agendar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="auto-name">Nome da automacao</Label>
            <Input
              id="auto-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Vendas por regiao - Semanal"
            />
          </div>

          <div className="space-y-2">
            <Label>Formato de exportacao</Label>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="table">Tabela (texto)</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="enable-schedule"
                checked={enableSchedule}
                onCheckedChange={(v) => {
                  const checked = v === true
                  setEnableSchedule(checked)
                  if (checked && !cron.trim()) {
                    setCron(defaultCron)
                  }
                }}
              />
              <Label htmlFor="enable-schedule">Agendar execucao automatica</Label>
            </div>
            {enableSchedule && (
              <CronBuilder value={cron} onChange={setCron} />
            )}
          </div>

          <div className="space-y-2">
            <Label>Mensagem do disparo</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Use {name} para o nome da automacao"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Contatos para envio</Label>
            {!showContacts ? (
              <p className="text-xs text-muted-foreground">
                Os contatos so aparecem depois que o WhatsApp for conectado pela leitura do QR Code.
              </p>
            ) : activeContacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum contato ativo cadastrado. Adicione na pagina de Contatos.
              </p>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {activeContacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedContacts.includes(contact.id)}
                      onCheckedChange={() => toggleContact(contact.id)}
                    />
                    <span className="text-sm">{contact.name}</span>
                    {contact.phone && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {contact.phone}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false)
              resetForm()
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || (enableSchedule && !showContacts)}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
