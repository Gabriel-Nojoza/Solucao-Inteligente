#!/usr/bin/env bash
#
# Watchdog de captura — roda na VPS via cron (NAO faz parte do app Next).
#
# Mata Chrome/Chromium e workers de captura que ficaram presos (orfaos). O
# processo pai (lib/report-pdf.ts) ja mata a arvore em timeout/close via
# killProcessTree; isto aqui e so a rede de seguranca para o caso raro em que
# um renderer re-parenta pro PID 1 e escapa.
#
# Premissa: depois que o conteiner `waha` foi removido, nenhum navegador
# legitimo roda mais que ~3 min nesta maquina. Todo chromium vivo ha mais de
# MAX_AGE segundos e captura de relatorio travada.
#
# Instalar:
#   cp scripts/watchdog-chrome.sh /root/watchdog-chrome.sh
#   chmod +x /root/watchdog-chrome.sh
#   ( crontab -l 2>/dev/null; echo '*/5 * * * * /root/watchdog-chrome.sh' ) | crontab -
#
set -uo pipefail

MAX_AGE=480   # segundos (8 min). Uma captura normal nao passa de ~3 min.
LOG="/var/log/watchdog-chrome.log"

# Acha o env do app (usa TELEGRAM_ALERT_* pra notificar). .env.local tem
# prioridade — e onde o token de fato mora. Ajuste/force com WATCHDOG_ENV_FILE.
ENV_FILE=""
for f in \
  "${WATCHDOG_ENV_FILE:-}" \
  /root/Solucao-Inteligente/Solucoes-Inteligente/.env.local \
  /root/Solucao-Inteligente/Solucoes-Inteligente/.env \
  /root/Solucao-Inteligente/.env.local \
  /root/Solucao-Inteligente/.env ; do
  [ -n "$f" ] && [ -f "$f" ] && ENV_FILE="$f" && break
done
LOAD_MULT=4   # alerta se load1 > nproc * LOAD_MULT

ts() { date '+%F %T'; }

TG_TOKEN=""; TG_CHAT=""
if [ -n "$ENV_FILE" ]; then
  TG_TOKEN=$(sed -n 's/^TELEGRAM_ALERT_BOT_TOKEN=//p' "$ENV_FILE" | tr -d "\"' \r")
  TG_CHAT=$(sed -n 's/^TELEGRAM_ALERT_CHAT_ID=//p' "$ENV_FILE" | tr -d "\"' \r")
fi

notify() {
  [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] || return 0
  curl -s -m 10 -o /dev/null "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=$1" || true
}

killed=0
detail=""

# chromium/chrome + workers node de captura
pids=$( { pgrep -x chrome; pgrep -x chromium; pgrep -f 'chrome-capture[^ ]*\.js'; } 2>/dev/null | sort -un )

for pid in $pids; do
  age=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -z "$age" ] && continue
  [[ "$age" =~ ^[0-9]+$ ]] || continue
  [ "$age" -gt "$MAX_AGE" ] || continue

  cmd=$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-70)
  pkill -9 -P "$pid" 2>/dev/null || true
  kill -9 "$pid" 2>/dev/null || true
  killed=$((killed + 1))
  detail="${detail}"$'\n'"- pid ${pid} (${age}s): ${cmd}"
  echo "$(ts) KILL pid=$pid age=${age}s $cmd" >> "$LOG"
done

if [ "$killed" -gt 0 ]; then
  notify "$(printf '🧹 Watchdog VPS: matei %d processo(s) de captura preso(s).%s' "$killed" "$detail")"
fi

# Alerta de load sustentado alto (sinal de rajada travando a captura)
load1=$(cut -d' ' -f1 /proc/loadavg)
ncpu=$(nproc)
if awk -v l="$load1" -v n="$ncpu" -v m="$LOAD_MULT" 'BEGIN { exit !(l > n * m) }'; then
  echo "$(ts) WARN load1=$load1 ncpu=$ncpu" >> "$LOG"
  notify "⚠️ Watchdog VPS: load em ${load1} (${ncpu} vCPU) — captura pode estar travando."
fi

exit 0
