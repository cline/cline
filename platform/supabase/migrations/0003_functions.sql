-- 21 Agent — durable queue and server-side guard functions
-- These are SECURITY DEFINER and executable only by the service role.

-- Claim one queued (or expired-lease) job atomically.
create or replace function public.a21_claim_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.a21_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease seconds out of range';
  end if;

  select j.id into claimed_id
  from public.a21_jobs j
  where (j.status = 'queued' and j.run_after <= now())
     or (j.status = 'running' and j.lease_expires_at is not null and j.lease_expires_at < now())
  order by j.priority desc, j.run_after asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.a21_jobs j
     set status = 'running',
         locked_by = p_worker_id,
         locked_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = j.attempts + 1,
         updated_at = now()
   where j.id = claimed_id
   returning j.*;
end;
$$;

create or replace function public.a21_heartbeat_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  update public.a21_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_job_id and status = 'running' and locked_by = p_worker_id;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

create or replace function public.a21_finish_job(
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid terminal job status %', p_status;
  end if;
  update public.a21_jobs
     set status = p_status,
         locked_by = null,
         lease_expires_at = null,
         last_error = p_error,
         updated_at = now()
   where id = p_job_id and status = 'running' and locked_by = p_worker_id;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

create or replace function public.a21_retry_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_delay_seconds integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if p_delay_seconds < 0 or p_delay_seconds > 3600 then
    raise exception 'delay out of range';
  end if;
  update public.a21_jobs
     set status = 'queued',
         locked_by = null,
         locked_at = null,
         lease_expires_at = null,
         last_error = left(coalesce(p_error, ''), 2000),
         run_after = now() + make_interval(secs => p_delay_seconds),
         updated_at = now()
   where id = p_job_id and locked_by = p_worker_id;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- Fixed-window rate limiter. Returns true when the call is allowed.
create or replace function public.a21_consume_rate_limit(
  p_owner_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz;
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit configuration';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.a21_rate_limits (owner_id, action, window_start, count)
  values (p_owner_id, p_action, window_start, 1)
  on conflict (owner_id, action, window_start)
  do update set count = public.a21_rate_limits.count + 1
  returning count into current_count;

  -- Opportunistic cleanup of old windows.
  delete from public.a21_rate_limits
   where owner_id = p_owner_id
     and window_start < now() - interval '1 day';

  return current_count <= p_limit;
end;
$$;

-- Aggregate helper used by the usage page; service role only.
create or replace function public.a21_usage_summary(
  p_owner_id uuid,
  p_since timestamptz
)
returns table (
  total_tokens bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  cost_usd numeric,
  task_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(sum(u.total_tokens), 0)::bigint,
    coalesce(sum(u.prompt_tokens), 0)::bigint,
    coalesce(sum(u.completion_tokens), 0)::bigint,
    coalesce(sum(u.cost_usd), 0)::numeric,
    count(distinct u.task_id)::bigint
  from public.a21_usage_records u
  where u.owner_id = p_owner_id and u.created_at >= p_since;
$$;

revoke all on function public.a21_claim_job(text, integer) from public, anon, authenticated;
revoke all on function public.a21_heartbeat_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.a21_finish_job(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.a21_retry_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.a21_consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.a21_usage_summary(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.a21_claim_job(text, integer) to service_role;
grant execute on function public.a21_heartbeat_job(uuid, text, integer) to service_role;
grant execute on function public.a21_finish_job(uuid, text, text, text) to service_role;
grant execute on function public.a21_retry_job(uuid, text, text, integer) to service_role;
grant execute on function public.a21_consume_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function public.a21_usage_summary(uuid, timestamptz) to service_role;
