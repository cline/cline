-- 21 Agent — Row Level Security
--
-- Design: the browser only ever reads its own rows. All mutations flow through
-- the Next.js API / worker, which authenticate the Supabase session and then use
-- the service role after verifying ownership. This prevents clients from
-- forging owner ids, plans, usage limits or task state. RLS is still enforced
-- for reads so a leaked anon key cannot enumerate another user's work.

alter table public.a21_profiles enable row level security;
alter table public.a21_projects enable row level security;
alter table public.a21_workspaces enable row level security;
alter table public.a21_conversations enable row level security;
alter table public.a21_tasks enable row level security;
alter table public.a21_messages enable row level security;
alter table public.a21_task_events enable row level security;
alter table public.a21_file_changes enable row level security;
alter table public.a21_approvals enable row level security;
alter table public.a21_usage_records enable row level security;
alter table public.a21_settings enable row level security;
alter table public.a21_provider_keys enable row level security;
alter table public.a21_jobs enable row level security;
alter table public.a21_rate_limits enable row level security;
alter table public.a21_audit_logs enable row level security;

-- Profiles -------------------------------------------------------------------
drop policy if exists a21_profiles_select_own on public.a21_profiles;
create policy a21_profiles_select_own on public.a21_profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists a21_profiles_update_own on public.a21_profiles;
create policy a21_profiles_update_own on public.a21_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Projects -------------------------------------------------------------------
drop policy if exists a21_projects_select_own on public.a21_projects;
create policy a21_projects_select_own on public.a21_projects
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Workspaces -----------------------------------------------------------------
drop policy if exists a21_workspaces_select_own on public.a21_workspaces;
create policy a21_workspaces_select_own on public.a21_workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Conversations --------------------------------------------------------------
drop policy if exists a21_conversations_select_own on public.a21_conversations;
create policy a21_conversations_select_own on public.a21_conversations
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Tasks ----------------------------------------------------------------------
drop policy if exists a21_tasks_select_own on public.a21_tasks;
create policy a21_tasks_select_own on public.a21_tasks
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Messages -------------------------------------------------------------------
drop policy if exists a21_messages_select_own on public.a21_messages;
create policy a21_messages_select_own on public.a21_messages
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Task events ----------------------------------------------------------------
drop policy if exists a21_task_events_select_own on public.a21_task_events;
create policy a21_task_events_select_own on public.a21_task_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- File changes ---------------------------------------------------------------
drop policy if exists a21_file_changes_select_own on public.a21_file_changes;
create policy a21_file_changes_select_own on public.a21_file_changes
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Approvals ------------------------------------------------------------------
drop policy if exists a21_approvals_select_own on public.a21_approvals;
create policy a21_approvals_select_own on public.a21_approvals
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Usage ----------------------------------------------------------------------
drop policy if exists a21_usage_records_select_own on public.a21_usage_records;
create policy a21_usage_records_select_own on public.a21_usage_records
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Settings -------------------------------------------------------------------
drop policy if exists a21_settings_select_own on public.a21_settings;
create policy a21_settings_select_own on public.a21_settings
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Provider keys, jobs, rate limits and audit logs deliberately have no
-- authenticated policies: only the service role may touch them.

-- Privileges -----------------------------------------------------------------
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

revoke insert, update, delete on public.a21_profiles from authenticated;
grant select on public.a21_profiles to authenticated;
grant update (display_name, avatar_url, theme, default_model) on public.a21_profiles to authenticated;

revoke insert, update, delete on public.a21_projects from authenticated;
revoke insert, update, delete on public.a21_workspaces from authenticated;
revoke insert, update, delete on public.a21_conversations from authenticated;
revoke insert, update, delete on public.a21_tasks from authenticated;
revoke insert, update, delete on public.a21_messages from authenticated;
revoke insert, update, delete on public.a21_task_events from authenticated;
revoke insert, update, delete on public.a21_file_changes from authenticated;
revoke insert, update, delete on public.a21_approvals from authenticated;
revoke insert, update, delete on public.a21_usage_records from authenticated;
revoke insert, update, delete on public.a21_settings from authenticated;
revoke all on public.a21_provider_keys from authenticated;
revoke all on public.a21_jobs from authenticated;
revoke all on public.a21_rate_limits from authenticated;
revoke all on public.a21_audit_logs from authenticated;

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

grant all on public.a21_profiles to service_role;
grant all on public.a21_projects to service_role;
grant all on public.a21_workspaces to service_role;
grant all on public.a21_conversations to service_role;
grant all on public.a21_tasks to service_role;
grant all on public.a21_messages to service_role;
grant all on public.a21_task_events to service_role;
grant all on public.a21_file_changes to service_role;
grant all on public.a21_approvals to service_role;
grant all on public.a21_usage_records to service_role;
grant all on public.a21_settings to service_role;
grant all on public.a21_provider_keys to service_role;
grant all on public.a21_jobs to service_role;
grant all on public.a21_rate_limits to service_role;
grant all on public.a21_audit_logs to service_role;

grant usage, select on sequence public.a21_task_events_id_seq to service_role;
grant usage, select on sequence public.a21_audit_logs_id_seq to service_role;
revoke all on sequence public.a21_task_events_id_seq from anon, authenticated;
revoke all on sequence public.a21_audit_logs_id_seq from anon, authenticated;
