-- Tally — server schema.
--
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- It is idempotent, so re-running it after a change is safe.
--
-- Shape notes:
--   * ids are text, generated on the client, so a row can be created offline
--     and keep its identity when it syncs.
--   * updated_at is epoch milliseconds (bigint), written by the client. Sync is
--     last-write-wins on this value, so both devices must agree on its meaning
--     — hence a plain number rather than a server-side timestamp default.
--   * "order" is double precision, not integer. Reordering assigns the midpoint
--     between two neighbours so a move rewrites one row rather than renumbering
--     the list, and midpoints are fractional.
--   * deleted is a tombstone. Rows are never hard-deleted, because a hard
--     delete cannot propagate to a device that is currently offline.
--   * Every table is scoped by user_id with row-level security, so one account
--     can never read or write another's rows.

-- Tasks ----------------------------------------------------------------------
create table if not exists public.tasks (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        text not null,
  time        text not null default '',
  tag         text not null default '',
  title       text not null default '',
  done        boolean not null default false,
  "order"     double precision not null default 0,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Habits ---------------------------------------------------------------------
create table if not exists public.habits (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default '',
  short       text not null default '',
  "order"     double precision not null default 0,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Habit logs -----------------------------------------------------------------
-- id is "<date>:<habitId>", so two devices ticking the same habit on the same
-- day converge on one row instead of creating duplicates.
create table if not exists public.habit_logs (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        text not null,
  habit_id    text not null,
  done        boolean not null default false,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Daily metrics --------------------------------------------------------------
-- id is the ISO date: one row per day by construction.
create table if not exists public.metrics (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        text not null,
  weight      double precision,
  hours       double precision,
  screen      double precision,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Goals ----------------------------------------------------------------------
create table if not exists public.goals (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  horizon     text not null check (horizon in ('quarter', 'month', 'week')),
  label       text not null default '',
  title       text not null default '',
  current     double precision not null default 0,
  target      double precision not null default 1,
  unit        text not null default '',
  "order"     double precision not null default 0,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Journal --------------------------------------------------------------------
-- id is the ISO date.
create table if not exists public.journal (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        text not null,
  best        text not null default '',
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

-- Pull queries always filter on (user_id, updated_at).
create index if not exists tasks_sync_idx      on public.tasks      (user_id, updated_at);
create index if not exists habits_sync_idx     on public.habits     (user_id, updated_at);
create index if not exists habit_logs_sync_idx on public.habit_logs (user_id, updated_at);
create index if not exists metrics_sync_idx    on public.metrics    (user_id, updated_at);
create index if not exists goals_sync_idx      on public.goals      (user_id, updated_at);
create index if not exists journal_sync_idx    on public.journal    (user_id, updated_at);

-- Row-level security ---------------------------------------------------------
-- One policy per table: you may touch a row if, and only if, it is yours.
do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'habits', 'habit_logs', 'metrics', 'goals', 'journal']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I
         for all
         to authenticated
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- Realtime -------------------------------------------------------------------
-- Lets a change on one device appear on the other without waiting for a poll.
do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'habits', 'habit_logs', 'metrics', 'goals', 'journal']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
