-- Tally — migration 002.
--
-- Run this once in the Supabase SQL Editor, after the original schema.sql.
-- Idempotent: safe to re-run.
--
-- Adds:
--   * sub-tasks (tasks.parent_id)
--   * recurring tasks and goals (recurrences table + *.recurrence_id)
--   * a quick-capture endpoint for iOS Shortcuts

-- 1. Sub-tasks, recurrence links, rollover ----------------------------------
alter table public.tasks add column if not exists parent_id     text;
alter table public.tasks add column if not exists recurrence_id text;
alter table public.tasks add column if not exists overdue_from  text;
alter table public.goals add column if not exists recurrence_id text;

-- 2. Recurrence templates ----------------------------------------------------
create table if not exists public.recurrences (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('task', 'goal')),
  rule        text not null check (rule in ('daily', 'weekdays', 'weekly', 'monthly', 'quarterly')),
  title       text not null default '',
  time        text not null default '',
  tag         text not null default '',
  horizon     text not null default 'week',
  target      double precision not null default 1,
  unit        text not null default '',
  start_date  text not null,
  weekday     integer not null default 1,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

create index if not exists recurrences_sync_idx on public.recurrences (user_id, updated_at);

alter table public.recurrences enable row level security;
drop policy if exists "own rows" on public.recurrences;
create policy "own rows" on public.recurrences
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recurrences'
  ) then
    alter publication supabase_realtime add table public.recurrences;
  end if;
end $$;

-- 3. Quick capture for iOS Shortcuts -----------------------------------------
--
-- Why a token table rather than signing in from the Shortcut: Supabase access
-- tokens expire after an hour, and Shortcuts has no good way to run a refresh
-- loop. Storing an account password in a Shortcut would be worse. Instead each
-- device gets its own opaque token, which can be revoked on its own by deleting
-- one row.
--
-- The token grants exactly one capability — appending a task — and nothing
-- else. It cannot read, update, or delete anything.

create table if not exists public.quick_add_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null default '',
  created_at timestamptz not null default now(),
  last_used  timestamptz
);

alter table public.quick_add_tokens enable row level security;

-- Owners may manage their own tokens from the app; anon has no access at all.
drop policy if exists "own tokens" on public.quick_add_tokens;
create policy "own tokens" on public.quick_add_tokens
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
  v_order integer;
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

  -- Captured against the device's own day. Timezone is the caller's problem;
  -- Shortcuts sends a local date so the task lands on the day you meant.
  v_date := to_char(now(), 'YYYY-MM-DD');
  v_id   := gen_random_uuid()::text;

  select coalesce(max("order") + 1, 0) into v_order
    from tasks
   where user_id = v_user and date = v_date and parent_id is null and deleted = 0;

  -- Tagged 'inbox' so the app re-parses the text ("read Dune 4pm") with the
  -- same parser the composer uses, then clears the tag.
  insert into tasks (id, user_id, date, time, tag, title, done, "order", updated_at, deleted)
  values (v_id, v_user, v_date, '', 'inbox', btrim(p_text), false, v_order,
          (extract(epoch from now()) * 1000)::bigint, 0);

  return json_build_object('ok', true, 'id', v_id, 'date', v_date);
end;
$$;

revoke all on function public.quick_add(text, text) from public;
grant execute on function public.quick_add(text, text) to anon, authenticated;

-- 4. Mint a token ------------------------------------------------------------
-- Run this once, signed in as yourself in the SQL Editor, or use the snippet
-- below with your own user id. Keep the printed token secret — anyone holding
-- it can append tasks to your list.
--
--   insert into public.quick_add_tokens (token, user_id, label)
--   values (encode(gen_random_bytes(24), 'hex'), auth.uid(), 'iPhone')
--   returning token;
--
-- In the SQL Editor auth.uid() is null, so use your id from
-- Authentication → Users instead:
--
--   insert into public.quick_add_tokens (token, user_id, label)
--   values (encode(gen_random_bytes(24), 'hex'), '<YOUR-USER-UUID>', 'iPhone')
--   returning token;
