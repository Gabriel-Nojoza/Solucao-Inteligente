"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Clock } from "lucide-react"

type PresetKey =
  | "daily"
  | "weekdays"
  | "mondays"
  | "first_of_month"
  | "custom"

interface PresetDef {
  key: PresetKey
  label: string
  buildCron: (hour: number, minute: number) => string
  defaultHour: number
  defaultMinute: number
}

const PRESETS: PresetDef[] = [
  {
    key: "daily",
    label: "Diario",
    buildCron: (h, m) => `${m} ${h} * * *`,
    defaultHour: 8,
    defaultMinute: 0,
  },
  {
    key: "weekdays",
    label: "Seg-Sex",
    buildCron: (h, m) => `${m} ${h} * * 1-5`,
    defaultHour: 8,
    defaultMinute: 0,
  },
  {
    key: "mondays",
    label: "Segundas",
    buildCron: (h, m) => `${m} ${h} * * 1`,
    defaultHour: 9,
    defaultMinute: 0,
  },
  {
    key: "first_of_month",
    label: "Primeiro dia do mes",
    buildCron: (h, m) => `${m} ${h} 1 * *`,
    defaultHour: 8,
    defaultMinute: 0,
  },
  {
    key: "custom",
    label: "Personalizado",
    buildCron: () => "",
    defaultHour: 8,
    defaultMinute: 0,
  },
]

function detectPreset(cron: string): {
  preset: PresetKey
  hour: number
  minute: number
} {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { preset: "custom", hour: 8, minute: 0 }

  const [min, hour, dom, , dow] = parts
  const h = parseInt(hour, 10)
  const m = parseInt(min, 10)

  if (isNaN(h) || isNaN(m)) return { preset: "custom", hour: 8, minute: 0 }

  if (dom === "*" && dow === "*") return { preset: "daily", hour: h, minute: m }
  if (dom === "*" && dow === "1-5")
    return { preset: "weekdays", hour: h, minute: m }
  if (dom === "*" && dow === "1")
    return { preset: "mondays", hour: h, minute: m }
  if (dom === "1" && dow === "*")
    return { preset: "first_of_month", hour: h, minute: m }

  return { preset: "custom", hour: h, minute: m }
}

function describeCron(cron: string): string {
  const parts = cron.split(" ")
  if (parts.length !== 5) return cron

  const [min, hour, dom, , dow] = parts

  let desc = `As ${hour}:${min.padStart(2, "0")}`

  if (dom !== "*") {
    desc += `, dia ${dom} de cada mes`
  } else if (dow === "1-5") {
    desc += ", segunda a sexta"
  } else if (dow === "1") {
    desc += ", toda segunda"
  } else if (dow === "0") {
    desc += ", todo domingo"
  } else if (dow === "*") {
    desc += ", todos os dias"
  } else {
    desc += `, dias da semana: ${dow}`
  }

  return desc
}

function formatPresetLabel(preset: PresetDef, hour: number, minute: number): string {
  if (preset.key === "custom") return "Personalizado"
  const time = `${hour}h${minute > 0 ? String(minute).padStart(2, "0") : ""}`
  return `${preset.label} as ${time}`
}

interface CronBuilderProps {
  value: string
  onChange: (value: string) => void
  showActiveToggle?: boolean
  isActive?: boolean
  onActiveChange?: (active: boolean) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

export function CronBuilder({
  value,
  onChange,
  showActiveToggle = false,
  isActive = true,
  onActiveChange,
}: CronBuilderProps) {
  const detected = detectPreset(value)
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>(
    detected.preset
  )
  const [hour, setHour] = useState(detected.hour)
  const [minute, setMinute] = useState(detected.minute)
  const [customCron, setCustomCron] = useState(
    detected.preset === "custom" ? value : ""
  )
  const [cronError, setCronError] = useState("")

  const buildAndEmit = useCallback(
    (preset: PresetKey, h: number, m: number) => {
      const def = PRESETS.find((p) => p.key === preset)
      if (!def || preset === "custom") return
      const newCron = def.buildCron(h, m)
      onChange(newCron)
    },
    [onChange]
  )

  // Re-sync when value changes externally
  useEffect(() => {
    const d = detectPreset(value)
    setSelectedPreset(d.preset)
    setHour(d.hour)
    setMinute(d.minute)
    if (d.preset === "custom") {
      setCustomCron(value)
    }
  }, [value])

  function handlePresetChange(key: string) {
    const preset = key as PresetKey
    setSelectedPreset(preset)
    setCronError("")

    if (preset === "custom") {
      setCustomCron(value || "0 8 * * *")
      onChange(value || "0 8 * * *")
      return
    }

    const def = PRESETS.find((p) => p.key === preset)!
    const h = def.defaultHour
    const m = def.defaultMinute
    setHour(h)
    setMinute(m)
    buildAndEmit(preset, h, m)
  }

  function handleHourChange(v: string) {
    const h = parseInt(v, 10)
    setHour(h)
    buildAndEmit(selectedPreset, h, minute)
  }

  function handleMinuteChange(v: string) {
    const m = parseInt(v, 10)
    setMinute(m)
    buildAndEmit(selectedPreset, hour, m)
  }

  function handleCustomChange(v: string) {
    setCustomCron(v)
    onChange(v)
    const parts = v.trim().split(/\s+/)
    if (parts.length !== 5 && v.trim() !== "") {
      setCronError("A expressao CRON deve ter 5 campos")
    } else {
      setCronError("")
    }
  }

  const currentPreset = PRESETS.find((p) => p.key === selectedPreset)
  const displayLabel = currentPreset
    ? formatPresetLabel(currentPreset, hour, minute)
    : ""

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <Label className="font-medium">Frequencia</Label>
        </div>
        {showActiveToggle && onActiveChange && (
          <div className="flex items-center gap-2">
            <Label
              htmlFor="cron-active"
              className="text-xs text-muted-foreground"
            >
              Ativa
            </Label>
            <Switch
              id="cron-active"
              checked={isActive}
              onCheckedChange={onActiveChange}
            />
          </div>
        )}
      </div>

      {/* Preset selector */}
      <Select value={selectedPreset} onValueChange={handlePresetChange}>
        <SelectTrigger>
          <SelectValue>{displayLabel || "Selecionar frequencia"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.key} value={p.key}>
              {p.key === "custom"
                ? p.label
                : formatPresetLabel(p, p.defaultHour, p.defaultMinute)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Time picker (for non-custom presets) */}
      {selectedPreset !== "custom" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Horario:</Label>
          <Select value={String(hour)} onValueChange={handleHourChange}>
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, "0")}h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select value={String(minute)} onValueChange={handleMinuteChange}>
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {String(m).padStart(2, "0")}min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Custom CRON input */}
      {selectedPreset === "custom" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">
            Expressao CRON
          </Label>
          <Input
            value={customCron}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="0 8 * * 1-5"
            className="font-mono text-sm"
          />
          {cronError ? (
            <p className="text-xs text-destructive">{cronError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Formato: minuto hora dia-mes mes dia-semana
            </p>
          )}
        </div>
      )}

      {/* Description badge */}
      {value && !cronError && value.split(" ").length === 5 && (
        <Badge variant="outline" className="w-fit gap-1.5 text-xs">
          <Clock className="size-3" />
          {describeCron(value)}
        </Badge>
      )}
    </div>
  )
}
