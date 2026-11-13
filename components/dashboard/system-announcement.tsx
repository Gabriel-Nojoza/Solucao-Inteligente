"use client"

// Aviso programado no topo do sistema (area do cliente). Aparece so dentro da janela de
// horario abaixo e some de vez para quem clicar em "Nao mostrar novamente" (fica guardado
// no navegador). Para um aviso novo: troque o id (senao quem dispensou o antigo nao ve),
// as datas e o texto.
import { useEffect, useState } from "react"
import { Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"

const AVISO = {
  id: "atualizacao-2026-11-13",
  // Horario de Brasilia (-03:00)
  inicio: "2026-11-13T00:00:00-03:00",
  fim: "2026-11-13T18:30:00-03:00",
  titulo: "Atualizamos o sistema para a versão 2.0",
  texto:
    "Deixamos a plataforma mais simples de usar: o cadastro de rotinas agora é dividido em abas, a lista de contatos ficou organizada em páginas e o menu e o login ganharam um visual novo.",
}

const CHAVE = `aviso-dispensado:${AVISO.id}`

function dentroDoHorario(agora = Date.now()) {
  return agora >= new Date(AVISO.inicio).getTime() && agora < new Date(AVISO.fim).getTime()
}

// variante "login": mesmo aviso, sem margens, para ficar acima do formulario de login
export function SystemAnnouncement({ variante = "painel" }: { variante?: "painel" | "login" } = {}) {
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    let dispensado = false
    try {
      dispensado = window.localStorage.getItem(CHAVE) === "1"
    } catch {
      // navegador sem localStorage: mostra normalmente
    }
    setVisivel(!dispensado && dentroDoHorario())

    // Some sozinho quando passar do horario final, mesmo com a pagina aberta
    const timer = window.setInterval(() => {
      if (!dentroDoHorario()) setVisivel(false)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!visivel) return null

  const naoMostrarMais = () => {
    try {
      window.localStorage.setItem(CHAVE, "1")
    } catch {
      // se nao der para guardar, so esconde nesta visita
    }
    setVisivel(false)
  }

  return (
    <div
      role="status"
      data-testid="aviso-do-sistema"
      className={
        variante === "login"
          ? "mb-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 backdrop-blur-xl"
          : "mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:mx-6 sm:flex-row sm:items-center"
      }
    >
      <Sparkles className="hidden size-5 shrink-0 text-primary sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{AVISO.titulo}</p>
        <p className="text-sm text-muted-foreground">{AVISO.texto}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" className="h-8" onClick={naoMostrarMais}>
          Não mostrar novamente
        </Button>
        <button
          type="button"
          onClick={() => setVisivel(false)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Fechar por agora"
          title="Fechar por agora"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
