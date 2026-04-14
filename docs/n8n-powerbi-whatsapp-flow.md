# Fluxo N8N para Power BI -> WhatsApp

Este projeto ja envia ao N8N os dados necessarios para disparar um relatorio Power BI.
O N8N recebe:

- `report_name`
- `report_id`
- `app_report_id`
- `workspace_id`
- `pbi_page_name`
- `pbi_page_names`
- `report_export_url`
- `report_export_headers`
- `report_export_payload`
- `export_format`
- `contacts`
- `message`
- `dispatch_log_ids`
- `dispatch_targets`
- `callback_url`
- `bot_send_url`
- `callback_secret`

O `callback_url` aponta para o endpoint que atualiza os logs no app:

- `POST /api/webhook/n8n-callback`

## Pre-requisitos

1. O bot precisa estar conectado na tela `Contatos`.
2. O `callback_secret` precisa estar configurado em `Configuracoes > N8N`.
3. O N8N precisa enviar o header `x-callback-secret` ao chamar endpoints do app.

## Endpoint novo para o N8N enviar pelo bot

O app agora expõe:

- `POST /api/bot/send`

Esse endpoint aceita autenticacao por `x-callback-secret`, repassa a mensagem para o bot local e, quando receber `dispatch_log_id`, ja atualiza o log de envio.

Payload aceito:

```json
{
  "phone": "+5511999999999",
  "whatsapp_group_id": null,
  "jid": null,
  "message": "Segue o relatorio em anexo.",
  "document_base64": "JVBERi0xLjQKJ....",
  "document_url": null,
  "file_name": "relatorio.pdf",
  "mimetype": "application/pdf"
}
```

Regras:

- Para grupo, envie `whatsapp_group_id`.
- Para individual, envie `phone`.
- `jid` e opcional.
- Se houver `document_base64` ou `document_url`, o bot envia como documento.
- Se houver apenas `message` ou `text`, o bot envia mensagem de texto.

## Fluxo sugerido no N8N

### 1. Webhook

Recebe o payload do app.

Exemplo:

```json
{
  "schedule_id": "rotina-123",
  "schedule_name": "Vendas diario",
  "cron_expression": "0 8 * * 1-5",
  "is_active": true,
  "report_name": "Relatorio 01",
  "app_report_id": "relatorio-app-123",
  "report_id": "xxxxxxxx",
  "workspace_id": "yyyyyyyy",
  "pbi_page_name": "ReportSectionResumoEquipe",
  "pbi_page_names": [
    "ReportSectionResumoEquipe",
    "ReportSectionMetaEquipe"
  ],
  "export_format": "PDF",
  "report_export_url": "https://seu-app.com/api/reports/export",
  "report_export_headers": {
    "x-callback-secret": "seu-segredo"
  },
  "report_export_payload": {
    "report_id": "relatorio-app-123",
    "format": "PDF",
    "pbi_page_name": "ReportSectionResumoEquipe",
    "pbi_page_names": [
      "ReportSectionResumoEquipe",
      "ReportSectionMetaEquipe"
    ],
    "callback_secret": "seu-segredo"
  },
  "contacts": [
    {
      "name": "Grupo Vendas",
      "type": "group",
      "whatsapp_group_id": "1203634...@g.us"
    },
    {
      "name": "Joao",
      "type": "individual",
      "phone": "+5511999999999"
    }
  ],
  "message": "Segue o relatorio em anexo.",
  "dispatch_log_ids": ["log-1", "log-2"],
  "dispatch_targets": [
    {
      "dispatch_log_id": "log-1",
      "name": "Grupo Vendas",
      "type": "group",
      "whatsapp_group_id": "1203634...@g.us"
    },
    {
      "dispatch_log_id": "log-2",
      "name": "Joao",
      "type": "individual",
      "phone": "+5511999999999"
    }
  ],
  "callback_url": "https://seu-app.com/api/webhook/n8n-callback",
  "bot_send_url": "https://seu-app.com/api/bot/send",
  "callback_secret": "seu-segredo"
}
```

Os campos `schedule_id`, `schedule_name`, `cron_expression` e `is_active` identificam a rotina que disparou o webhook e podem ser usados no n8n para log, roteamento ou auditoria.

### 2. IF de teste

Se vier `test = true`, responda `200 OK` e finalize.

### 3. Iniciar exportacao do relatorio

Use `HTTP Request`:

- Metodo: `POST`
- URL:

```text
={{ $('Webhook').item.json.report_export_url }}
```

- Header:

```text
x-callback-secret: ={{ $('Webhook').item.json.callback_secret }}
Content-Type: application/json
```

- Body JSON:

```json
{
  "report_id": "={{ $('Webhook').item.json.report_export_payload.report_id }}",
  "format": "={{ $('Webhook').item.json.report_export_payload.format }}",
  "pbi_page_name": "={{ $('Webhook').item.json.report_export_payload.pbi_page_name }}",
  "pbi_page_names": "={{ $('Webhook').item.json.report_export_payload.pbi_page_names }}",
  "callback_secret": "={{ $('Webhook').item.json.callback_secret }}"
}
```

Se `pbi_page_names` vier com varios itens, o app gera um unico PDF com todas as paginas selecionadas no campo `Paginas do Relatorio`.
Se vier apenas `pbi_page_name`, o app exporta somente aquela pagina.

### 4. Receber o arquivo exportado

Ative `Download` para o arquivo vir em binario. O endpoint do app ja cuida do processo de exportacao e retorna o arquivo final.

### 5. Converter binario para base64

Use `Move Binary Data`:

- Modo: `Binary to JSON`
- Campo binario: `data`
- Campo JSON destino: `document_base64`

### 6. Separar contatos

Use `Split Out` em `dispatch_targets`.

Depois monte o payload do bot com um `Set` ou `Code`:

```json
{
  "phone": "={{ $json.dispatch_targets.type === 'individual' ? $json.dispatch_targets.phone : null }}",
  "whatsapp_group_id": "={{ $json.dispatch_targets.type === 'group' ? $json.dispatch_targets.whatsapp_group_id : null }}",
  "message": "={{ $('Webhook').item.json.message }}",
  "document_base64": "={{ $('Move Binary Data').item.json.document_base64 }}",
  "file_name": "={{ $('Webhook').item.json.report_name + '.pdf' }}",
  "mimetype": "application/pdf",
  "dispatch_log_id": "={{ $json.dispatch_targets.dispatch_log_id }}",
  "n8n_execution_id": "={{ $execution.id }}"
}
```

## 7. Enviar pelo bot do app

Use `HTTP Request`:

- Metodo: `POST`
- URL:

```text
={{ $('Webhook').item.json.bot_send_url }}
```

- Header:

```text
x-callback-secret: ={{ $('Webhook').item.json.callback_secret }}
Content-Type: application/json
```

- Body JSON:

```json
{
  "phone": "={{ $json.phone }}",
  "whatsapp_group_id": "={{ $json.whatsapp_group_id }}",
  "message": "={{ $json.message }}",
  "document_base64": "={{ $json.document_base64 }}",
  "file_name": "={{ $json.file_name }}",
  "mimetype": "={{ $json.mimetype }}",
  "dispatch_log_id": "={{ $json.dispatch_log_id }}",
  "n8n_execution_id": "={{ $json.n8n_execution_id }}"
}
```

Observacao: com `dispatch_log_id`, o proprio `/api/bot/send` ja marca o log como `delivered` ou `failed`. O callback abaixo continua util para falhas antes do envio individual ou para reforcar o status.

## 8. Callback de sucesso ou erro

Se o envio funcionar:

```json
{
  "dispatch_log_id": "={{ $json.dispatch_log_id }}",
  "status": "delivered",
  "n8n_execution_id": "={{ $execution.id }}"
}
```

Se falhar:

```json
{
  "dispatch_log_id": "={{ $json.dispatch_log_id }}",
  "status": "failed",
  "error_message": "={{ $json.error.message || 'Falha no envio' }}",
  "n8n_execution_id": "={{ $execution.id }}"
}
```

Envie esse payload para:

```text
={{ $('Webhook').item.json.callback_url }}
```

Com o mesmo header:

```text
x-callback-secret: ={{ $('Webhook').item.json.callback_secret }}
```

## Observacoes

- O bot local continua disponivel em `http://127.0.0.1:3010`.
- O endpoint do bot para envio generico e `POST /send`.
- O endpoint publico recomendado para o N8N e `POST /api/bot/send`.
- Para grupos, prefira sempre IDs vindos da sincronizacao do bot.
