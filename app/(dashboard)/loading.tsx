import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-4 py-4 sm:px-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
        <Skeleton className="h-[520px] rounded-xl" />
      </div>
    </div>
  )
}
