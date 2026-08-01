-- ── Table pending_frozen_pixels ────────────────────────────────────────────
-- Écrit immédiatement par confirm-freeze dès qu'un freeze est confirmé
-- on-chain, sans attendre que l'indexer Ponder rattrape via son polling.
-- Purgée automatiquement une fois que l'indexer a confirmé le freeze dans
-- ponder_public.pixel, ou après un délai de sécurité si l'indexer traîne.
create table if not exists pending_frozen_pixels (
  id text primary key,           -- "x-y", cohérent avec offchain_canvas.id / pixel.id
  owner text not null,
  tx_hash text not null,
  created_at timestamptz not null default now()
);

-- Utilisé par paint-pixels pour filtrer rapidement les lignes récentes
create index if not exists idx_pending_frozen_pixels_created_at
  on pending_frozen_pixels (created_at);

alter table pending_frozen_pixels enable row level security;
-- Aucune policy pour anon/authenticated — accessible uniquement via
-- service_role (confirm-freeze, paint-pixels, cron), même pattern que
-- pending_purges et used_signatures.