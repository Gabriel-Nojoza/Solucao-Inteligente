import { Shield, User } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export type CurrentUserSummaryData = {
  email?: string | null
  name?: string | null
  role?: string | null
}

function getDisplayName(user: CurrentUserSummaryData) {
  const normalizedName = typeof user.name === "string" ? user.name.trim() : ""
  if (normalizedName) {
    return normalizedName
  }

  const normalizedEmail = typeof user.email === "string" ? user.email.trim() : ""
  if (!normalizedEmail) {
    return "Usuario"
  }

  return normalizedEmail.split("@")[0] || normalizedEmail
}

function getInitials(user: CurrentUserSummaryData) {
  const displayName = getDisplayName(user)
  const words = displayName.split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return "US"
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase()
}

type CurrentUserSummaryProps = {
  className?: string
  user: CurrentUserSummaryData | null
}

export function CurrentUserSummary({
  className,
  user,
}: CurrentUserSummaryProps) {
  if (!user) {
    return null
  }

  const displayName = getDisplayName(user)

  return (
    <div
      className={cn(
        "rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-3",
        "group-data-[collapsible=icon]:p-2",
        className
      )}
      title={displayName}
    >
      <div className="flex items-center gap-3">
        <Avatar className="size-9 border border-sidebar-border/60">
          <AvatarFallback className="bg-sidebar-primary/10 text-sidebar-foreground text-xs font-semibold">
            {getInitials(user)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2">
            {user.role === "admin" ? (
              <Shield className="size-3.5 shrink-0 text-amber-500" />
            ) : (
              <User className="size-3.5 shrink-0 text-primary" />
            )}
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {displayName}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
