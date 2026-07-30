WITH grants AS (
  SELECT string_agg(line, E'\n' ORDER BY table_schema, table_name, grantee) AS sql
  FROM (
    SELECT table_schema, table_name, grantee,
      format('GRANT %s ON %I.%I TO %I;',
        string_agg(privilege_type, ', '), table_schema, table_name, grantee) AS line
    FROM information_schema.role_table_grants
    WHERE table_schema IN ('public', 'ponder_public')
      AND grantee IN ('anon', 'authenticated', 'service_role')
    GROUP BY table_schema, table_name, grantee
  ) sub
),
fn_grants AS (
  SELECT string_agg(
    format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %I;',
      routine_schema, routine_name, pg_get_function_identity_arguments(p.oid), grantee),
    E'\n' ORDER BY routine_name, grantee
  ) AS sql
  FROM information_schema.role_routine_grants rrg
  JOIN pg_proc p ON p.proname = rrg.routine_name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = rrg.routine_schema
  WHERE rrg.routine_schema = 'public'
    AND rrg.grantee IN ('anon', 'authenticated', 'service_role')
),
rls AS (
  SELECT string_agg(
    format('ALTER TABLE %I.%I %s ROW LEVEL SECURITY;',
      schemaname, tablename, CASE WHEN rowsecurity THEN 'ENABLE' ELSE 'DISABLE' END),
    E'\n' ORDER BY schemaname, tablename
  ) AS sql
  FROM pg_tables
  WHERE schemaname IN ('public', 'ponder_public')
),
policies AS (
  SELECT string_agg(
    format(
      'DROP POLICY IF EXISTS %I ON %I.%I;' || E'\n' ||
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
      policyname, schemaname, tablename,
      policyname, schemaname, tablename,
      CASE WHEN permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      cmd, array_to_string(roles, ', '),
      CASE WHEN qual IS NOT NULL THEN format(' USING (%s)', qual) ELSE '' END,
      CASE WHEN with_check IS NOT NULL THEN format(' WITH CHECK (%s)', with_check) ELSE '' END
    ),
    E'\n\n' ORDER BY schemaname, tablename, policyname
  ) AS sql
  FROM pg_policies
  WHERE schemaname IN ('public', 'ponder_public')
),
views_sec AS (
  SELECT string_agg(
    format('ALTER VIEW %I.%I SET (security_invoker = %s);',
      n.nspname, c.relname,
      COALESCE((SELECT (option_value = 'true') FROM pg_options_to_table(c.reloptions) o
                WHERE option_name = 'security_invoker'), false)),
    E'\n' ORDER BY n.nspname, c.relname
  ) AS sql
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'v' AND n.nspname IN ('public', 'ponder_public')
)
SELECT
  '-- ===== GRANTS TABLES/VUES =====' || E'\n' || COALESCE(grants.sql, '-- (aucun)') || E'\n\n' ||
  '-- ===== GRANTS EXECUTE FONCTIONS =====' || E'\n' || COALESCE(fn_grants.sql, '-- (aucun)') || E'\n\n' ||
  '-- ===== RLS ENABLE/DISABLE =====' || E'\n' || COALESCE(rls.sql, '-- (aucun)') || E'\n\n' ||
  '-- ===== POLICIES RLS =====' || E'\n' || COALESCE(policies.sql, '-- (aucune)') || E'\n\n' ||
  '-- ===== SECURITY_INVOKER VUES =====' || E'\n' || COALESCE(views_sec.sql, '-- (aucune)')
  AS full_backup_sql
FROM grants, fn_grants, rls, policies, views_sec;