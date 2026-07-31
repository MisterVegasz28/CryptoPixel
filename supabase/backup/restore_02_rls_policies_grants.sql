-- ============================================================
-- RESTAURATION 2/3 : RLS, POLICIES, GRANTS (schéma public)
-- PRÉREQUIS : ce script suppose que les TABLES existent déjà
-- (structure de colonnes non capturée dans cet audit — si tu
-- pars d'une base vide, il faut d'abord restaurer le schéma
-- des tables via `supabase db dump` ou tes migrations).
-- ============================================================

-- Activation RLS sur toutes les tables métier publiques
ALTER TABLE public.burner_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_base_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freeze_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offchain_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offchain_canvas FORCE ROW LEVEL SECURITY;  -- seule table avec FORCE
ALTER TABLE public.paint_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_purges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacrifice_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.used_signatures ENABLE ROW LEVEL SECURITY;

-- Policies (reconstruites d'après pg_policies au 31/07/2026)
CREATE POLICY "public_read" ON public.burner_profile
  FOR SELECT TO public USING (true);

CREATE POLICY "canvas_snapshots_select" ON public.canvas_snapshots
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public read" ON public.freeze_events
  FOR SELECT TO public USING (true);

CREATE POLICY "offchain_canvas_select" ON public.offchain_canvas
  FOR SELECT TO public USING (true);
CREATE POLICY "offchain_canvas_insert" ON public.offchain_canvas
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "offchain_canvas_update" ON public.offchain_canvas
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "offchain_canvas_delete" ON public.offchain_canvas
  FOR DELETE TO service_role USING (true);

CREATE POLICY "painters_insert" ON public.painters
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "sacrifice_log_insert" ON public.sacrifice_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "used_signatures_insert" ON public.used_signatures
  FOR INSERT TO service_role WITH CHECK (true);

-- NB : canvas_base_snapshots, cron_locks, pending_purges, rate_limits
-- ont RLS activé SANS policy -> fermées à anon/authenticated par design,
-- accessibles uniquement via service_role (qui bypass RLS) ou en SQL direct.
-- Rien à ajouter ici, c'est l'état observé en prod.

-- Grants de base sur les tables (lecture publique / écriture service_role)
-- burner_profile : GRANT explicite nécessaire pour que la policy "public_read"
-- serve à quelque chose (une policy RLS seule ne suffit pas sans le GRANT
-- sous-jacent). C'était manquant en prod au 31/07/2026 -> corrigé ici.
GRANT SELECT ON public.burner_profile TO anon, authenticated;
GRANT ALL ON public.burner_profile TO service_role;

GRANT SELECT ON public.canvas_snapshots TO anon, authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.canvas_snapshots TO service_role;

-- canvas_base_snapshots : RLS activé SANS policy -> deny-by-default pour
-- anon/authenticated de toute façon. Confirmé par audit du frontend (aucun
-- .from('canvas_base_snapshots') nulle part côté client) que anon/authenticated
-- n'ont besoin d'aucun accès ici. REVOKE explicite en plus du deny RLS, en
-- défense en profondeur (les nouvelles tables héritent des default privileges
-- Supabase qui donnent ALL à anon/authenticated par défaut).
REVOKE ALL ON public.canvas_base_snapshots FROM anon, authenticated;
GRANT ALL ON public.canvas_base_snapshots TO service_role;

GRANT SELECT ON public.freeze_events TO anon, authenticated;
GRANT ALL ON public.freeze_events TO service_role;
GRANT SELECT ON public.frozen_tiles TO anon, authenticated;  -- VUE sur freeze_events
GRANT SELECT ON public.offchain_canvas TO anon, authenticated;
GRANT ALL ON public.offchain_canvas TO service_role;

-- paint_events : même constat que canvas_base_snapshots -> RLS activé sans
-- policy, aucun accès frontend direct confirmé (le canvas live vient de
-- offchain_canvas + realtime, pas de paint_events). REVOKE en défense en
-- profondeur.
REVOKE ALL ON public.paint_events FROM anon, authenticated;
GRANT ALL ON public.paint_events TO service_role;

GRANT ALL ON public.painters TO service_role;
GRANT ALL ON public.pending_purges TO service_role;
GRANT ALL ON public.rate_limits TO service_role;
GRANT ALL ON public.sacrifice_log TO service_role;
GRANT ALL ON public.used_signatures TO service_role;
GRANT ALL ON public.cron_locks TO service_role;

-- compact_canvas_snapshot (définie dans restore_01_functions.sql) ne doit
-- être appelable que par le cron hebdo (service_role via pg_cron), pas par
-- le front. Le GRANT EXECUTE TO anon, authenticated dans restore_01 était
-- trop permissif -> révoqué ici en cohérence avec le fix appliqué en prod
-- le 31/07/2026 (cf. verify_and_fix_security.sql).
REVOKE EXECUTE ON FUNCTION public.compact_canvas_snapshot FROM anon, authenticated;

-- ============================================================
-- Schéma ponder_public : les 7 vues sont recréées automatiquement
-- par l'indexer Ponder à chaque démarrage/redeploy (via ponder.schema.ts),
-- PAS par ce script. Elles n'existent donc pas forcément au moment où
-- tu restaures depuis une base vide -- attends que l'indexer ait tourné
-- au moins une fois avant de lancer ce bloc, sinon les ALTER VIEW échoueront
-- en "relation does not exist".
--
-- Elles sont flaguées "Security Definer View" (CRITICAL) par le linter
-- Supabase par défaut : security_invoker = true force leur exécution avec
-- les droits de l'appelant plutôt que du créateur (rôle Ponder), pour que
-- RLS des tables sous-jacentes s'applique normalement. À réappliquer après
-- CHAQUE redeploy Ponder qui recrée ces vues (le flag ne persiste pas
-- automatiquement dessus).
-- ============================================================
ALTER VIEW ponder_public.pixel SET (security_invoker = true);
ALTER VIEW ponder_public.global_stats SET (security_invoker = true);
ALTER VIEW ponder_public.burner_stats SET (security_invoker = true);
ALTER VIEW ponder_public.airdrop_stats SET (security_invoker = true);
ALTER VIEW ponder_public.burner_balance SET (security_invoker = true);
ALTER VIEW ponder_public._ponder_meta SET (security_invoker = true);
ALTER VIEW ponder_public._ponder_checkpoint SET (security_invoker = true);