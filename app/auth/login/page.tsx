"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Zap, Loader2, Eye, EyeOff, User, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

type LoginType = "client" | "admin"

export default function LoginPage() {
  const [loginType, setLoginType] = useState<LoginType>("client")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

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
          throw new Error("Email ou senha incorretos")
        }
        throw error
      }

      const userRole =
        data.user?.app_metadata?.role || data.user?.user_metadata?.role || "client"

      if (loginType === "admin" && userRole !== "admin") {
        await supabase.auth.signOut()
        throw new Error("Voce nao tem permissao de administrador")
      }

      if (loginType === "admin") {
        router.push("/admin")
      } else {
        router.push("/")
      }

      router.refresh()
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
          <div className="mb-10 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
              <Zap className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                DashPro
              </h1>
              <p className="text-xs text-muted-foreground">Power BI Automation</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-6 flex gap-2">
              <button
                type="button"
                onClick={() => setLoginType("client")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all",
                  loginType === "client"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                <User className="size-4" />
                Cliente
              </button>
              <button
                type="button"
                onClick={() => setLoginType("admin")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all",
                  loginType === "admin"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                <Shield className="size-4" />
                Admin
              </button>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-semibold text-foreground">
                {loginType === "admin" ? "Acesso Administrativo" : "Entrar na sua conta"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {loginType === "admin"
                  ? "Gerencie usuarios e configuracoes do sistema"
                  : "Acesse o painel de automacao de relatorios"}
              </p>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-background/50"
                  autoComplete="email"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Sua senha"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 bg-background/50 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="h-11 w-full text-sm font-medium"
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
                    Entrar como Admin
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground/60">
            DashPro - Automacao de Relatorios Power BI
          </p>
        </div>
      </div>
    </div>
  )
}
