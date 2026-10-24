-- Tally sync: every record a person keeps in Tally (expenses, income, budgets, bills, accounts,
-- goals, repeats and settings) as one JSON document per row, owned by the signed-in user.
--
-- Devices keep working offline on their own copy and exchange changes with this table:
--   * push: public.sync_push() upserts a batch; the newest edit (changed_at) wins.
--   * pull: select rows with synced_at after the device's cursor. synced_at is the server's
--     clock, so a device with a wrong clock can't hide changes from the others.
-- Deletions are kept as rows with deleted = true, so other devices learn about them.

create table public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null
    constraint sync_records_kind_check
    check (kind in ('expense', 'income', 'chip', 'budget', 'bill', 'account', 'goal', 'settings')),
  record_id text not null
    constraint sync_records_record_id_check check (char_length(record_id) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  -- When the person made the change, from their device. Decides which edit wins.
  changed_at timestamptz not null,
  -- When the server stored it. Devices pull everything after their last cursor.
  synced_at timestamptz not null default now(),
  primary key (user_id, kind, record_id),
  constraint sync_records_data_present check (deleted or data is not null),
  constraint sync_records_data_size check (data is null or pg_column_size(data) <= 65536)
);

comment on table public.sync_records is 'Tally records synced between a person''s devices. One JSON document per record.';

-- Pulls read one person's rows in server-time order.
create index sync_records_user_synced_idx on public.sync_records (user_id, synced_at);

-- The server sets synced_at; clients can't backdate it.
create function public.sync_records_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

create trigger sync_records_stamp
  before insert or update on public.sync_records
  for each row execute function public.sync_records_stamp();

revoke execute on function public.sync_records_stamp() from public, anon, authenticated;

-- Row-level security: each person reads and writes only their own rows.
alter table public.sync_records enable row level security;

create policy "Read own records" on public.sync_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own records" on public.sync_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Change own records" on public.sync_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Remove own records" on public.sync_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.sync_records from anon, public;
grant select, insert, update, delete on table public.sync_records to authenticated;

-- Push a batch of changes. Runs as the caller (security invoker), so the policies above apply.
-- A change only replaces a stored row when it is newer; replaying a batch is harmless.
-- changed_at is capped a few minutes ahead of server time so one fast clock can't freeze a record.
create function public.sync_push(changes jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stored integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to sync' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'Send between 0 and 500 changes per batch' using errcode = '22023';
  end if;

  insert into public.sync_records as r (user_id, kind, record_id, data, deleted, changed_at)
  select
    (select auth.uid()),
    c.kind,
    c.record_id,
    case when coalesce(c.deleted, false) then null else c.data end,
    coalesce(c.deleted, false),
    least(c.changed_at, now() + interval '5 minutes')
  from jsonb_to_recordset(changes) as c (kind text, record_id text, data jsonb, deleted boolean, changed_at timestamptz)
  on conflict (user_id, kind, record_id) do update
    set data = excluded.data,
        deleted = excluded.deleted,
        changed_at = excluded.changed_at
    where excluded.changed_at > r.changed_at;

  get diagnostics stored = row_count;
  return stored;
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
