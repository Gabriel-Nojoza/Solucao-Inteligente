const TELEGRAM_API = "https://api.telegram.org"

/**
 * Envia uma mensagem para o chat de alertas da plataforma no Telegram.
 *
 * Usa o mesmo par de variaveis do serviço do bot
 * (services/whatsapp-bot/bot.js -> notifyTelegramAlert):
 *   - TELEGRAM_ALERT_BOT_TOKEN
 *   - TELEGRAM_ALERT_CHAT_ID
 *
 * No-op silencioso quando nao configuradas. Fire-and-forget: nunca lança,
 * apenas registra no console. Texto puro (sem parse_mode) para nunca falhar
 * por causa de caracteres especiais em nomes de relatorio / mensagens de erro.
 */
export async function sendTelegramNotification(text: string): Promise<void> {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim()
  if (!token || !chatId) return

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error("[telegram-notify] falha ao enviar", res.status, body.slice(0, 200))
    }
  } catch (err) {
    console.error(
      "[telegram-notify] erro ao enviar",
      err instanceof Error ? err.message : err
    )
  }
}
