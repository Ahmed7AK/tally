-- Tally — migration 010.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Gives the pull a cursor the server owns, separate from the last-write-wins
-- clock.
--
-- Why this exists: pull used to page on `updated_at`, which is epoch
-- milliseconds written by whichever *client* touched the row. The watermark a
-- device stores is therefore a reading of some other device's clock. Two
-- clocks that disagree by even a minute break the query outright: a phone
-- running a minute fast stores a watermark a minute in the future, and every
-- edit the laptop makes in that minute carries a lower `updated_at` and is
-- never returned by `updated_at > watermark` again. The row is not late — it
-- is invisible, permanently. Realtime papered over it while the phone was
-- awake, and a backgrounded phone misses those events entirely, which is
-- exactly when the loss showed up.
--
-- `synced_at` comes from a sequence instead. It has nothing to do with any
-- clock, only ever increases, and never ties — so `synced_at > watermark`
-- returns precisely the rows this device has not seen, and a full page can
-- never straddle two rows sharing a value and drop one.
--
-- `updated_at` keeps its job: deciding who wins a conflict. The two questions
-- are genuinely different — "what is new to me" is about delivery, "who wins"
-- is about intent — and one column cannot answer both.

create sequence if not exists public.sync_seq;

-- Triggers run as the caller, so every role that writes a synced row needs to
-- be able to draw from the sequence. (security definer functions such as the
-- quick-add RPC run as the owner, which already can.)
grant usage on sequence public.sync_seq to authenticated, service_role;

create or replace function public.stamp_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := nextval('public.sync_seq');
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks', 'habits', 'habit_logs', 'metrics',
    'goals', 'journal', 'recurrences', 'topics'
  ]
  loop
    execute format('alter table public.%I add column if not exists synced_at bigint', t);

    -- Backfill existing rows. The order they get is arbitrary and does not
    -- matter: the client's watermark key changes with this migration, so
    -- every device re-pulls from zero once and sees all of them anyway.
    execute format(
      'update public.%I set synced_at = nextval(''public.sync_seq'')
         where synced_at is null',
      t
    );

    execute format('alter table public.%I alter column synced_at set not null', t);

    execute format('drop trigger if exists stamp_synced_at on public.%I', t);
    execute format(
      'create trigger stamp_synced_at before insert or update on public.%I
         for each row execute function public.stamp_synced_at()',
      t
    );

    -- Pull queries now filter on (user_id, synced_at).
    execute format(
      'create index if not exists %I on public.%I (user_id, synced_at)',
      t || '_cursor_idx', t
    );
  end loop;
end;
$$;
