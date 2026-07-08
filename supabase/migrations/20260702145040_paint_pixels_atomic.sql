CREATE OR REPLACE FUNCTION public.paint_pixels_atomic(p_painter text, p_pixels jsonb, p_usable_tokens integer, p_signature_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pixel_count integer;
  v_blocked_ids text[];
  v_frozen_owned_ids text[];
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
       or (p->>'color') !~ '^#[0-9a-fA-F]{6}$'
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
  from pixel pix
  where pix.id in (select p->>'id' from jsonb_array_elements(p_pixels) p);

  if v_blocked_ids is not null and array_length(v_blocked_ids, 1) > 0 then
    raise exception 'FROZEN_PIXELS:%', array_to_string(v_blocked_ids, ',');
  end if;

  select array_agg(id) into v_frozen_owned_ids
  from pixel
  where owner = p_painter;

  select count(*) into v_effective_owned
  from offchain_canvas
  where painter = p_painter
    and id != all(coalesce(v_frozen_owned_ids, array[]::text[]));

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

    -- FIX : non-lockés d'abord, lockés en dernier recours (jamais de blocage)
    select array_agg(id) into v_sacrificeable
    from (
      select id from offchain_canvas
      where painter = p_painter
        and id != all(coalesce(v_frozen_owned_ids, array[]::text[]))
        and id != all(coalesce(v_already_owned_ids, array[]::text[]))
      order by is_locked asc, updated_at asc
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

    delete from offchain_canvas where id = any(v_sacrificeable);
  end if;

  insert into offchain_canvas (id, x, y, color, painter, updated_at)
  select p->>'id', (p->>'x')::int, (p->>'y')::int, p->>'color', p_painter, extract(epoch from now())::bigint
  from jsonb_array_elements(p_pixels) p
  on conflict (id) do update set
    color = excluded.color,
    painter = excluded.painter,
    updated_at = excluded.updated_at;

  return jsonb_build_object('success', true, 'locked_sacrificed', v_locked_sacrificed_count);
end;
$function$
