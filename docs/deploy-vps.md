# Deploy em VPS

Este projeto precisa de mais de um processo em producao:

- App `Next.js`
- Bot `WhatsApp` em `services/whatsapp-bot`
- `N8N` separado, local ou cloud
- `Chrome` ou `Edge` instalado no servidor para renderizar relatorios Power BI em `HTML -> PDF` quando o `ExportTo` nao estiver disponivel

## Recomendacao

Use uma `VPS` Linux com `Node.js`, `pnpm`, `PM2`, `Nginx` e um navegador baseado em Chromium (`Google Chrome` ou `Microsoft Edge`).

Nao e recomendado publicar tudo em hospedagem compartilhada ou em plataforma serverless pura, porque o bot do WhatsApp precisa:

- processo persistente
- disco persistente para `services/whatsapp-bot/auth`
- acesso local ao endpoint `http://127.0.0.1:3010`

## Estrutura sugerida

- App: `https://app.seudominio.com`
- N8N: `https://n8n.seudominio.com` ou `n8n.cloud`
- Bot: interno, sem exposicao publica, em `http://127.0.0.1:3010`

## Variaveis de ambiente

Copie `.env.example` para `.env.production` e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_APP_URL=https://app.seudominio.com

PBI_CLIENT_ID=your-powerbi-client-id
N8N_WEBHOOK_URL=
PLATFORM_ADMIN_EMAIL=admin@seudominio.com

WHATSAPP_BOT_SERVICE_URL=http://127.0.0.1:3010
REPORT_PDF_BROWSER_PATH=
BOT_PORT=3010
BOT_PDF_BASE_DIR=
```

Observacoes:

- `N8N_WEBHOOK_URL` pode ficar vazio se cada empresa configurar isso no painel.
- O bot usa `services/whatsapp-bot/auth` para manter a sessao do WhatsApp.
- Em producao, mantenha `WHATSAPP_BOT_SERVICE_URL` apontando para `127.0.0.1`.
- `REPORT_PDF_BROWSER_PATH` e opcional se o navegador estiver no `PATH` do sistema. Use quando o Chrome/Edge estiver instalado em um caminho customizado.

## Passo a passo

### 1. Instalar dependencias

```bash
pnpm install
pnpm --dir services/whatsapp-bot install
```

### 1.1 Instalar navegador para o renderer de PDF

Ubuntu/Debian com Google Chrome:

```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-linux.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
```

Se o binario nao ficar no `PATH`, defina `REPORT_PDF_BROWSER_PATH` com o caminho absoluto do executavel.

### 2. Build do app

```bash
pnpm build
```

### 3. Subir com PM2

Instale PM2:

```bash
npm install -g pm2
```

Suba os processos:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 4. Nginx

Publique so o app publicamente. O bot pode ficar interno.

Exemplo de proxy para o app:

```nginx
server {
    listen 80;
    server_name app.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Depois aplique SSL com `certbot`.

## Ordem recomendada de configuracao

1. Subir o app
2. Confirmar login no painel
3. Subir o bot
4. Ler o QR do WhatsApp
5. Configurar o `callback_secret`
6. Configurar o `Webhook URL` do N8N
7. Testar disparo manual

## Validacao rapida

- App: `https://app.seudominio.com`
- Bot: `curl http://127.0.0.1:3010/health`
- Status do bot: `curl http://127.0.0.1:3010/status`

## Importante

Se segredos reais ja foram compartilhados ou commitados antes, gere novos valores antes de publicar:

- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, se necessario
- `client_secret` do Power BI
- qualquer `callback_secret` antigo
