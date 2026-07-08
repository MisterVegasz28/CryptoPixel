CREATE OR REPLACE FUNCTION public.enforce_quota_atomic(p_painter text, p_usable_tokens integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_frozen_owned_ids text[];
  v_effective_owned integer;
  v_deficit integer;
  v_sacrificeable text[];
  v_locked_sacrificed_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_painter));

  select array_agg(id) into v_frozen_owned_ids from pixel where owner = p_painter;

  select count(*) into v_effective_owned
  from offchain_canvas
  where painter = p_painter
    and id != all(coalesce(v_frozen_owned_ids, array[]::text[]));

  if p_usable_tokens >= v_effective_owned then
    return jsonb_build_object('success', true, 'deleted', 0, 'locked_sacrificed', 0, 'still_deficit', 0);
  end if;

  v_deficit := v_effective_owned - p_usable_tokens;

  -- FIX : plus de "and is_locked = false" qui excluait totalement les
  -- lockés — maintenant ils sont juste en dernier recours (is_locked asc)
  select array_agg(id) into v_sacrificeable
  from (
    select id from offchain_canvas
    where painter = p_painter
      and id != all(coalesce(v_frozen_owned_ids, array[]::text[]))
    order by is_locked asc, updated_at asc
    limit v_deficit
  ) sub;

  if v_sacrificeable is not null and array_length(v_sacrificeable, 1) > 0 then
    select count(*) into v_locked_sacrificed_count
    from offchain_canvas where id = any(v_sacrificeable) and is_locked = true;

    insert into sacrifice_log (pixel_id, painter, reason, was_locked)
    select id, p_painter, 'quota_atomic', is_locked
    from offchain_canvas where id = any(v_sacrificeable);

    delete from offchain_canvas where id = any(v_sacrificeable);
  end if;

  return jsonb_build_object(
    'success', true,
    'deleted', coalesce(array_length(v_sacrificeable, 1), 0),
    'locked_sacrificed', v_locked_sacrificed_count,
    'still_deficit', v_deficit - coalesce(array_length(v_sacrificeable, 1), 0)
  );
end;
$function$
