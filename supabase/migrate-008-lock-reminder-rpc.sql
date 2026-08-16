-- Tally — migration 008. Security fix. Run this one.
--
-- pending_habit_reminders() returns push endpoints together with their p256dh
-- and auth secrets — everything needed to send a notification to the device.
-- It was meant for service_role alone, and migration 005 said:
--
--   revoke all on function public.pending_habit_reminders() from public;
--   grant execute on function public.pending_habit_reminders() to service_role;
--
-- That is not enough. Supabase sets default privileges granting EXECUTE on new
-- functions to anon and authenticated directly, and revoking from PUBLIC does
-- not remove a direct grant. Probing the deployed project with the (public)
-- anon key returned HTTP 200 rather than a permission error, which means any
-- visitor could have read those push credentials once a device subscribed —
-- and used them to push arbitrary notifications to the phone.
--
-- Revoke the direct grants explicitly.

revoke all on function public.pending_habit_reminders() from anon, authenticated;

-- Belt and braces: re-assert the intended state.
revoke all on function public.pending_habit_reminders() from public;
grant execute on function public.pending_habit_reminders() to service_role;

-- The other two SECURITY DEFINER functions are anon-callable on purpose. Both
-- require an unguessable token and return only what that token unlocks, so
-- they stay as they are:
--   quick_add(p_token, p_text)  -> appends one task
--   get_shared_topic(p_token)   -> reads one shared topic

notify pgrst, 'reload schema';
