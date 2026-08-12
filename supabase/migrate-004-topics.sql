-- Tally — migration 004.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Topics: a commitment, organisation or area of responsibility that owns its
-- own quarterly / monthly / weekly goals, kept separate from personal ones.

create table if not exists public.topics (
  id          text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default '',
  -- Quoted: POSITION is a SQL function name. The column is still plain
  -- lowercase `position`, so the client needs no special handling.
  "position"  text not null default '',
  summary     text not null default '',
  "order"     double precision not null default 0,
  updated_at  bigint not null,
  deleted     smallint not null default 0,
  primary key (user_id, id)
);

create index if not exists topics_sync_idx on public.topics (user_id, updated_at);

-- A goal or a repeat template may belong to a topic. Plain text rather than a
-- foreign key: rows sync independently, so a goal can legitimately arrive
-- before the topic it references and a constraint would reject it.
alter table public.goals       add column if not exists topic_id text;
alter table public.recurrences add column if not exists topic_id text;

alter table public.topics enable row level security;
drop policy if exists "own rows" on public.topics;
create policy "own rows" on public.topics
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'topics'
  ) then
    alter publication supabase_realtime add table public.topics;
  end if;
end $$;

-- PostgREST caches the schema; without this it keeps rejecting the new columns.
notify pgrst, 'reload schema';
