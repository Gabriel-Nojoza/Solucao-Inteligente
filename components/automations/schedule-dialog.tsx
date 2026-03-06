"use client"

import { useState } from "react"
import { CalendarClock, Loader2 } from "lucide-react"
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

interface ScheduleDialogProps {
  contacts: Contact[]
  onSave: (data: {
    name: string
    cron_expression: string | null
    export_format: string
    message_template: string
    contact_ids: string[]
  }) => Promise<void>
  disabled?: boolean
}

export function ScheduleDialog({
  contacts,
  onSave,
  disabled,
}: ScheduleDialogProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [cron, setCron] = useState("0 8 * * 1-5")
  const [exportFormat, setExportFormat] = useState("csv")
  const [message, setMessage] = useState("Segue os dados da automacao {name} em anexo.")
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const activeContacts = contacts.filter((c) => c.is_active)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Informe um nome para o agendamento")
      return
    }
    if (!cron.trim()) {
      toast.error("Selecione uma frequencia")
      return
    }
    if (selectedContacts.length === 0) {
      toast.error("Selecione ao menos 1 contato")
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        cron_expression: cron,
        export_format: exportFormat,
        message_template: message,
        contact_ids: selectedContacts,
      })
      setOpen(false)
      setName("")
      setCron("0 8 * * 1-5")
      setSelectedContacts([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao agendar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={disabled}
        >
          <CalendarClock className="size-3" />
          <span className="hidden sm:inline">Agendar</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agendar Automacao</DialogTitle>
          <DialogDescription>
            Configure a frequencia e os contatos para o envio automatico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nome do agendamento</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Vendas diario - Equipe comercial"
            />
          </div>

          <div className="space-y-2">
            <Label>Frequencia</Label>
            <CronBuilder value={cron} onChange={setCron} />
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
            <Label>Mensagem</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Use {name} para o nome da automacao"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Contatos ({selectedContacts.length} selecionado(s))</Label>
            {activeContacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum contato ativo. Cadastre na pagina de Contatos.
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
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
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <CalendarClock className="mr-2 size-4" />
            )}
            Salvar Agendamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
