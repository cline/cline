-- 21 Agent — cross-user isolation test
--
-- Run with a database role that can create fixtures (postgres / service_role).
-- Everything happens inside one transaction and is rolled back.
--
-- Expected: user A sees exactly one row in each table, and zero rows owned by
-- user B. Jobs, provider keys and audit logs are not readable by authenticated
-- users at all.

begin;

-- Replace these ids with two real auth.users ids in your project.
create temp table _a21_ids (a uuid, b uuid) on commit drop;
insert into _a21_ids values (
  'a0fa01a1-817b-44ef-b296-e60e1c8446e9',
  '984648fd-6760-45ef-8df1-e02d61fc9fd6'
);

insert into public.a21_projects (id, owner_id, name, language)
values
  ('11111111-1111-4111-8111-111111111111', (select a from _a21_ids), 'RLS test A', 'typescript'),
  ('22222222-2222-4222-8222-222222222222', (select b from _a21_ids), 'RLS test B', 'python');

insert into public.a21_workspaces (id, project_id, owner_id, state, external_id)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', (select a from _a21_ids), 'ready', 'fake-a'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', (select b from _a21_ids), 'ready', 'fake-b');

insert into public.a21_conversations (id, project_id, owner_id, title)
values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', (select a from _a21_ids), 'A conversation'),
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', (select b from _a21_ids), 'B conversation');

insert into public.a21_tasks (id, project_id, owner_id, conversation_id, title, prompt, model_id)
values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', (select a from _a21_ids), '55555555-5555-4555-8555-555555555555', 'A task', 'A prompt', 'openai/gpt-test'),
  ('88888888-8888-4888-8888-888888888888', '22222222-2222-4222-8222-222222222222', (select b from _a21_ids), '66666666-6666-4666-8666-666666666666', 'B task', 'B prompt', 'openai/gpt-test');

insert into public.a21_messages (conversation_id, task_id, owner_id, role, content)
values
  ('55555555-5555-4555-8555-555555555555', '77777777-7777-4777-8777-777777777777', (select a from _a21_ids), 'user', '[{"type":"text","text":"A"}]'),
  ('66666666-6666-4666-8666-666666666666', '88888888-8888-4888-8888-888888888888', (select b from _a21_ids), 'user', '[{"type":"text","text":"B"}]');

insert into public.a21_task_events (task_id, owner_id, type, message)
values
  ('77777777-7777-4777-8777-777777777777', (select a from _a21_ids), 'test', 'A event'),
  ('88888888-8888-4888-8888-888888888888', (select b from _a21_ids), 'test', 'B event');

insert into public.a21_file_changes (project_id, task_id, owner_id, path, change_type)
values
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', (select a from _a21_ids), 'a.ts', 'create'),
  ('22222222-2222-4222-8222-222222222222', '88888888-8888-4888-8888-888888888888', (select b from _a21_ids), 'b.py', 'create');

insert into public.a21_approvals (task_id, owner_id, tool_name, input_hash)
values
  ('77777777-7777-4777-8777-777777777777', (select a from _a21_ids), 'write_file', 'hash-a'),
  ('88888888-8888-4888-8888-888888888888', (select b from _a21_ids), 'write_file', 'hash-b');

insert into public.a21_usage_records (owner_id, task_id, model_id, prompt_tokens, completion_tokens)
values
  ((select a from _a21_ids), '77777777-7777-4777-8777-777777777777', 'openai/gpt-test', 10, 20),
  ((select b from _a21_ids), '88888888-8888-4888-8888-888888888888', 'openai/gpt-test', 30, 40);

insert into public.a21_settings (owner_id, default_model)
values ((select a from _a21_ids), 'openai/gpt-test'), ((select b from _a21_ids), 'openai/gpt-test');

insert into public.a21_jobs (task_id, owner_id, kind)
values
  ('77777777-7777-4777-8777-777777777777', (select a from _a21_ids), 'task'),
  ('88888888-8888-4888-8888-888888888888', (select b from _a21_ids), 'task');

-- Act as the first user. Set claims before switching roles so reading the
-- fixture ids does not require privileges the authenticated role does not have.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select a from _a21_ids), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select 'projects' as check, count(*) as visible, count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') as foreign_rows from public.a21_projects
union all
select 'tasks', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_tasks
union all
select 'messages', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_messages
union all
select 'task_events', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_task_events
union all
select 'file_changes', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_file_changes
union all
select 'approvals', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_approvals
union all
select 'usage_records', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_usage_records
union all
select 'settings', count(*), count(*) filter (where owner_id = '984648fd-6760-45ef-8df1-e02d61fc9fd6') from public.a21_settings;

-- Assertions: any failure raises and rolls the whole fixture back.
do $$
declare
  v_count integer;
  v_table text;
begin
  foreach v_table in array array[
    'a21_projects', 'a21_tasks', 'a21_messages', 'a21_task_events',
    'a21_file_changes', 'a21_approvals', 'a21_usage_records', 'a21_settings'
  ]
  loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    if v_count <> 1 then
      raise exception 'expected 1 visible row in %, got %', v_table, v_count;
    end if;
  end loop;

  -- Internal tables must be unreadable by browser-facing roles.
  begin
    perform 1 from public.a21_jobs limit 1;
    raise exception 'authenticated must not read a21_jobs';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.a21_provider_keys limit 1;
    raise exception 'authenticated must not read a21_provider_keys';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.a21_rate_limits limit 1;
    raise exception 'authenticated must not read a21_rate_limits';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.a21_audit_logs limit 1;
    raise exception 'authenticated must not read a21_audit_logs';
  exception when insufficient_privilege then null;
  end;

  -- Clients cannot forge ownership, mutate tasks, or truncate tables.
  begin
    insert into public.a21_projects (owner_id, name) values (auth.uid(), 'forged');
    raise exception 'authenticated must not insert projects';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.a21_tasks set status = 'succeeded'
      where id = '77777777-7777-4777-8777-777777777777';
    raise exception 'authenticated must not update tasks';
  exception when insufficient_privilege then null;
  end;

  begin
    truncate public.a21_tasks;
    raise exception 'authenticated must not truncate tables';
  exception when insufficient_privilege then null;
  end;

  raise notice 'RLS isolation checks passed';
end $$;

reset role;

rollback;
