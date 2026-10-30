-- Remindely: run this once in Supabase > SQL Editor (safe to run again)

-- 1) Main data table (tasks, classes, timetables, date sheets, subjects, pictures, push devices)
create table if not exists items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table items enable row level security;
revoke all on items from anon;
drop policy if exists "own rows" on items;
create policy "own rows" on items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
do $$ begin alter publication supabase_realtime add table items;
exception when duplicate_object then null; end $$;

-- 2) Push scheduler state (only the server / service role can touch it)
create table if not exists push_state (
  id int primary key default 1,
  last_run timestamptz not null default now()
);
alter table push_state enable row level security;
insert into push_state (id, last_run) values (1, now()) on conflict do nothing;

-- 3) Run the send-reminders function every minute.
--    REPLACE the two placeholders below before running this block.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'send-reminders';
select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://wuhuvxphllgssoyaizmk.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{}'::jsonb
  );
$$);
