-- Tally — migration 009.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Lets an iOS Shortcuts time automation ask "how many habits are left today?"
-- and raise its own notification, with no web push involved.
--
-- Why this exists: an installed iOS PWA cannot schedule a local notification
-- for a future time. setTimeout dies when the web view is suspended, Safari
-- never shipped the Notification Triggers API, and Background Sync is
-- unsupported. A service worker only runs when something wakes it, and while
-- the app is closed the only thing that can is an incoming push.
--
-- Shortcuts automations, by contrast, are run by iOS itself at a set time. So
-- the schedule lives on the phone and this only answers a question.
--
-- Reuses the quick-capture tokens, so no new credential to manage.

create or replace function public.habit_status(p_token text, p_timezone text default 'UTC')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_date  text;
  v_total integer;
  v_done  integer;
begin
  select user_id into v_user from quick_add_tokens where token = p_token;
  if v_user is null then
    raise exception 'unauthorized';
  end if;

  -- An unknown zone would raise; fall back rather than fail the automation.
  begin
    v_date := to_char(now() at time zone p_timezone, 'YYYY-MM-DD');
  exception when others then
    v_date := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  end;

  select count(*) into v_total
    from habits
   where user_id = v_user and deleted = 0;

  select count(*) into v_done
    from habit_logs
   where user_id = v_user
     and date = v_date
     and deleted = 0
     and done;

  return json_build_object(
    'date',      v_date,
    'total',     v_total,
    'done',      v_done,
    'remaining', greatest(v_total - v_done, 0),
    -- Pre-built so the Shortcut can show it without any text wrangling.
    'message',   case
                   when v_total = 0 then 'No habits set up yet.'
                   when v_total - v_done <= 0 then 'All habits logged today.'
                   when v_total - v_done = 1 then '1 habit left to log today.'
                   else (v_total - v_done) || ' habits left to log today.'
                 end
  );
end;
$$;

revoke all on function public.habit_status(text, text) from public;
grant execute on function public.habit_status(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
