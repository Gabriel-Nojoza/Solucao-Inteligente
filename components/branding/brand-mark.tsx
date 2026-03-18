"use client"

import Image from "next/image"
import { BRAND_LOGO_PATH, BRAND_NAME, BRAND_SUBTITLE } from "@/lib/branding"
import { cn } from "@/lib/utils"

interface BrandMarkProps {
  title?: string
  subtitle?: string
  imageSize?: number
  className?: string
  textClassName?: string
  subtitleClassName?: string
}

export function BrandMark({
  title = BRAND_NAME,
  subtitle = BRAND_SUBTITLE,
  imageSize = 44,
  className,
  textClassName,
  subtitleClassName,
}: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Image
        src={BRAND_LOGO_PATH}
        alt={title}
        width={imageSize}
        height={imageSize}
        className="shrink-0 object-contain"
        priority
      />
      <div className="flex min-w-0 flex-col gap-0.5 leading-none">
        <span className={cn("truncate font-semibold tracking-tight", textClassName)}>
          {title}
        </span>
        <span className={cn("text-xs text-muted-foreground", subtitleClassName)}>
          {subtitle}
        </span>
      </div>
    </div>
  )
}
