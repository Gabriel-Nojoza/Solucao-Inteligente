import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

interface PageHeaderProps {
  title: string
  description?: string
  children?: React.ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
      <SidebarTrigger className="-ml-2" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-none tracking-tight sm:text-lg text-balance">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              {description}
            </p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-2">{children}</div>
        )}
      </div>
    </header>
  )
}
