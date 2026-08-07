-- ============================================================
-- RESTAURATION : STRUCTURE DES TABLES (schéma public)
-- Reconstruit d'après l'audit information_schema du 31/07/2026
-- ============================================================

-- NOTE : confirmé par requête sur is_identity/identity_generation —
-- les colonnes "id" de canvas_base_snapshots, canvas_snapshots, freeze_events
-- et paint_events sont bien GENERATED ALWAYS AS IDENTITY (start 1, increment 1).

CREATE TABLE public._ponder_checkpoint (
  chain_name text PRIMARY KEY,
  chain_id bigint NOT NULL,
  safe_checkpoint varchar(75) NOT NULL,
  latest_checkpoint varchar(75) NOT NULL,
  finalized_checkpoint varchar(75) NOT NULL
);

-- beta_allowlist : whitelist des wallets autorisés pendant la beta fermée.
-- Limite globale à 50 adresses appliquée via trigger (voir enforce_beta_allowlist_limit).
CREATE TABLE public.beta_allowlist (
  address text PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_beta_allowlist_address_lowercase CHECK (address = lower(address))
);
CREATE INDEX idx_beta_allowlist_added_at
  ON public.beta_allowlist USING btree (added_at);

CREATE OR REPLACE FUNCTION public.enforce_beta_allowlist_limit()
RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM public.beta_allowlist) >= 50 THEN
    RAISE EXCEPTION 'beta_allowlist limit of 50 addresses reached';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_beta_allowlist_limit
BEFORE INSERT ON public.beta_allowlist
FOR EACH ROW EXECUTE FUNCTION public.enforce_beta_allowlist_limit();

CREATE TABLE public.burner_profile (
  address text PRIMARY KEY,
  pseudo text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  telegram text NOT NULL DEFAULT '',
  twitter text NOT NULL DEFAULT '',
  discord text NOT NULL DEFAULT '',
  updated_at integer NOT NULL DEFAULT 0
);

CREATE TABLE public.canvas_base_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  pixels jsonb NOT NULL
);
CREATE INDEX idx_canvas_base_snapshots_time
  ON public.canvas_base_snapshots USING btree (captured_at DESC);

CREATE TABLE public.canvas_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  grid_w integer NOT NULL,
  grid_h integer NOT NULL,
  block_size integer NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX idx_canvas_snapshots_captured_at
  ON public.canvas_snapshots USING btree (captured_at);

CREATE TABLE public.cron_locks (
  job_name text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NOT NULL
);

CREATE TABLE public.freeze_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  x integer NOT NULL,
  y integer NOT NULL,
  color text NOT NULL,
  owner text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (x, y)
);

-- offchain_canvas : les ordinal_position (4, 9, 10, 11 manquants) indiquent
-- des colonnes supprimées historiquement (DROP COLUMN) — pas de souci,
-- on ne recrée que les colonnes actuelles.
CREATE TABLE public.offchain_canvas (
  id text PRIMARY KEY,
  x integer NOT NULL,
  y integer NOT NULL,
  painter text NOT NULL,
  updated_at integer NOT NULL DEFAULT 0,
  pixel_index integer,
  is_locked boolean NOT NULL DEFAULT false,
  color smallint NOT NULL DEFAULT 0,
  CONSTRAINT chk_painter_lowercase CHECK (painter = lower(painter))
);
CREATE INDEX idx_offchain_canvas_painter_locked_updated
  ON public.offchain_canvas USING btree (painter, is_locked, updated_at);
CREATE INDEX idx_offchain_canvas_xy
  ON public.offchain_canvas USING btree (x, y);

CREATE TABLE public.paint_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  x integer NOT NULL,
  y integer NOT NULL,
  color smallint NOT NULL,
  painted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_paint_events_time
  ON public.paint_events USING btree (painted_at);
CREATE INDEX idx_paint_events_xy_time
  ON public.paint_events USING btree (x, y, painted_at DESC);

CREATE TABLE public.pending_frozen_pixels (
  id text PRIMARY KEY,           -- "x-y", cohérent avec offchain_canvas.id / pixel.id
  owner text NOT NULL,
  tx_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pending_frozen_pixels_created_at
  ON public.pending_frozen_pixels USING btree (created_at);

CREATE TABLE public.painters (
  address text PRIMARY KEY,
  last_reconciled_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_painters_last_reconciled_at
  ON public.painters USING btree (last_reconciled_at NULLS FIRST);

CREATE TABLE public.pending_purges (
  id text PRIMARY KEY,
  block_number bigint NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_pending_purges_block
  ON public.pending_purges USING btree (block_number);

CREATE TABLE public.rate_limits (
  address text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public.sacrifice_log_id_seq
  AS bigint START 1 INCREMENT 1;

CREATE TABLE public.sacrifice_log (
  id bigint PRIMARY KEY DEFAULT nextval('sacrifice_log_id_seq'::regclass),
  pixel_id text NOT NULL,
  painter text NOT NULL,
  reason text NOT NULL,
  was_locked boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE public.sacrifice_log_id_seq OWNED BY public.sacrifice_log.id;

CREATE TABLE public.used_signatures (
  signature_hash text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_used_signatures_created_at
  ON public.used_signatures USING btree (created_at);
CREATE INDEX idx_used_signatures_used_at
  ON public.used_signatures USING btree (used_at);

-- Vue frozen_tiles (dépend de freeze_events, doit être créée après)
CREATE OR REPLACE VIEW public.frozen_tiles AS
SELECT x, y, color, owner FROM public.freeze_events;