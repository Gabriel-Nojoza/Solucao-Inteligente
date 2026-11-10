-- Anexos por dia da semana na rotina (chave "Por dia da semana" no campo Anexos).
-- Formato: { "enabled": true, "days": { "1": ["<link>"], "2": ["<link>", "<link>"], ... } }
-- (0 = domingo ... 6 = sabado). Vazio/nulo = rotina usa os anexos normais.
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS weekday_attachments jsonb;
