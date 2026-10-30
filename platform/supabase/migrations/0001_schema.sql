-- 21 Agent — core schema
-- Namespaced with the a21_ prefix so it can coexist safely with other apps in the
-- shared Supabase project. All objects are owned by the database admin and are
-- accessed by the web/worker tier through the service role after an explicit
-- ownership check; browser clients get read access to their own rows via RLS.

create extension if not exists pgcrypto;

create or replace function public.a21_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.a21_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  default_model text,
  theme text not null default 'dark' check (theme in ('dark', 'graphite', 'system')),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects & cloud workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.a21_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  language text not null default 'typescript',
  template text not null default 'blank',
  repo_url text,
  default_model text,
  approval_mode text not null default 'auto' check (approval_mode in ('auto', 'writes', 'read_only')),
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists a21_projects_owner_name_uq
  on public.a21_projects (owner_id, lower(name));
create index if not exists a21_projects_owner_updated_idx
  on public.a21_projects (owner_id, updated_at desc);
create index if not exists a21_projects_owner_status_idx
  on public.a21_projects (owner_id, status);

create table if not exists public.a21_workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.a21_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'daytona',
  external_id text,
  state text not null default 'pending' check (state in ('pending', 'provisioning', 'ready', 'stopped', 'error', 'deleted')),
  root_path text not null default 'workspace',
  preview_url text,
  preview_port integer,
  resources jsonb not null default '{}'::jsonb,
  last_active_at timestamptz,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists a21_workspaces_provider_external_uq
  on public.a21_workspaces (provider, external_id)
  where external_id is not null;
create index if not exists a21_workspaces_owner_idx on public.a21_workspaces (owner_id);

-- ---------------------------------------------------------------------------
-- Conversations, messages, tasks
-- ---------------------------------------------------------------------------
create table if not exists public.a21_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.a21_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New task' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists a21_conversations_project_idx
  on public.a21_conversations (project_id, updated_at desc);

create table if not exists public.a21_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.a21_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.a21_conversations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  prompt text not null check (char_length(prompt) between 1 and 20000),
  model_id text not null,
  status text not null default 'queued' check (
    status in ('queued', 'provisioning', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled')
  ),
  progress integer not null default 0 check (progress between 0 and 100),
  iteration integer not null default 0,
  max_iterations integer not null default 24 check (max_iterations between 1 and 200),
  error text,
  summary text,
  remaining_issues jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  files_changed integer not null default 0,
  cancel_requested boolean not null default false,
  worker_id text,
  lease_expires_at timestamptz,
  attempt integer not null default 0,
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists a21_tasks_owner_created_idx
  on public.a21_tasks (owner_id, created_at desc);
create index if not exists a21_tasks_project_created_idx
  on public.a21_tasks (project_id, created_at desc);
create index if not exists a21_tasks_active_idx
  on public.a21_tasks (status)
  where status in ('queued', 'provisioning', 'running', 'waiting_approval');
create index if not exists a21_tasks_owner_status_idx
  on public.a21_tasks (owner_id, status);

create table if not exists public.a21_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.a21_conversations(id) on delete cascade,
  task_id uuid references public.a21_tasks(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content jsonb not null default '[]'::jsonb,
  model_id text,
  created_at timestamptz not null default now()
);
create index if not exists a21_messages_conversation_idx
  on public.a21_messages (conversation_id, created_at);
create index if not exists a21_messages_task_idx on public.a21_messages (task_id);

create table if not exists public.a21_task_events (
  id bigserial primary key,
  task_id uuid not null references public.a21_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text,
  tool_name text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists a21_task_events_task_id_idx
  on public.a21_task_events (task_id, id);
create index if not exists a21_task_events_owner_created_idx
  on public.a21_task_events (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- File changes, approvals, usage, settings
-- ---------------------------------------------------------------------------
create table if not exists public.a21_file_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.a21_projects(id) on delete cascade,
  task_id uuid references public.a21_tasks(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  change_type text not null check (change_type in ('create', 'update', 'delete', 'revert')),
  before_content text,
  after_content text,
  diff text,
  status text not null default 'applied' check (status in ('applied', 'reverted')),
  tool_call_id text,
  created_at timestamptz not null default now()
);
create index if not exists a21_file_changes_task_idx
  on public.a21_file_changes (task_id, created_at);
create index if not exists a21_file_changes_project_idx
  on public.a21_file_changes (project_id, created_at desc);

create table if not exists public.a21_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.a21_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  input_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists a21_approvals_pending_uq
  on public.a21_approvals (task_id, tool_name, input_hash)
  where status in ('pending', 'approved');
create index if not exists a21_approvals_task_idx on public.a21_approvals (task_id, status);

create table if not exists public.a21_usage_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.a21_projects(id) on delete set null,
  task_id uuid references public.a21_tasks(id) on delete set null,
  model_id text not null,
  provider text not null default 'openrouter',
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  total_tokens integer generated always as (prompt_tokens + completion_tokens + cache_read_tokens + cache_write_tokens) stored,
  cost_usd numeric(14, 8) not null default 0,
  pricing jsonb,
  created_at timestamptz not null default now()
);
create index if not exists a21_usage_owner_created_idx
  on public.a21_usage_records (owner_id, created_at desc);
create index if not exists a21_usage_task_idx on public.a21_usage_records (task_id);

create table if not exists public.a21_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  default_model text,
  theme text not null default 'dark' check (theme in ('dark', 'graphite', 'system')),
  monthly_token_limit integer check (monthly_token_limit is null or monthly_token_limit > 0),
  monthly_task_limit integer check (monthly_task_limit is null or monthly_task_limit > 0),
  max_concurrent_tasks integer not null default 1 check (max_concurrent_tasks between 1 and 10),
  terminal_timeout_seconds integer not null default 45 check (terminal_timeout_seconds between 5 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.a21_provider_keys (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'openrouter' check (provider = 'openrouter'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Durable queue, rate limits, audit
-- ---------------------------------------------------------------------------
create table if not exists public.a21_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.a21_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'provision', 'cleanup')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority integer not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists a21_jobs_claim_idx
  on public.a21_jobs (priority desc, run_after asc)
  where status in ('queued', 'running');
create index if not exists a21_jobs_owner_idx on public.a21_jobs (owner_id, created_at desc);

create table if not exists public.a21_rate_limits (
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (owner_id, action, window_start)
);
create index if not exists a21_rate_limits_window_idx on public.a21_rate_limits (window_start);

create table if not exists public.a21_audit_logs (
  id bigserial primary key,
  owner_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists a21_audit_logs_owner_created_idx
  on public.a21_audit_logs (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'a21_profiles', 'a21_projects', 'a21_workspaces', 'a21_conversations',
    'a21_tasks', 'a21_settings', 'a21_provider_keys', 'a21_jobs'
  ] loop
    execute format('drop trigger if exists a21_touch_updated_at on public.%I', t);
    execute format(
      'create trigger a21_touch_updated_at before update on public.%I for each row execute function public.a21_touch_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile bootstrap on signup
-- ---------------------------------------------------------------------------
create or replace function public.a21_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.a21_profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, 'builder'), '@', 1)
    ),
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists a21_on_auth_user_created on auth.users;
create trigger a21_on_auth_user_created
  after insert on auth.users
  for each row execute function public.a21_handle_new_user();

-- Backfill profiles for accounts that existed before 21 Agent was installed.
insert into public.a21_profiles (id, email, display_name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(u.email, 'builder'), '@', 1))
from auth.users u
on conflict (id) do nothing;
