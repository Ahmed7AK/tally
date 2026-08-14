-- Tally — migration 005.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Habit reminders: from 18:00 local time, ping every 30 minutes until the day's
-- habits are all logged.

-- 1. Where push subscriptions live ------------------------------------------
-- Keyed by endpoint, which is what the browser hands us and what identifies a
-- device. Re-subscribing on the same device replaces its row rather than
-- accumulating dead endpoints that push would 410 on forever.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  -- The device's own zone. Reminders fire against your clock, not the
  -- server's, so travelling does not shift the 6pm boundary.
  timezone   text not null default 'UTC',
  updated_at bigint not null,
  last_sent  timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Who still owes habits today ---------------------------------------------
-- Returns one row per device that should be pinged right now. All the decision
-- logic lives here so the Edge Function stays a dumb sender: it does not need
-- to know what a habit is, only who to notify.
create or replace function public.pending_habit_reminders()
returns table (
  endpoint  text,
  p256dh    text,
  auth      text,
  remaining integer,
  total     integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with device as (
    select s.endpoint,
           s.p256dh,
           s.auth,
           s.user_id,
           s.timezone,
           (now() at time zone s.timezone)               as local_now,
           to_char(now() at time zone s.timezone, 'YYYY-MM-DD') as local_date
      from push_subscriptions s
  ),
  counted as (
    select d.*,
           (select count(*) from habits h
             where h.user_id = d.user_id and h.deleted = 0) as habit_total,
           (select count(*) from habit_logs l
             where l.user_id = d.user_id
               and l.date = d.local_date
               and l.deleted = 0
               and l.done)                                  as habit_done
      from device d
  )
  select c.endpoint,
         c.p256dh,
         c.auth,
         (c.habit_total - c.habit_done)::integer,
         c.habit_total::integer
    from counted c
   where c.habit_total > 0
     -- Evening window only: start at 18:00, give up at 22:00 rather than
     -- buzzing through the night.
     and extract(hour from c.local_now) >= 18
     and extract(hour from c.local_now) < 22
     and c.habit_done < c.habit_total;
end;
$$;

revoke all on function public.pending_habit_reminders() from public;
grant execute on function public.pending_habit_reminders() to service_role;

-- 3. Schedule ----------------------------------------------------------------
-- pg_cron ticks every 30 minutes and pg_net calls the Edge Function. The
-- function itself decides whether anyone is actually due, so the schedule can
-- stay dumb and fixed regardless of timezone.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace these two before running:
--   <PROJECT-REF>  your Supabase project ref
--   <SERVICE-ROLE-KEY>  Project Settings -> API Keys -> service_role
--
-- The service-role key bypasses RLS, so keep it server-side only. It lives in
-- this schedule and in the function's own environment, never in the client.
select cron.unschedule('tally-habit-reminders')
 where exists (select 1 from cron.job where jobname = 'tally-habit-reminders');

select cron.schedule(
  'tally-habit-reminders',
  '0,30 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/habit-reminder',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE-ROLE-KEY>'
               ),
    body    := '{}'::jsonb
  );
  $cron$
);

notify pgrst, 'reload schema';
