"use client"

import { useEffect, useMemo, useState } from "react"
import { Clock, Plus, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isValidCronValue, splitCronExpressions } from "@/lib/schedule-cron"

type FrequencyMode = "daily" | "weekly" | "monthly" | "custom"

type TimeSlot = {
  id: string
  hour: number
  minute: number
}

interface CronBuilderProps {
  value: string
  onChange: (value: string) => void
  showActiveToggle?: boolean
  isActive?: boolean
  onActiveChange?: (active: boolean) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const DEFAULT_CRON = "0 8 * * 1-5"
const DEFAULT_WEEK_DAYS = ["1", "2", "3", "4", "5"]

const WEEK_DAYS = [
  { key: "1", label: "Seg" },
  { key: "2", label: "Ter" },
  { key: "3", label: "Qua" },
  { key: "4", label: "Qui" },
  { key: "5", label: "Sex" },
  { key: "6", label: "Sab" },
  { key: "0", label: "Dom" },
]

let nextTimeSlotId = 0

function createTimeSlot(hour = 8, minute = 0): TimeSlot {
  nextTimeSlotId += 1
  return {
    id: `time-slot-${nextTimeSlotId}`,
    hour,
    minute,
  }
}

function normalizeWeekdayKey(value: string) {
  const parsed = Number(value.trim())

  if (!Number.isInteger(parsed)) {
    return null
  }

  if (parsed < 0 || parsed > 7) {
    return null
  }

  return String(parsed === 7 ? 0 : parsed)
}

function expandWeekdayExpression(expression: string) {
  const selected = new Set<string>()

  for (const segment of expression.split(",")) {
    const trimmed = segment.trim()
    if (!trimmed) {
      continue
    }

    const [base, stepText] = trimmed.split("/")
    const step = stepText ? Number(stepText) : 1

    if (!Number.isInteger(step) || step <= 0) {
      return []
    }

    let start = 0
    let end = 6

    if (base !== "*") {
      const [startText, endText] = base.split("-")
      const parsedStart = normalizeWeekdayKey(startText)
      const parsedEnd = typeof endText === "string" ? normalizeWeekdayKey(endText) : parsedStart

      if (!parsedStart || !parsedEnd) {
        return []
      }

      start = Number(parsedStart)
      end = Number(parsedEnd)

      if (end < start) {
        return []
      }
    }

    for (let current = start; current <= end; current += step) {
      selected.add(String(current === 7 ? 0 : current))
    }
  }

  return WEEK_DAYS.map((day) => day.key).filter((key) => selected.has(key))
}

function buildSingleCronFromState(
  mode: FrequencyMode,
  hour: number,
  minute: number,
  selectedWeekDays: string[],
  monthDay: number
) {
  if (mode === "daily") {
    return `${minute} ${hour} * * *`
  }

  if (mode === "weekly") {
    const ordered = WEEK_DAYS.map((day) => day.key).filter((key) =>
      selectedWeekDays.includes(key)
    )
    const dow = ordered.length ? ordered.join(",") : "1"
    return `${minute} ${hour} * * ${dow}`
  }

  if (mode === "monthly") {
    return `${minute} ${hour} ${monthDay} * *`
  }

  return ""
}

function buildCronFromState(
  mode: FrequencyMode,
  timeSlots: TimeSlot[],
  selectedWeekDays: string[],
  monthDay: number
) {
  const expressions = timeSlots
    .map((timeSlot) =>
      buildSingleCronFromState(
        mode,
        timeSlot.hour,
        timeSlot.minute,
        selectedWeekDays,
        monthDay
      )
    )
    .filter(Boolean)

  return expressions.join("\n")
}

function describeSingleCron(cronExpression: string) {
  const parts = cronExpression.trim().split(/\s+/)

  if (parts.length !== 5) {
    return cronExpression
  }

  const [min, hour, dom, , dow] = parts
  const parsedMinute = Number(min)
  const parsedHour = Number(hour)

  if (Number.isNaN(parsedMinute) || Number.isNaN(parsedHour)) {
    return cronExpression
  }

  const time = `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`

  if (dom === "*" && dow === "*") {
    return `Todos os dias às ${time}`
  }

  if (dom === "*" && dow !== "*") {
    const labels = expandWeekdayExpression(dow)
      .map((key) => WEEK_DAYS.find((day) => day.key === key)?.label)
      .filter(Boolean)
      .join(", ")

    return `${labels || "Semanal"} às ${time}`
  }

  if (dom !== "*" && dow === "*") {
    return `Dia ${dom} de cada mes às ${time}`
  }

  return cronExpression
}

type DetectedCronState = {
  mode: FrequencyMode
  timeSlots: TimeSlot[]
  selectedWeekDays: string[]
  monthDay: number
  customCron: string
}

type ParsedCronExpression = {
  mode: Exclude<FrequencyMode, "custom">
  hour: number
  minute: number
  selectedWeekDays: string[]
  monthDay: number
  signature: string
}

function detectMode(value: string): DetectedCronState {
  const expressions = splitCronExpressions(value)

  if (expressions.length === 0) {
    return {
      mode: "weekly",
      timeSlots: [createTimeSlot(8, 0)],
      selectedWeekDays: [...DEFAULT_WEEK_DAYS],
      monthDay: 1,
      customCron: value || DEFAULT_CRON,
    }
  }

  const parsedExpressions = expressions.map((cronExpression): ParsedCronExpression | null => {
    const parts = cronExpression.trim().split(/\s+/)

    if (parts.length !== 5) {
      return null
    }

    const [min, hour, dom, , dow] = parts
    const parsedMinute = Number(min)
    const parsedHour = Number(hour)

    if (Number.isNaN(parsedMinute) || Number.isNaN(parsedHour)) {
      return null
    }

    if (dom === "*" && dow === "*") {
      return {
        mode: "daily" as const,
        hour: parsedHour,
        minute: parsedMinute,
        selectedWeekDays: [...DEFAULT_WEEK_DAYS],
        monthDay: 1,
        signature: "daily",
      }
    }

    if (dom === "*" && dow !== "*") {
      const selectedWeekDays = expandWeekdayExpression(dow)

      if (selectedWeekDays.length === 0) {
        return null
      }

      return {
        mode: "weekly" as const,
        hour: parsedHour,
        minute: parsedMinute,
        selectedWeekDays,
        monthDay: 1,
        signature: `weekly:${selectedWeekDays.join(",")}`,
      }
    }

    if (dom !== "*" && dow === "*") {
      const parsedMonthDay = Number(dom)

      if (!Number.isInteger(parsedMonthDay) || parsedMonthDay < 1 || parsedMonthDay > 31) {
        return null
      }

      return {
        mode: "monthly" as const,
        hour: parsedHour,
        minute: parsedMinute,
        selectedWeekDays: [...DEFAULT_WEEK_DAYS],
        monthDay: parsedMonthDay,
        signature: `monthly:${parsedMonthDay}`,
      }
    }

    return null
  })

  if (parsedExpressions.some((expression) => expression === null)) {
    return {
      mode: "custom",
      timeSlots: [createTimeSlot(8, 0)],
      selectedWeekDays: [...DEFAULT_WEEK_DAYS],
      monthDay: 1,
      customCron: value || DEFAULT_CRON,
    }
  }

  const expressionsList = parsedExpressions.filter(
    (expression): expression is ParsedCronExpression => expression !== null
  )
  const [firstExpression] = expressionsList

  if (
    !firstExpression ||
    expressionsList.some(
      (expression) =>
        expression.mode !== firstExpression.mode ||
        expression.signature !== firstExpression.signature
    )
  ) {
    return {
      mode: "custom",
      timeSlots: [createTimeSlot(8, 0)],
      selectedWeekDays: [...DEFAULT_WEEK_DAYS],
      monthDay: 1,
      customCron: value || DEFAULT_CRON,
    }
  }

  return {
    mode: firstExpression.mode,
    timeSlots: expressionsList.map((expression) =>
      createTimeSlot(expression.hour, expression.minute)
    ),
    selectedWeekDays: [...firstExpression.selectedWeekDays],
    monthDay: firstExpression.monthDay,
    customCron: value || DEFAULT_CRON,
  }
}

export function CronBuilder({
  value,
  onChange,
  showActiveToggle = false,
  isActive = true,
  onActiveChange,
}: CronBuilderProps) {
  const detected = useMemo(() => detectMode(value), [value])
  const previewDescriptions = useMemo(
    () => splitCronExpressions(value).map((expression) => describeSingleCron(expression)),
    [value]
  )

  const [mode, setMode] = useState<FrequencyMode>(detected.mode)
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(detected.timeSlots)
  const [selectedWeekDays, setSelectedWeekDays] = useState<string[]>(
    detected.selectedWeekDays
  )
  const [monthDay, setMonthDay] = useState<number>(detected.monthDay)
  const [customCron, setCustomCron] = useState(detected.customCron)
  const [cronError, setCronError] = useState("")

  useEffect(() => {
    setMode(detected.mode)
    setTimeSlots(detected.timeSlots)
    setSelectedWeekDays(detected.selectedWeekDays)
    setMonthDay(detected.monthDay)
    setCustomCron(detected.customCron)
  }, [detected])

  useEffect(() => {
    if (mode === "custom") {
      return
    }

    onChange(buildCronFromState(mode, timeSlots, selectedWeekDays, monthDay))
  }, [mode, monthDay, onChange, selectedWeekDays, timeSlots])

  function handleModeChange(nextMode: string) {
    const parsedMode = nextMode as FrequencyMode
    setMode(parsedMode)
    setCronError("")

    if (parsedMode === "custom") {
      const fallback = value || DEFAULT_CRON
      setCustomCron(fallback)
      onChange(fallback)
      return
    }

    setTimeSlots([createTimeSlot(8, 0)])

    if (parsedMode === "daily") {
      return
    }

    if (parsedMode === "weekly") {
      setSelectedWeekDays([...DEFAULT_WEEK_DAYS])
      return
    }

    if (parsedMode === "monthly") {
      setMonthDay((current) => (current >= 1 && current <= 31 ? current : 1))
    }
  }

  function toggleWeekDay(dayKey: string) {
    setSelectedWeekDays((prev) => {
      if (prev.includes(dayKey)) {
        const next = prev.filter((item) => item !== dayKey)
        return next.length ? next : [dayKey]
      }

      return [...prev, dayKey]
    })
  }

  function updateTimeSlot(id: string, field: "hour" | "minute", value: number) {
    setTimeSlots((prev) =>
      prev.map((timeSlot) =>
        timeSlot.id === id ? { ...timeSlot, [field]: value } : timeSlot
      )
    )
  }

  function addTimeSlot() {
    setTimeSlots((prev) => {
      const lastTimeSlot = prev[prev.length - 1]

      if (!lastTimeSlot) {
        return [createTimeSlot(8, 0)]
      }

      return [...prev, createTimeSlot(lastTimeSlot.hour, lastTimeSlot.minute)]
    })
  }

  function removeTimeSlot(id: string) {
    setTimeSlots((prev) => {
      if (prev.length <= 1) {
        return prev
      }

      return prev.filter((timeSlot) => timeSlot.id !== id)
    })
  }

  function handleCustomChange(nextValue: string) {
    setCustomCron(nextValue)
    onChange(nextValue)

    if (nextValue.trim() && !isValidCronValue(nextValue)) {
      setCronError("Cada linha da expressao CRON deve ter 5 campos")
      return
    }

    setCronError("")
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <Label className="font-medium">Frequencia</Label>
        </div>

        {showActiveToggle && onActiveChange ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="cron-active" className="text-xs text-muted-foreground">
              Ativa
            </Label>
            <Switch
              id="cron-active"
              checked={isActive}
              onCheckedChange={onActiveChange}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Tipo</Label>
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecionar frequencia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Diario</SelectItem>
            <SelectItem value="weekly">Semanal</SelectItem>
            <SelectItem value="monthly">Mensal</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode !== "custom" ? (
        <>
          {mode === "weekly" ? (
            <div className="flex flex-col gap-2">
              <Label>Dias da semana</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEK_DAYS.map((day) => (
                  <label
                    key={day.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedWeekDays.includes(day.key)}
                      onCheckedChange={() => toggleWeekDay(day.key)}
                    />
                    <span className="text-sm">{day.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {mode === "monthly" ? (
            <div className="flex flex-col gap-2">
              <Label>Dia do mes</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setMonthDay(
                    !Number.isNaN(next) && next >= 1 && next <= 31 ? next : 1
                  )
                }}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Horarios</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={addTimeSlot}
              >
                <Plus className="size-3.5" />
                Adicionar horario
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {timeSlots.map((timeSlot, index) => (
                <div key={timeSlot.id} className="flex items-center gap-2">
                  <Select
                    value={String(timeSlot.hour)}
                    onValueChange={(nextValue) =>
                      updateTimeSlot(timeSlot.id, "hour", Number(nextValue))
                    }
                  >
                    <SelectTrigger className="h-9 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((item) => (
                        <SelectItem key={item} value={String(item)}>
                          {String(item).padStart(2, "0")}h
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <span className="text-muted-foreground">:</span>

                  <Select
                    value={String(timeSlot.minute)}
                    onValueChange={(nextValue) =>
                      updateTimeSlot(timeSlot.id, "minute", Number(nextValue))
                    }
                  >
                    <SelectTrigger className="h-9 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MINUTES.map((item) => (
                        <SelectItem key={item} value={String(item)}>
                          {String(item).padStart(2, "0")}min
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {timeSlots.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => removeTimeSlot(timeSlot.id)}
                      title={`Remover horario ${index + 1}`}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Label>Expressao CRON</Label>
          <Textarea
            value={customCron}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder={"30 15 * * 1,2,3,4,5\n0 8 * * 1-5"}
            className="font-mono text-sm"
            rows={3}
          />
          {cronError ? (
            <p className="text-xs text-destructive">{cronError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Use uma linha por horario. Formato: minuto hora dia-mes mes dia-semana
            </p>
          )}
        </div>
      )}

      {previewDescriptions.length > 0 && !cronError ? (
        <div className="flex flex-wrap gap-2">
          {previewDescriptions.map((description, index) => (
            <Badge key={`${description}-${index}`} variant="outline" className="gap-1.5 text-xs">
              <Clock className="size-3" />
              {description}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
