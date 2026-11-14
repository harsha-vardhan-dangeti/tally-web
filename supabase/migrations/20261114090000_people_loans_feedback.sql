-- People (money lent, borrowed and paid back) and loans sync as their own kinds of record.
alter table public.sync_records drop constraint sync_records_kind_check;
alter table public.sync_records add constraint sync_records_kind_check
  check (kind in ('expense', 'income', 'recurring_income', 'chip', 'budget', 'bill', 'account', 'goal', 'transfer', 'ledger', 'loan', 'settings'));

-- Anonymous usage counts, crash reports and feedback, written only by the /api/collect function
-- (service role). Browsers can't read or write these tables: RLS is on with no policies, and the
-- anon and authenticated roles have no privileges on them.

create table public.usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device text not null check (char_length(device) between 8 and 64),
  event text not null check (event ~ '^[a-z_]{2,40}$'),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) < 1000),
  release text check (char_length(release) <= 40),
  lang text check (char_length(lang) <= 8)
);
create index usage_events_created_at_idx on public.usage_events (created_at);
create index usage_events_event_created_at_idx on public.usage_events (event, created_at);

create table public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device text check (char_length(device) <= 64),
  message text not null check (char_length(message) between 1 and 500),
  stack text check (char_length(stack) <= 4000),
  path text check (char_length(path) <= 200),
  release text check (char_length(release) <= 40),
  user_agent text check (char_length(user_agent) <= 300)
);
create index client_errors_created_at_idx on public.client_errors (created_at);

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device text check (char_length(device) <= 64),
  mood text check (mood in ('love', 'okay', 'problem')),
  message text not null check (char_length(message) between 1 and 4000),
  email text check (char_length(email) <= 320),
  path text check (char_length(path) <= 200),
  release text check (char_length(release) <= 40),
  user_agent text check (char_length(user_agent) <= 300)
);
create index feedback_created_at_idx on public.feedback (created_at);

alter table public.usage_events enable row level security;
alter table public.client_errors enable row level security;
alter table public.feedback enable row level security;

revoke all on table public.usage_events, public.client_errors, public.feedback from anon, authenticated;
grant select, insert, delete on table public.usage_events, public.client_errors, public.feedback to service_role;

-- Daily active devices and event counts, for the dashboard's SQL editor.
create view public.usage_daily with (security_invoker = true) as
  select (created_at at time zone 'Asia/Kolkata')::date as day, event, count(*) as events, count(distinct device) as devices
  from public.usage_events
  group by 1, 2;
revoke all on table public.usage_daily from anon, authenticated;
grant select on table public.usage_daily to service_role;
