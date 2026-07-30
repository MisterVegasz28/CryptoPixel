-- ============================================================
-- RESTORE BASELINE — CryptoPixel
-- État de référence CONFIRMÉ SAIN au 31/07/2026, capturé après
-- résolution de l'incident "permission denied for table pixel"
-- (cause : security_invoker=true appliqué par erreur sur les
-- vues ponder_public).
--
-- À rejouer intégralement en cas de pépin (GRANT/permission
-- errors, RLS qui bloque tout, policy manquante). Le script est
-- idempotent : rejouable autant de fois que nécessaire sans
-- risque de doublon ou d'erreur.
--
-- NE COUVRE PAS : le code des fonctions (CREATE OR REPLACE
-- FUNCTION ...). Si une fonction a été altérée/supprimée par
-- erreur, il faut la redéployer séparément depuis son fichier
-- source — ce script ne restaure que permissions et policies.
--
-- À régénérer périodiquement via snapshot_permissions.sql pour
-- garder ce fichier à jour avec l'état réellement voulu.
-- ============================================================


-- ============================================================
-- 1. GRANTS SUR TABLES/VUES
-- ============================================================

-- ponder_public (régénéré à chaque redeploy Ponder — à rejouer
-- après CHAQUE déploiement Railway de l'indexer)
GRANT SELECT ON ponder_public._ponder_checkpoint TO service_role;
GRANT SELECT ON ponder_public._ponder_meta TO service_role;
GRANT SELECT ON ponder_public.airdrop_stats TO service_role;
GRANT SELECT ON ponder_public.burner_balance TO service_role;
GRANT SELECT ON ponder_public.burner_stats TO anon;
GRANT SELECT ON ponder_public.burner_stats TO authenticated;
GRANT SELECT ON ponder_public.burner_stats TO service_role;
GRANT SELECT ON ponder_public.global_stats TO anon;
GRANT SELECT ON ponder_public.global_stats TO authenticated;
GRANT SELECT ON ponder_public.global_stats TO service_role;
GRANT SELECT ON ponder_public.pixel TO anon;
GRANT SELECT ON ponder_public.pixel TO authenticated;
GRANT SELECT ON ponder_public.pixel TO service_role;

-- public
GRANT UPDATE, SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER, INSERT ON public._ponder_checkpoint TO service_role;
GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, UPDATE, SELECT, DELETE ON public.burner_profile TO service_role;
GRANT SELECT ON public.canvas_snapshots TO anon;
GRANT SELECT ON public.canvas_snapshots TO authenticated;
GRANT REFERENCES, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.canvas_snapshots TO service_role;
GRANT INSERT, UPDATE, SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE ON public.cron_locks TO service_role;
GRANT SELECT ON public.freeze_events TO anon;
GRANT SELECT ON public.freeze_events TO authenticated;
GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT ON public.freeze_events TO service_role;
GRANT SELECT ON public.frozen_tiles TO anon;
GRANT SELECT ON public.frozen_tiles TO authenticated;
GRANT UPDATE, INSERT, SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.frozen_tiles TO service_role;
GRANT SELECT ON public.offchain_canvas TO anon;
GRANT SELECT ON public.offchain_canvas TO authenticated;
GRANT REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT, INSERT, TRIGGER ON public.offchain_canvas TO service_role;
GRANT INSERT, TRIGGER, REFERENCES, TRUNCATE, DELETE, UPDATE, SELECT ON public.painters TO service_role;
GRANT TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.pending_purges TO service_role;
GRANT SELECT, INSERT, TRIGGER, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.rate_limits TO service_role;
GRANT UPDATE, INSERT, SELECT, TRIGGER, REFERENCES, TRUNCATE, DELETE ON public.sacrifice_log TO service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT ON public.used_signatures TO service_role;


-- ============================================================
-- 2. GRANTS EXECUTE SUR LES FONCTIONS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(p_job_name text, p_ttl_seconds integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(p_address text, p_window_ms bigint, p_max integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_excess_pixels_atomic(p_painter text, p_usable_tokens integer, p_extra_frozen_ids text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_excess_pixels_atomic(p_painter text, p_usable_tokens integer, p_extra_frozen_ids text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_excess_pixels_atomic(p_painter text, p_usable_tokens integer, p_extra_frozen_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_effective_owned(p_painter text, p_extra_frozen_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_quota_atomic(p_painter text, p_usable_tokens integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_painted_count() TO anon;
GRANT EXECUTE ON FUNCTION public.get_painted_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_painted_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_purge_ids(p_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_painter_reconciled(p_painter text, p_success boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.paint_pixels_atomic(p_painter text, p_pixels jsonb, p_usable_tokens integer, p_signature_hash text) TO anon;
GRANT EXECUTE ON FUNCTION public.paint_pixels_atomic(p_painter text, p_pixels jsonb, p_usable_tokens integer, p_signature_hash text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.paint_pixels_atomic(p_painter text, p_pixels jsonb, p_usable_tokens integer, p_signature_hash text) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_frozen_pixels_atomic(p_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(p_job_name text) TO service_role;


-- ============================================================
-- 3. RLS ENABLE (idempotent — ENABLE sur une table déjà activée
-- ne fait rien)
-- ============================================================

ALTER TABLE public._ponder_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.burner_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freeze_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offchain_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_purges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacrifice_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_signatures ENABLE ROW LEVEL SECURITY;

-- NOTE : cron_locks, pending_purges, rate_limits et
-- _ponder_checkpoint ont RLS activé SANS policy : deny-all pour
-- tout le monde sauf service_role (qui bypass RLS par défaut).
-- C'est intentionnel — ne pas ajouter de policy dessus sans
-- raison précise.


-- ============================================================
-- 4. POLICIES RLS (DROP IF EXISTS avant chaque CREATE, donc
-- rejouable sans erreur de doublon)
-- ============================================================

DROP POLICY IF EXISTS public_read ON public.burner_profile;
CREATE POLICY public_read ON public.burner_profile AS PERMISSIVE FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS canvas_snapshots_select ON public.canvas_snapshots;
CREATE POLICY canvas_snapshots_select ON public.canvas_snapshots AS PERMISSIVE FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Allow public read" ON public.freeze_events;
CREATE POLICY "Allow public read" ON public.freeze_events AS PERMISSIVE FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS offchain_canvas_delete ON public.offchain_canvas;
CREATE POLICY offchain_canvas_delete ON public.offchain_canvas AS PERMISSIVE FOR DELETE TO service_role USING (true);

DROP POLICY IF EXISTS offchain_canvas_insert ON public.offchain_canvas;
CREATE POLICY offchain_canvas_insert ON public.offchain_canvas AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS offchain_canvas_select ON public.offchain_canvas;
CREATE POLICY offchain_canvas_select ON public.offchain_canvas AS PERMISSIVE FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS offchain_canvas_update ON public.offchain_canvas;
CREATE POLICY offchain_canvas_update ON public.offchain_canvas AS PERMISSIVE FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS painters_insert ON public.painters;
CREATE POLICY painters_insert ON public.painters AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS sacrifice_log_insert ON public.sacrifice_log;
CREATE POLICY sacrifice_log_insert ON public.sacrifice_log AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS used_signatures_insert ON public.used_signatures;
CREATE POLICY used_signatures_insert ON public.used_signatures AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);


-- ============================================================
-- 5. SECURITY_INVOKER SUR LES VUES
-- Les vues ponder_public DOIVENT rester en false (le rôle
-- appelant n'a pas de droits directs sur les tables UUID
-- sous-jacentes du déploiement Ponder actif).
-- frozen_tiles reste en true : elle ne pointe que vers
-- public.freeze_events, sur laquelle anon/authenticated ont
-- déjà un GRANT SELECT direct + policy "Allow public read" —
-- aucun risque à l'inverser ici.
-- ============================================================

ALTER VIEW ponder_public._ponder_checkpoint SET (security_invoker = false);
ALTER VIEW ponder_public._ponder_meta SET (security_invoker = false);
ALTER VIEW ponder_public.airdrop_stats SET (security_invoker = false);
ALTER VIEW ponder_public.burner_balance SET (security_invoker = false);
ALTER VIEW ponder_public.burner_stats SET (security_invoker = false);
ALTER VIEW ponder_public.global_stats SET (security_invoker = false);
ALTER VIEW ponder_public.pixel SET (security_invoker = false);
ALTER VIEW public.frozen_tiles SET (security_invoker = true);


-- ============================================================
-- 6. GRANTS À RÉVOQUER (tables internes Ponder / sensibles
-- jamais exposées à anon/authenticated — utile si un GRANT
-- accidentel a été ajouté entretemps)
-- ============================================================

REVOKE SELECT ON ponder_public._ponder_meta FROM anon, authenticated;
REVOKE SELECT ON ponder_public._ponder_checkpoint FROM anon, authenticated;
REVOKE SELECT ON ponder_public.burner_balance FROM anon, authenticated;
REVOKE SELECT ON ponder_public.airdrop_stats FROM anon, authenticated;
