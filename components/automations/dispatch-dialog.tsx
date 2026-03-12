"use client"

import { useState } from "react"
import { Send, Loader2 } from "lucide-react"
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
import { toast } from "sonner"
import type { Contact } from "@/lib/types"

interface DispatchDialogProps {
  contacts: Contact[]
  daxQuery: string
  datasetId: string
  executionDatasetId?: string
  disabled?: boolean
}

export function DispatchDialog({
  contacts,
  daxQuery,
  datasetId,
  executionDatasetId,
  disabled,
}: DispatchDialogProps) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [exportFormat, setExportFormat] = useState("csv")
  const [message, setMessage] = useState("Segue os dados solicitados em anexo.")
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const activeContacts = contacts.filter((c) => c.is_active)

  const handleDispatch = async () => {
    if (selectedContacts.length === 0) {
      toast.error("Selecione ao menos 1 contato")
      return
    }
    setSending(true)
    try {
      const res = await fetch("/api/automations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetId,
          execution_dataset_id: executionDatasetId || datasetId,
          dax_query: daxQuery,
          export_format: exportFormat,
          message,
          contact_ids: selectedContacts,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Disparo enviado com sucesso!")
      setOpen(false)
      setSelectedContacts([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro no disparo")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={disabled}
        >
          <Send className="size-3" />
          <span className="hidden sm:inline">Disparar Agora</span>
          <span className="sm:hidden">Disparar</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disparo Imediato</DialogTitle>
          <DialogDescription>
            Envie os resultados desta query agora para os contatos selecionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Contatos ({selectedContacts.length} selecionado(s))</Label>
            {activeContacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum contato ativo cadastrado. Adicione na pagina de Contatos.
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
          <Button
            onClick={handleDispatch}
            disabled={sending || selectedContacts.length === 0}
          >
            {sending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            Enviar Agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
