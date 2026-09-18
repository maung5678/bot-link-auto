-- The backend already authenticates as service_role, which bypasses RLS.
-- Keep RPCs invoker-safe so no exposed function runs with its owner's privileges.
alter function public.claim_random_link(text) security invoker;
alter function public.accept_terms_and_reward(text) security invoker;
alter function public.fulfill_payment(uuid,text,text) security invoker;

revoke all on function public.claim_random_link(text) from public, anon, authenticated;
revoke all on function public.accept_terms_and_reward(text) from public, anon, authenticated;
revoke all on function public.fulfill_payment(uuid,text,text) from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.claim_random_link(text) to service_role;
grant execute on function public.accept_terms_and_reward(text) to service_role;
grant execute on function public.fulfill_payment(uuid,text,text) to service_role;
