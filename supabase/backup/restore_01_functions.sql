-- ============================================================
-- RESTAURATION 1/3 : FONCTIONS MÉTIER (schéma public)
-- Les fonctions systèmes (auth.*, storage.*, realtime.*, extensions.*,
-- net.*, vault.*, cron.*) sont réinstallées automatiquement par
-- Supabase à la création du projet + activation des extensions.
-- Ne pas les recréer manuellement.
--
-- SECURITY DEFINER : count_effective_owned, cleanup_excess_pixels_atomic,
-- enforce_quota_atomic, paint_pixels_atomic et purge_frozen_pixels_atomic
-- doivent TOUTES avoir SECURITY DEFINER (ajouté le 31/07/2026 suite à
-- l'incident "permission denied for table pixel"). Sans ça, ces fonctions
-- dépendent des GRANTs du rôle appelant (anon/authenticated) sur
-- used_signatures, painters, offchain_canvas, sacrifice_log et
-- ponder_public.pixel — GRANTs volontairement absents (accès censé passer
-- uniquement par ces fonctions). Ne pas retirer au prochain refactor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.acquire_cron_lock(p_job_name text, p_ttl_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
begin
  delete from cron_locks
  where job_name = p_job_name and locked_until < now();

  insert into cron_locks (job_name, locked_at, locked_until)
  values (p_job_name, now(), now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (job_name) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_job_name text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from cron_locks where job_name = p_job_name;
$function$;

CREATE OR REPLACE FUNCTION public.bump_rate_limit(p_address text, p_window_ms bigint, p_max integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_count int;
begin
  insert into rate_limits (address, window_start, request_count)
  values (p_address, now(), 1)
  on conflict (address) do update set
    request_count = case
      when extract(epoch from (now() - rate_limits.window_start)) * 1000 < p_window_ms
        then rate_limits.request_count + 1
      else 1
    end,
    window_start = case
      when extract(epoch from (now() - rate_limits.window_start)) * 1000 < p_window_ms
        then rate_limits.window_start
      else now()
    end
  returning request_count into v_count;
  return v_count <= p_max;
end;
$function$;

CREATE OR REPLACE FUNCTION public.count_effective_owned(p_painter text, p_extra_frozen_ids text[] DEFAULT ARRAY[]::text[])
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::integer
  from offchain_canvas oc
  where oc.painter = p_painter
    and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
    and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id)
    and oc.id != all(p_extra_frozen_ids);
$function$;

CREATE OR REPLACE FUNCTION public.get_painted_count()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT reltuples::bigint FROM pg_class WHERE relname = 'offchain_canvas';
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_purge_ids(p_ids text[], p_painter text)
 RETURNS TABLE(id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pp.id FROM pending_purges pp
  JOIN offchain_canvas oc ON oc.id = pp.id
  WHERE pp.id = ANY(p_ids)
    AND oc.painter = lower(p_painter);
$function$;

CREATE OR REPLACE FUNCTION public.mark_painter_reconciled(p_painter text, p_success boolean)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update painters
  set last_reconciled_at = now(),
      consecutive_failures = case when p_success then 0 else consecutive_failures + 1 end
  where address = p_painter;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_quota_atomic(p_painter text, p_usable_tokens integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_effective_owned integer;
  v_deficit integer;
  v_sacrificeable text[];
  v_locked_sacrificed_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_painter));

  -- Exclut aussi pending_frozen_pixels (fix août 2026, aligné sur
  -- cleanup_excess_pixels_atomic/paint_pixels_atomic) : sans ça, un pixel
  -- freeze à l'instant mais pas encore visible dans ponder_public.pixel
  -- (lag indexer) pouvait être sacrifié ici avec reason='quota_atomic' au
  -- lieu d'être purgé plus tard par execute-pending-purges avec
  -- reason='freeze_purge'. Résultat final identique (ligne supprimée dans
  -- les deux cas) mais sacrifice_log mal étiqueté — corrigé.
  select count(*) into v_effective_owned
  from offchain_canvas oc
  where oc.painter = p_painter
    and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
    and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id);

  if p_usable_tokens >= v_effective_owned then
    return jsonb_build_object('success', true, 'deleted', 0, 'locked_sacrificed', 0, 'still_deficit', 0);
  end if;

  v_deficit := v_effective_owned - p_usable_tokens;

  select array_agg(sub.id) into v_sacrificeable
  from (
    select oc.id from offchain_canvas oc
    where oc.painter = p_painter
      and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
      and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id)
    order by oc.is_locked asc, oc.updated_at asc
    limit v_deficit
  ) sub;

  if v_sacrificeable is not null and array_length(v_sacrificeable, 1) > 0 then
    select count(*) into v_locked_sacrificed_count
    from offchain_canvas where id = any(v_sacrificeable) and is_locked = true;

    insert into sacrifice_log (pixel_id, painter, reason, was_locked)
    select id, p_painter, 'quota_atomic', is_locked
    from offchain_canvas where id = any(v_sacrificeable);

    delete from offchain_canvas where id = any(v_sacrificeable) and painter = p_painter;
  end if;

  return jsonb_build_object(
    'success', true,
    'deleted', coalesce(array_length(v_sacrificeable, 1), 0),
    'locked_sacrificed', v_locked_sacrificed_count,
    'still_deficit', v_deficit - coalesce(array_length(v_sacrificeable, 1), 0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_excess_pixels_atomic(p_painter text, p_usable_tokens integer, p_extra_frozen_ids text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_effective_owned integer;
  v_deficit integer;
  v_sacrificeable text[];
  v_locked_sacrificed_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_painter));

select count(*) into v_effective_owned
  from offchain_canvas oc
  where oc.painter = p_painter
    and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
    and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id)
    and oc.id != all(p_extra_frozen_ids);

  if p_usable_tokens >= v_effective_owned then
    return jsonb_build_object('success', true, 'deleted', 0, 'locked_sacrificed', 0);
  end if;

  v_deficit := v_effective_owned - p_usable_tokens;

  select array_agg(sub.id) into v_sacrificeable
  from (
    select oc.id from offchain_canvas oc
    where oc.painter = p_painter
      and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
      and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id)
      and oc.id != all(p_extra_frozen_ids)
    order by oc.is_locked asc, oc.updated_at asc
    limit v_deficit
  ) sub;

  if v_sacrificeable is not null and array_length(v_sacrificeable, 1) > 0 then
    select count(*) into v_locked_sacrificed_count
    from offchain_canvas where id = any(v_sacrificeable) and is_locked = true;

    insert into sacrifice_log (pixel_id, painter, reason, was_locked)
    select id, p_painter, 'cleanup_live', is_locked
    from offchain_canvas where id = any(v_sacrificeable);

    delete from offchain_canvas where id = any(v_sacrificeable) and painter = p_painter;
  end if;

  return jsonb_build_object(
    'success', true,
    'deleted', coalesce(array_length(v_sacrificeable, 1), 0),
    'locked_sacrificed', v_locked_sacrificed_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.purge_frozen_pixels_atomic(p_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id text;
  v_painter text;
  v_purged text[] := array[]::text[];
begin
  foreach v_id in array p_ids loop
    select painter into v_painter from offchain_canvas where id = v_id;

    if v_painter is not null then
      perform pg_advisory_xact_lock(hashtext(v_painter));

      if exists (select 1 from ponder_public.pixel where id = v_id) then
        insert into sacrifice_log (pixel_id, painter, reason, was_locked)
        select v_id, v_painter, 'freeze_purge', is_locked
        from offchain_canvas
        where id = v_id;

        delete from offchain_canvas where id = v_id;

        v_purged := array_append(v_purged, v_id);
      end if;
    end if;
  end loop;

  return jsonb_build_object('purged', v_purged);
end;
$function$;

CREATE OR REPLACE FUNCTION public.paint_pixels_atomic(p_painter text, p_pixels jsonb, p_usable_tokens integer, p_signature_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pixel_count integer;
  v_blocked_ids text[];
  v_effective_owned integer;
  v_already_owned_ids text[];
  v_new_pixels integer;
  v_total_required integer;
  v_deficit integer;
  v_sacrificeable text[];
  v_locked_sacrificed_count integer := 0;
begin
  select count(*) into v_pixel_count from jsonb_array_elements(p_pixels);
  if v_pixel_count = 0 or v_pixel_count > 500 then
    raise exception 'INVALID_BATCH_SIZE';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_pixels) p
    where (p->>'x') !~ '^\d+$'
       or (p->>'y') !~ '^\d+$'
       or (p->>'x')::int < 0 or (p->>'x')::int >= 32000
       or (p->>'y')::int < 0 or (p->>'y')::int >= 31250
       or (p->>'color') !~ '^\d+$'
       or (p->>'color')::int < 0 or (p->>'color')::int > 31
       or (p->>'id') is distinct from ((p->>'x') || '-' || (p->>'y'))
  ) then
    raise exception 'INVALID_PIXEL_DATA';
  end if;

  begin
    insert into used_signatures (signature_hash) values (p_signature_hash);
  exception when unique_violation then
    raise exception 'SIGNATURE_ALREADY_USED';
  end;

  perform pg_advisory_xact_lock(hashtext(p_painter));

  insert into painters (address, last_reconciled_at)
  values (p_painter, null)
  on conflict (address) do nothing;

select array_agg(pix.id) into v_blocked_ids
from (
  select id from ponder_public.pixel
  where id in (select p->>'id' from jsonb_array_elements(p_pixels) p)
  union
  select id from pending_frozen_pixels
  where id in (select p->>'id' from jsonb_array_elements(p_pixels) p)
) pix;

  if v_blocked_ids is not null and array_length(v_blocked_ids, 1) > 0 then
    raise exception 'FROZEN_PIXELS:%', array_to_string(v_blocked_ids, ',');
  end if;

  select count(*) into v_effective_owned
from offchain_canvas oc
where oc.painter = p_painter
  and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
  and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id);

  select array_agg(oc.id) into v_already_owned_ids
  from offchain_canvas oc
  where oc.painter = p_painter
    and oc.id in (select p->>'id' from jsonb_array_elements(p_pixels) p);

  select count(*) into v_new_pixels
  from jsonb_array_elements(p_pixels) p
  where (p->>'id') != all(coalesce(v_already_owned_ids, array[]::text[]));

  v_total_required := v_effective_owned + v_new_pixels;

  if p_usable_tokens < v_total_required then
    v_deficit := v_total_required - p_usable_tokens;

    select array_agg(sub.id) into v_sacrificeable
from (
  select oc.id from offchain_canvas oc
  where oc.painter = p_painter
    and not exists (select 1 from ponder_public.pixel p where p.id = oc.id)
    and not exists (select 1 from pending_frozen_pixels pfp where pfp.id = oc.id)
    and oc.id != all(coalesce(v_already_owned_ids, array[]::text[]))
  order by oc.is_locked asc, oc.updated_at asc
  limit v_deficit
) sub;

    if coalesce(array_length(v_sacrificeable, 1), 0) < v_deficit then
      raise exception 'INSUFFICIENT_BALANCE:usable=%,required=%', p_usable_tokens, v_total_required;
    end if;

    select count(*) into v_locked_sacrificed_count
    from offchain_canvas where id = any(v_sacrificeable) and is_locked = true;

    insert into sacrifice_log (pixel_id, painter, reason, was_locked)
    select id, p_painter, 'paint_atomic', is_locked
    from offchain_canvas where id = any(v_sacrificeable);

    delete from offchain_canvas where id = any(v_sacrificeable) and painter = p_painter;
  end if;

  insert into offchain_canvas (id, x, y, color, painter, updated_at)
  select p->>'id', (p->>'x')::int, (p->>'y')::int, (p->>'color')::smallint, p_painter, extract(epoch from now())::bigint
  from jsonb_array_elements(p_pixels) p
  on conflict (id) do update set
    color = excluded.color,
    painter = excluded.painter,
    updated_at = excluded.updated_at;

  insert into paint_events (x, y, color, painted_at)
  select (p->>'x')::int, (p->>'y')::int, (p->>'color')::smallint, now()
  from jsonb_array_elements(p_pixels) p;

  return jsonb_build_object('success', true, 'locked_sacrificed', v_locked_sacrificed_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.compact_canvas_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_snapshot_id bigint;
  v_cutoff timestamptz := now();
  v_pixel_count integer;
  v_deleted_events integer;
begin
  insert into canvas_base_snapshots (captured_at, pixels)
  select
    v_cutoff,
    jsonb_agg(jsonb_build_object('x', x, 'y', y, 'color', color))
  from offchain_canvas
  returning id into v_snapshot_id;

  select count(*) into v_pixel_count
  from offchain_canvas;

  delete from paint_events
  where painted_at < v_cutoff;
  get diagnostics v_deleted_events = row_count;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot_id,
    'pixel_count', v_pixel_count,
    'deleted_events', v_deleted_events
  );
end;
$function$;

create or replace function cleanup_confirmed_pending_frozen()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Cas normal : l'indexer a rattrapé, le pixel apparaît bien frozen
  -- dans le schema Ponder — l'entrée ici devient redondante.
  delete from pending_frozen_pixels pfp
  where exists (
    select 1
    from ponder_public.pixel p
    where p.id = pfp.id and p.is_frozen = true
  );

  -- Filet de sécurité : purge tout ce qui traîne depuis plus de 10 minutes,
  -- même si l'indexer n'a toujours pas rattrapé (redéploiement Ponder en
  -- cours, panne temporaire, etc.) — évite une accumulation indéfinie.
  delete from pending_frozen_pixels
  where created_at < now() - interval '10 minutes';
end;
$$;

-- Grants EXECUTE (reconstruits d'après l'audit du 31/07/2026)
GRANT EXECUTE ON FUNCTION public.acquire_cron_lock TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION public.count_effective_owned TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_quota_atomic TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_excess_pixels_atomic TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_frozen_pixels_atomic TO service_role;
GRANT EXECUTE ON FUNCTION public.paint_pixels_atomic TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_painter_reconciled TO service_role;
GRANT EXECUTE ON FUNCTION public.get_painted_count TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_purge_ids TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compact_canvas_snapshot TO service_role;