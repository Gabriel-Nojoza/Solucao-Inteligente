# Bot do Telegram — perguntas e reenvio de falhas

Fluxo n8n que deixa o administrador **conversar** com a plataforma pelo Telegram:

- "resumo do dia" / "como foram os envios hoje"
- "quantos erros teve na JA hoje"
- "quais relatorios nao foram enviados"
- "reenviar os relatorios da JA que deram erro"

O fluxo do **resumo diario** (Schedule 14h/18h -> `/api/admin/logs/summary` -> Code ->
Gemini -> Telegram) continua como esta. Este aqui e um fluxo **novo e separado**.

---

## 1. Endpoints usados (ja existem no app)

Todos autenticados pelo secret da plataforma: `?secret=<PLATFORM_SCHEDULER_SECRET>`
(hoje `solucao-inteligente-1`) — ou header `x-callback-secret`.

Base: `https://appsolucaointeligente.com.br`

### a) Resumo do dia

```
GET /api/admin/logs/summary?secret=solucao-inteligente-1
GET /api/admin/logs/summary?secret=solucao-inteligente-1&date=2026-08-26
```

Resposta (resumida):

```json
{
  "date": "2026-08-26",
  "total": 120, "delivered": 110, "failed": 8, "in_progress": 2,
  "success_rate": 92,
  "by_company": [{ "name": "JA - ...", "total": 20, "delivered": 15, "failed": 5 }],
  "top_errors": [{ "message": "Timeout ao capturar PDF", "count": 4 }]
}
```

### b) Relatorios que falharam (por empresa / por relatorio)

```
GET /api/admin/logs/failed?secret=solucao-inteligente-1
GET /api/admin/logs/failed?secret=solucao-inteligente-1&company=JA
GET /api/admin/logs/failed?secret=solucao-inteligente-1&company=JA&hours=24
GET /api/admin/logs/failed?secret=solucao-inteligente-1&company=JA&date=2026-08-26
```

- `company` — trecho do nome, sem acento/caixa. Aceita inclusive iniciais
  ("JA" casa "Jardim Alvorada"). Se casar com varias, retorna HTTP 409 com
  `candidates`. Se nao casar, HTTP 404.
- Sem `hours` nem `date` => dia de hoje (UTC).

Resposta:

```json
{
  "window": "2026-08-26",
  "company": { "id": "uuid", "name": "JA - Jardim Alvorada" },
  "total_failed": 5,
  "by_company": [
    {
      "company_id": "uuid",
      "company_name": "JA - Jardim Alvorada",
      "failed": 5,
      "reports": [
        {
          "schedule_id": "uuid",
          "report_name": "Vendas Diario",
          "count": 3,
          "sample_error": "Timeout ao capturar PDF",
          "contacts": ["Grupo Diretoria", "Fulano"]
        }
      ]
    }
  ]
}
```

### c) Reenviar as rotinas que falharam nas ultimas 24h

```
POST /api/admin/resend-failed
Content-Type: application/json

{ "company": "JA", "secret": "solucao-inteligente-1" }
```

(pode mandar o secret no corpo, na query `?secret=`, ou no header `x-callback-secret`.
Tambem aceita `"company_id": "<uuid>"` no lugar de `"company"`.)

Resposta:

```json
{ "started": true, "company_name": "JA - Jardim Alvorada",
  "total": 3, "interval_minutes": 3, "estimated_minutes": 9 }
```

Reenvia **uma rotina a cada 3 min** em segundo plano (nao trava a resposta).
`started: false, total: 0` quando nao havia nada falhado.
Ambiguidade/nao encontrado: mesmos 409/404 do item (b).

---

## 2. Montagem do fluxo no n8n

```
Telegram Trigger  ->  AI Agent  ->  Telegram: Send a text message
                        |
             Google Gemini Chat Model (Model)
                        |
        +---------------+---------------+
        |               |               |
   HTTP Tool:       HTTP Tool:      HTTP Tool:
   resumo_do_dia    relatorios_     reenviar_erros
                    com_erro
```

### 2.1 Telegram Trigger
- Updates: `message`
- Restrinja ao seu chat: no AI Agent ou num nó IF, checar
  `{{ $json.message.chat.id }} == 8904426645`.

### 2.2 AI Agent (Tools Agent)
- Chat Model: **Google Gemini Chat Model** (o mesmo já usado no outro fluxo).
- User message: `={{ $json.message.text }}`
- System message: ver secao 3.
- Ferramentas: 3 nós **HTTP Request Tool** abaixo.

### 2.3 HTTP Request Tool — `resumo_do_dia`
- Description (pro modelo): `Resumo dos disparos do dia: total, entregues, falhas, taxa de sucesso, por empresa e erros mais comuns. Use quando pedirem "resumo", "como foram os envios", visao geral do dia.`
- Method: GET
- URL: `https://appsolucaointeligente.com.br/api/admin/logs/summary`
- Query params:
  - `secret` = `solucao-inteligente-1`
  - `date` = (opcional) deixe o modelo preencher no formato `YYYY-MM-DD` quando o usuario citar uma data; senao vazio.

### 2.4 HTTP Request Tool — `relatorios_com_erro`
- Description: `Lista os relatorios/rotinas que FALHARAM, agrupados por empresa. Use para "quantos erros teve na <empresa>", "quais relatorios nao foram enviados", detalhe de falhas. Parametro company = nome ou iniciais da empresa.`
- Method: GET
- URL: `https://appsolucaointeligente.com.br/api/admin/logs/failed`
- Query params:
  - `secret` = `solucao-inteligente-1`
  - `company` = {{ deixe o modelo preencher, opcional }}
  - `hours` = {{ opcional, ex.: 24 }}
  - `date` = {{ opcional, YYYY-MM-DD }}

### 2.5 HTTP Request Tool — `reenviar_erros`
- Description: `Reenvia TODAS as rotinas que falharam nas ultimas 24h de uma empresa. Acao destrutiva/custosa: só chame apos o usuario confirmar explicitamente. Parametro company obrigatorio.`
- Method: POST
- URL: `https://appsolucaointeligente.com.br/api/admin/resend-failed`
- Send Body: JSON
  - `company` = {{ modelo preenche }}
  - `secret` = `solucao-inteligente-1`

### 2.6 Telegram — Send a text message
- Chat ID: `={{ $('Telegram Trigger').item.json.message.chat.id }}`
- Text: `={{ $json.output }}`
- **Sem** parse mode (ou Markdown Legacy) para nao dar "can't parse entities".

---

## 3. System message do AI Agent

```
Voce e o assistente operacional da plataforma Solucao Inteligente, que envia
relatorios Power BI por WhatsApp de forma automatica. Voce responde o
administrador pelo Telegram, em portugues, de forma curta e direta, com emojis
para leitura rapida.

Ferramentas:
- resumo_do_dia: visao geral dos disparos (use para "resumo", "como foi o dia").
- relatorios_com_erro: detalhe das falhas por empresa (use para "quantos erros
  teve na X", "quais relatorios nao foram enviados"). O parametro company aceita
  nome parcial ou iniciais (ex.: "JA").
- reenviar_erros: reenvia as rotinas que falharam nas ultimas 24h de uma empresa.

Regras:
1. Sempre use uma ferramenta para responder — nunca invente numeros.
2. Para contar erros de uma empresa, chame relatorios_com_erro com company.
3. reenviar_erros e acao custosa (gera relatorios de novo, 1 a cada 3 min).
   NUNCA chame sem o usuario ter confirmado. Se ele disser "reenviar os
   relatorios da JA que deram erro", primeiro mostre o que vai ser reenviado
   (relatorios_com_erro) e pergunte "Confirma o reenvio de N rotina(s) da
   <empresa>?". Só chame reenviar_erros depois de um "sim"/"confirmo".
4. Se a ferramenta retornar erro "ambiguous_company", liste os candidates e
   peca pro usuario escolher. Se "company_not_found", diga que nao achou a
   empresa.
5. Ao terminar um reenvio, informe quantas rotinas entraram na fila e a
   estimativa em minutos (estimated_minutes).
```

---

## 4. Por que os envios de PDF nao apareciam

Quando a rotina e **PDF sem narracao**, o `/api/dispatch` gera e envia o PDF
direto (via Chrome), **sem passar pelo n8n** — entao a "notificacao de sucesso"
do fluxo n8n nunca cobria esses envios, e a captura demorada ainda estourava o
timeout da chamada HTTP.

Agora o proprio `/api/dispatch`, ao terminar o envio direto de PDF, manda a
notificacao pro Telegram (mesmo bot dos alertas: `TELEGRAM_ALERT_BOT_TOKEN` /
`TELEGRAM_ALERT_CHAT_ID`). **Essas duas variaveis precisam estar no ambiente do
app Next** (nao so no serviço do bot). Sem elas, a notificacao de PDF e
silenciosamente ignorada.
