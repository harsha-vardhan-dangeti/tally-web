-- Regular income (a salary that arrives every month) syncs as its own kind of record.
alter table public.sync_records drop constraint sync_records_kind_check;
alter table public.sync_records add constraint sync_records_kind_check
  check (kind in ('expense', 'income', 'recurring_income', 'chip', 'budget', 'bill', 'account', 'goal', 'settings'));
