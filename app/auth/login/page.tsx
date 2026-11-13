"use client"

import { useState } from "react"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Eye, EyeOff, User, Shield, Mail, Lock, AlertCircle } from "lucide-react"
import { BrandMark } from "@/components/branding/brand-mark"
import { BRAND_NAME, BRAND_SUBTITLE } from "@/lib/branding"
import { cn } from "@/lib/utils"
import { markTabSessionActive } from "@/lib/supabase/tab-session"

type LoginType = "client" | "admin"

export default function LoginPage() {
  const [loginType, setLoginType] = useState<LoginType>("client")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const supabase = createClient()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPassword = password.trim()

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      })

      if (error) {
        if (
          error.message.includes("Invalid login credentials") ||
          error.status === 400
        ) {
          throw new Error("E-mail ou senha incorretos")
        }
        throw error
      }

      const userRole =
        data.user?.app_metadata?.role || data.user?.user_metadata?.role || "client"

      if (loginType === "admin" && userRole !== "admin") {
        await supabase.auth.signOut()
        throw new Error("Você não tem permissão de administrador")
      }

      markTabSessionActive()

      window.location.href = loginType === "admin" ? "/admin" : "/"
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao entrar")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-svh">
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/login-bg.png"
          alt=""
          fill
          className="object-cover"
          priority
          quality={75}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-background/40" />
      </div>

      <div className="relative z-10 flex w-full items-center justify-center px-4 sm:justify-start sm:px-8 md:px-16 lg:px-24">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <BrandMark
              imageSize={44}
              textClassName="text-2xl text-foreground"
              subtitleClassName="text-xs text-muted-foreground"
            />
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
            {/* Fio colorido no topo do cartao */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
            />

            {/* Seletor Cliente | Administrador */}
            <div
              className="mb-7 grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-background/60 p-1"
              role="tablist"
              aria-label="Tipo de acesso"
            >
              {(
                [
                  { tipo: "client", rotulo: "Cliente", Icone: User },
                  { tipo: "admin", rotulo: "Administrador", Icone: Shield },
                ] as const
              ).map(({ tipo, rotulo, Icone }) => (
                <button
                  key={tipo}
                  type="button"
                  role="tab"
                  aria-selected={loginType === tipo}
                  onClick={() => {
                    setLoginType(tipo)
                    setError(null)
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                    loginType === tipo
                      ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/40"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <Icone className="size-4" />
                  {rotulo}
                </button>
              ))}
            </div>

            <div className="mb-7">
              <div>
                <h2 className="text-xl font-semibold leading-tight text-foreground">
                  {loginType === "admin" ? "Acesso administrativo" : "Entrar na sua conta"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {loginType === "admin"
                    ? "Gerencie empresas, usuários e configurações"
                    : "Acesse o painel de automação de relatórios"}
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  E-mail
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 bg-background/50 pl-10"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Sua senha"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 bg-background/50 pl-10 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="size-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="mt-1 h-11 w-full text-sm font-medium shadow-lg shadow-primary/20"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Entrando...
                  </>
                ) : loginType === "admin" ? (
                  <>
                    <Shield className="mr-2 size-4" />
                    Entrar como administrador
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3" />
              Conexão segura
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} {BRAND_NAME} · {BRAND_SUBTITLE}
          </p>
        </div>
      </div>
    </div>
  )
}
