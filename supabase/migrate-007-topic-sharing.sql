-- Tally — migration 007.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Read-only topic sharing.
--
-- Every table is locked to `auth.uid() = user_id`, so an anonymous visitor can
-- read nothing. Rather than loosen that, sharing goes through a SECURITY
-- DEFINER function — the same shape as quick_add, inverted. It grants exactly
-- one capability: read ONE topic and its goals, given an unguessable token.
-- Anon gets no table privileges at all, so a mistake here cannot leak tasks,
-- habits, metrics or journal entries.

alter table public.topics add column if not exists share_token    text;
alter table public.topics add column if not exists shared         smallint not null default 0;
alter table public.topics add column if not exists share_progress smallint not null default 1;
alter table public.topics add column if not exists share_summary  smallint not null default 1;

-- Tokens must be globally unique: the lookup has only the token to go on.
create unique index if not exists topics_share_token_idx
  on public.topics (share_token)
  where share_token is not null;

create or replace function public.get_shared_topic(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  t      record;
  result json;
begin
  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'not found';
  end if;

  select * into t
    from topics
   where share_token = p_token
     and shared = 1
     and deleted = 0;

  -- Same error whether the token is wrong, sharing was switched off, or the
  -- topic was deleted: none of those distinctions are a stranger's business.
  if not found then
    raise exception 'not found';
  end if;

  select json_build_object(
    'name',         t.name,
    'position',     t."position",
    'summary',      case when t.share_summary  = 1 then t.summary else null end,
    'showProgress', t.share_progress = 1,
    'goals', coalesce((
      select json_agg(
               json_build_object(
                 'horizon', g.horizon,
                 'label',   g.label,
                 'title',   g.title,
                 -- Withheld at the source rather than hidden in the client:
                 -- what must not be seen is never sent.
                 'current', case when t.share_progress = 1 then g.current else null end,
                 'target',  case when t.share_progress = 1 then g.target  else null end,
                 'unit',    case when t.share_progress = 1 then g.unit    else null end,
                 -- Completion is shown either way; it carries no numbers.
                 'done',    g.current >= g.target
               )
               order by g."order"
             )
        from goals g
       where g.user_id = t.user_id
         and g.topic_id = t.id
         and g.deleted = 0
    ), '[]'::json)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_shared_topic(text) from public;
grant execute on function public.get_shared_topic(text) to anon, authenticated;

notify pgrst, 'reload schema';
