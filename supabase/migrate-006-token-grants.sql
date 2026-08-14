-- Tally — migration 006.
--
-- Run this once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Quick-capture tokens are now created and revoked from inside the app instead
-- of by pasting SQL and copying the result out by hand — a step that failed
-- silently, because a token that was never created and a token that was
-- mistyped both surface as the same "unauthorized".
--
-- Row-level security already restricts these rows to their owner. This grants
-- the table privileges that RLS then filters; without them the app gets a
-- permission error rather than an empty list.

grant select, insert, delete on public.quick_add_tokens to authenticated;

-- anon must never touch the table. The quick_add() function reads it with
-- SECURITY DEFINER, which is how the Shortcut authenticates without ever
-- needing read access of its own.
revoke all on public.quick_add_tokens from anon;

-- Belt and braces: RLS is what actually enforces ownership.
alter table public.quick_add_tokens enable row level security;

drop policy if exists "own tokens" on public.quick_add_tokens;
create policy "own tokens" on public.quick_add_tokens
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
