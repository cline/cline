-- 21 Agent — least-privilege grants
--
-- Supabase's default privileges grant ALL on new public tables to anon and
-- authenticated. Revoking INSERT/UPDATE/DELETE alone leaves TRUNCATE,
-- REFERENCES and TRIGGER behind, and TRUNCATE is not subject to RLS. Remove
-- every default privilege from the browser-facing roles, then grant back only
-- the read surface the product needs.

do $$
declare
  t text;
begin
  foreach t in array array[
    'a21_profiles', 'a21_projects', 'a21_workspaces', 'a21_conversations',
    'a21_tasks', 'a21_messages', 'a21_task_events', 'a21_file_changes',
    'a21_approvals', 'a21_usage_records', 'a21_settings', 'a21_provider_keys',
    'a21_jobs', 'a21_rate_limits', 'a21_audit_logs'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Read-only surface for signed-in users. RLS policies still restrict every
-- row to auth.uid(); the worker/service role is the only writer.
grant select on public.a21_profiles to authenticated;
grant select on public.a21_projects to authenticated;
grant select on public.a21_workspaces to authenticated;
grant select on public.a21_conversations to authenticated;
grant select on public.a21_tasks to authenticated;
grant select on public.a21_messages to authenticated;
grant select on public.a21_task_events to authenticated;
grant select on public.a21_file_changes to authenticated;
grant select on public.a21_approvals to authenticated;
grant select on public.a21_usage_records to authenticated;
grant select on public.a21_settings to authenticated;

-- Profile settings can be edited directly by the owner, but only these
-- columns. plan, email and id remain service-role only.
grant update (display_name, avatar_url, theme, default_model)
  on public.a21_profiles to authenticated;

-- No anon access to anything in the 21 Agent namespace.
revoke all on public.a21_profiles from anon;
revoke all on public.a21_projects from anon;
revoke all on public.a21_workspaces from anon;
revoke all on public.a21_conversations from anon;
revoke all on public.a21_tasks from anon;
revoke all on public.a21_messages from anon;
revoke all on public.a21_task_events from anon;
revoke all on public.a21_file_changes from anon;
revoke all on public.a21_approvals from anon;
revoke all on public.a21_usage_records from anon;
revoke all on public.a21_settings from anon;
revoke all on public.a21_provider_keys from anon;
revoke all on public.a21_jobs from anon;
revoke all on public.a21_rate_limits from anon;
revoke all on public.a21_audit_logs from anon;

-- Sequences are internal; clients never insert rows.
revoke all on sequence public.a21_task_events_id_seq from anon, authenticated;
revoke all on sequence public.a21_audit_logs_id_seq from anon, authenticated;

-- Trigger functions and queue/rate-limit functions are not client RPCs.
revoke execute on function public.a21_handle_new_user() from public, anon, authenticated;
revoke execute on function public.a21_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.a21_claim_job(text, integer) from public, anon, authenticated;
revoke execute on function public.a21_heartbeat_job(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.a21_finish_job(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.a21_retry_job(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.a21_consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.a21_usage_summary(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.a21_claim_job(text, integer) to service_role;
grant execute on function public.a21_heartbeat_job(uuid, text, integer) to service_role;
grant execute on function public.a21_finish_job(uuid, text, text, text) to service_role;
grant execute on function public.a21_retry_job(uuid, text, text, integer) to service_role;
grant execute on function public.a21_consume_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function public.a21_usage_summary(uuid, timestamptz) to service_role;
