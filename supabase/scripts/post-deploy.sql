-- ============================================================
-- POST-DEPLOY SCRIPT — CryptoPixelV2
-- À copier-coller dans le SQL Editor Supabase et exécuter
-- APRÈS CHAQUE déploiement de l'indexer Ponder sur Railway.
--
-- Ce fichier ne s'exécute jamais tout seul : c'est juste un
-- presse-papier organisé. Tu dois toujours copier son contenu
-- et l'exécuter manuellement dans le SQL Editor (ou via un outil
-- comme `psql -f post-deploy.sql` / Supabase CLI si tu automatises
-- plus tard).
-- ============================================================


-- ============================================================
-- PARTIE 1 — Sécurité des vues ponder_public
-- Nécessaire à chaque déploiement car Ponder régénère TOUTES
-- les vues dans ponder_public à chaque redeploy (nouveau schema
-- source $RAILWAY_DEPLOYMENT_ID), donc les grants et les options
-- de sécurité posées manuellement sont perdus à chaque fois.
-- ============================================================

-- 1a. Tables internes Ponder — jamais exposées publiquement
REVOKE SELECT ON ponder_public._ponder_meta FROM anon, authenticated;
REVOKE SELECT ON ponder_public._ponder_checkpoint FROM anon, authenticated;

-- 1b. Données sensibles par wallet — confirmé non utilisées côté frontend
REVOKE SELECT ON ponder_public.burner_balance FROM anon, authenticated;
REVOKE SELECT ON ponder_public.airdrop_stats FROM anon, authenticated;

-- 1c. Vues publiques légitimes — on retire le SECURITY DEFINER
--     (pas de RLS derrière donc ça ne change rien fonctionnellement,
--     ça sert juste à faire taire le lint Supabase proprement)
ALTER VIEW ponder_public.pixel SET (security_invoker = false);
ALTER VIEW ponder_public.global_stats SET (security_invoker = false);
ALTER VIEW ponder_public.burner_stats SET (security_invoker = false);


-- ============================================================
-- PARTIE 2 — Cleanup des anciens schémas UUID Ponder
-- Chaque déploiement crée un nouveau schema UUID
-- ($RAILWAY_DEPLOYMENT_ID) et bascule les vues dessus, mais ne
-- supprime jamais l'ancien. Ce bloc détecte le schema actif
-- (celui référencé par ponder_public.pixel) et drop tous les
-- autres schémas UUID.
-- Sécurité : si la détection échoue, le script s'arrête sans
-- rien supprimer.
-- ============================================================

DO $$
DECLARE
  active_schema TEXT;
  old_schema RECORD;
BEGIN
  SELECT (regexp_matches(
            pg_get_viewdef(c.oid),
            '"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})"'
          ))[1]
  INTO active_schema
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'ponder_public' AND c.relname = 'pixel' AND c.relkind = 'v';

  IF active_schema IS NULL THEN
    RAISE EXCEPTION 'Impossible de détecter le schema actif, abandon par sécurité (aucun schema supprimé)';
  END IF;

  RAISE NOTICE 'Schema actif détecté : %', active_schema;

  FOR old_schema IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      AND nspname != active_schema
  LOOP
    RAISE NOTICE 'Suppression du schema obsolète : %', old_schema.nspname;
    EXECUTE format('DROP SCHEMA %I CASCADE', old_schema.nspname);
  END LOOP;

  RAISE NOTICE 'Nettoyage terminé.';
END $$;


-- ============================================================
-- PARTIE 3 — Vérification finale
-- Lance cette requête après les parties 1 et 2 pour confirmer
-- que tout est comme prévu.
-- ============================================================

-- Grants restants sur les vues sensibles (doit être vide pour
-- _ponder_meta, _ponder_checkpoint, burner_balance, airdrop_stats)
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'ponder_public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee;

-- Liste des schémas UUID restants (doit n'en montrer qu'un seul :
-- le schema actif du déploiement en cours)
SELECT nspname
FROM pg_namespace
WHERE nspname ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
ORDER BY nspname;
