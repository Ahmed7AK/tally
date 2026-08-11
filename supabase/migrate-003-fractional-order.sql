-- Tally — migration 003.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Drag-to-reorder assigns positions by taking the midpoint between two
-- neighbours, so moving a row rewrites that row alone instead of renumbering
-- every sibling. Midpoints are fractional (0.5, 2.75, …), but these columns
-- were declared `integer`, so the first drag produced:
--
--   invalid input syntax for type integer: "0.5"
--
-- Widen them to double precision to match what the client writes.

alter table public.tasks  alter column "order" type double precision;
alter table public.habits alter column "order" type double precision;
alter table public.goals  alter column "order" type double precision;

-- The quick-capture function computes an append position into a local
-- variable, which must widen too or it truncates a fractional max back to an
-- integer and lands new tasks in the wrong place.
create or replace function public.quick_add(p_token text, p_text text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_id    text;
  v_date  text;
  v_order double precision;
begin
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'empty task';
  end if;

  select user_id into v_user from quick_add_tokens where token = p_token;
  if v_user is null then
    -- Deliberately vague: a precise error would help someone guess tokens.
    raise exception 'unauthorized';
  end if;

  update quick_add_tokens set last_used = now() where token = p_token;

  v_date := to_char(now(), 'YYYY-MM-DD');
  v_id   := gen_random_uuid()::text;

  select coalesce(max("order") + 1, 0) into v_order
    from tasks
   where user_id = v_user and date = v_date and parent_id is null and deleted = 0;

  insert into tasks (id, user_id, date, time, tag, title, done, "order", updated_at, deleted)
  values (v_id, v_user, v_date, '', 'inbox', btrim(p_text), false, v_order,
          (extract(epoch from now()) * 1000)::bigint, 0);

  return json_build_object('ok', true, 'id', v_id, 'date', v_date);
end;
$$;

revoke all on function public.quick_add(text, text) from public;
grant execute on function public.quick_add(text, text) to anon, authenticated;

-- PostgREST caches the schema; a type change it hasn't noticed yet still
-- rejects the new values. Force a reload rather than waiting it out.
notify pgrst, 'reload schema';
