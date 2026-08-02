-- ============================================================
-- RESTAURATION 3/3 : EXTENSIONS + CRON JOBS
-- ============================================================

-- Extensions (généralement activables aussi depuis Dashboard > Database > Extensions)
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
-- supabase_vault et plpgsql sont installées par défaut par Supabase, rien à faire.

-- IMPORTANT : recrée d'abord les secrets Vault AVANT les cron jobs,
-- sinon les appels http échoueront (secret introuvable).
-- select vault.create_secret('<valeur_du_secret>', 'cron_secret', 'Secret partagé pour authentifier les appels pg_cron -> edge functions');
-- select vault.create_secret('<ta_service_role_key>', 'service_role_key', 'Clé service_role utilisée par le job capture-snapshot');

-- Cron jobs (reconstruits d'après cron.job au 31/07/2026)
-- Remplace <PROJECT_REF> si tu restaures vers un NOUVEAU projet Supabase
-- (l'URL actuelle est rkmmnyppiztrwjnftrzx.supabase.co)

select cron.schedule(
  '*/1 * * * *',
  $$
    select net.http_post(
      url := 'https://rkmmnyppiztrwjnftrzx.supabase.co/functions/v1/execute-pending-purges',
      headers := jsonb_build_object(
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://rkmmnyppiztrwjnftrzx.supabase.co/functions/v1/reconcile-canvas',
      headers := jsonb_build_object(
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  '*/5 * * * *',
  $$ delete from used_signatures where created_at < now() - interval '10 minutes'; $$
);

select cron.schedule(
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://rkmmnyppiztrwjnftrzx.supabase.co/functions/v1/capture-snapshot',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://cryptopixel-production.up.railway.app/internal/reconcile-balances',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  '0 3 * * 0',
  $$ select public.compact_canvas_snapshot(); $$
);


select cron.schedule(
  'cleanup-pending-frozen-pixels',
  '*/1 * * * *',
  $$select cleanup_confirmed_pending_frozen()$$
);