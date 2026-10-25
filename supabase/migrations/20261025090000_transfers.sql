-- Transfers between a user's own accounts sync as their own kind of record.
alter table public.sync_records drop constraint sync_records_kind_check;
alter table public.sync_records add constraint sync_records_kind_check
  check (kind in ('expense', 'income', 'recurring_income', 'chip', 'budget', 'bill', 'account', 'goal', 'transfer', 'settings'));
