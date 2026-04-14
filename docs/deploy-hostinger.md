# Deploy na Hostinger

Este projeto funciona melhor em `VPS` da Hostinger, porque precisa de:

- app `Next.js`
- bot do `WhatsApp` rodando como processo persistente
- disco local para a sessao do bot
- navegador Chromium instalado para gerar PDF quando necessario

## Pasta do projeto

Use a pasta:

```bash
~/Solucoes-Inteligente
```

## 1. Clonar o repositório

```bash
cd ~
git clone https://github.com/Gabriel-Nojoza/Solucao-Inteligente.git Solucoes-Inteligente
cd Solucoes-Inteligente
```

## 2. Instalar Node e pnpm

Se a VPS ainda nao tiver `Node.js 22+` e `pnpm`, instale primeiro.

Depois:

```bash
pnpm install
pnpm --dir services/whatsapp-bot install
```

## 3. Configurar ambiente

Crie o arquivo `.env.local` com base em `.env.example`:

```bash
cp .env.example .env.local
```

Preencha pelo menos:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `WHATSAPP_BOT_SERVICE_URL=http://127.0.0.1:3010`
- `PLATFORM_ADMIN_EMAIL`

Se o Chrome ou Edge nao estiver no `PATH`, defina tambem:

- `REPORT_PDF_BROWSER_PATH`

## 4. Rodar migrations no Supabase

No `SQL Editor` do Supabase, rode as migrations pendentes.

Para a selecao de varias paginas do relatorio, esta migration precisa estar aplicada:

```sql
alter table public.schedules
  add column if not exists pbi_page_names text[];

update public.schedules
set pbi_page_names = array[pbi_page_name]
where pbi_page_name is not null
  and (
    pbi_page_names is null
    or cardinality(pbi_page_names) = 0
  );
```

## 5. Build

```bash
pnpm build
```

## 6. Subir com PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 7. Atualizar depois

Sempre que fizer alteracoes novas no GitHub:

```bash
cd ~/Solucoes-Inteligente
git pull origin main
pnpm install
pnpm --dir services/whatsapp-bot install
pnpm build
pm2 restart ecosystem.config.cjs
```

## 8. Validacao rapida

App:

```bash
curl http://127.0.0.1:3000
```

Bot:

```bash
curl http://127.0.0.1:3010/health
curl http://127.0.0.1:3010/status
```

## Observacoes

- O `n8n` pode ficar separado, local ou cloud.
- Para PDF de relatorios Power BI, a VPS precisa ter `Chrome` ou `Edge`.
- O bot do WhatsApp nao deve ficar em hospedagem compartilhada simples.
