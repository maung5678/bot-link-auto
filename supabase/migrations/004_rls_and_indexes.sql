-- This app is backend-only. Explicit deny policies document that anon and
-- authenticated clients must not read or mutate any commerce data.
create policy "backend_only_users" on public.users for all to anon, authenticated using (false) with check (false);
create policy "backend_only_links" on public.links for all to anon, authenticated using (false) with check (false);
create policy "backend_only_deliveries" on public.deliveries for all to anon, authenticated using (false) with check (false);
create policy "backend_only_packages" on public.packages for all to anon, authenticated using (false) with check (false);
create policy "backend_only_payments" on public.payments for all to anon, authenticated using (false) with check (false);
create policy "backend_only_referrals" on public.referrals for all to anon, authenticated using (false) with check (false);
create policy "backend_only_runtime_status" on public.runtime_status for all to anon, authenticated using (false) with check (false);

create index if not exists users_invited_by_idx on public.users(invited_by);
create index if not exists deliveries_link_id_idx on public.deliveries(link_id);
create index if not exists payments_package_id_idx on public.payments(package_id);
create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists referrals_inviter_user_id_idx on public.referrals(inviter_user_id);
