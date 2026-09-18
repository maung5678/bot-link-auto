alter table public.payments add column if not exists stripe_charge_id text;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check(status in ('pending','paid','cancelled','refunded','disputed'));
