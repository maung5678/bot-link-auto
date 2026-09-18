create extension if not exists pgcrypto;

create table if not exists public.users (
  telegram_id text primary key,
  username text,
  display_name text,
  referral_code text unique not null,
  invited_by text references public.users(telegram_id),
  terms_accepted boolean not null default false,
  credits integer not null default 0 check (credits >= 0),
  subscription_until timestamptz,
  stripe_customer_id text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.links (
  id bigint generated always as identity primary key,
  start_url text,
  note_url text,
  file_video_url text,
  telegram_url text unique not null,
  source_chat_id text,
  source_message_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id bigint generated always as identity primary key,
  user_id text not null references public.users(telegram_id),
  link_id bigint not null references public.links(id),
  used_credit boolean not null default false,
  delivered_at timestamptz not null default now(),
  unique(user_id, link_id)
);

create table if not exists public.packages (
  id text primary key,
  name text not null,
  description text not null default '',
  kind text not null check(kind in ('credits','subscription')),
  price_thb integer not null check(price_thb > 0),
  credits integer not null default 0,
  days integer not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(telegram_id),
  package_id text not null references public.packages(id),
  amount_thb integer not null,
  status text not null default 'pending' check(status in ('pending','paid','cancelled','refunded','disputed')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_event_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.referrals (
  invited_user_id text primary key references public.users(telegram_id),
  inviter_user_id text not null references public.users(telegram_id),
  joined_rewarded boolean not null default false,
  purchase_rewarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.runtime_status (
  name text primary key,
  status text not null,
  detail text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.packages(id,name,description,kind,price_thb,credits,days,sort_order) values
  ('credit_5','5 เครดิต','สุ่มลิงก์ได้ 5 ครั้ง','credits',49,5,0,10),
  ('credit_15','15 เครดิต','สุ่มลิงก์ได้ 15 ครั้ง','credits',99,15,0,20),
  ('week','สมาชิก 7 วัน','สุ่มลิงก์ได้ไม่จำกัด 7 วัน','subscription',149,0,7,30),
  ('month','สมาชิก 30 วัน','สุ่มลิงก์ได้ไม่จำกัด 30 วัน','subscription',399,0,30,40)
on conflict(id) do nothing;

alter table public.users enable row level security;
alter table public.links enable row level security;
alter table public.deliveries enable row level security;
alter table public.packages enable row level security;
alter table public.payments enable row level security;
alter table public.referrals enable row level security;
alter table public.runtime_status enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

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

create or replace function public.claim_random_link(p_user_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user public.users%rowtype; v_link public.links%rowtype; v_subscribed boolean;
begin
  select * into v_user from public.users where telegram_id=p_user_id for update;
  if not found or not v_user.terms_accepted or v_user.blocked then return jsonb_build_object('error','not_allowed'); end if;
  v_subscribed := v_user.subscription_until is not null and v_user.subscription_until > now();
  if not v_subscribed and v_user.credits < 1 then return jsonb_build_object('error','no_credit'); end if;
  select l.* into v_link from public.links l where l.active and not exists
    (select 1 from public.deliveries d where d.user_id=p_user_id and d.link_id=l.id)
    order by random() limit 1 for update skip locked;
  if not found then return jsonb_build_object('error','no_link'); end if;
  if not v_subscribed then update public.users set credits=credits-1,updated_at=now() where telegram_id=p_user_id; end if;
  insert into public.deliveries(user_id,link_id,used_credit) values(p_user_id,v_link.id,not v_subscribed);
  return jsonb_build_object('telegram_url',v_link.telegram_url,'credits',case when v_subscribed then v_user.credits else v_user.credits-1 end,'subscribed',v_subscribed);
end $$;

create or replace function public.accept_terms_and_reward(p_user_id text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_ref public.referrals%rowtype;
begin
  update public.users set terms_accepted=true,updated_at=now() where telegram_id=p_user_id;
  select * into v_ref from public.referrals where invited_user_id=p_user_id and not joined_rewarded for update;
  if found then
    update public.users set credits=credits+1,updated_at=now() where telegram_id=v_ref.inviter_user_id;
    update public.referrals set joined_rewarded=true where invited_user_id=p_user_id;
  end if;
end $$;

create or replace function public.fulfill_payment(p_payment_id uuid,p_event_id text,p_intent_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_payment public.payments%rowtype; v_package public.packages%rowtype; v_ref public.referrals%rowtype; v_until timestamptz;
begin
  select * into v_payment from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('error','payment_not_found'); end if;
  if v_payment.status='paid' then return jsonb_build_object('user_id',v_payment.user_id,'already_paid',true); end if;
  select * into v_package from public.packages where id=v_payment.package_id;
  update public.payments set status='paid',stripe_event_id=p_event_id,stripe_payment_intent_id=p_intent_id,paid_at=now() where id=p_payment_id;
  if v_package.kind='credits' then
    update public.users set credits=credits+v_package.credits,updated_at=now() where telegram_id=v_payment.user_id;
  else
    select greatest(coalesce(subscription_until,now()),now()) + make_interval(days=>v_package.days) into v_until from public.users where telegram_id=v_payment.user_id;
    update public.users set subscription_until=v_until,updated_at=now() where telegram_id=v_payment.user_id;
  end if;
  select * into v_ref from public.referrals where invited_user_id=v_payment.user_id and not purchase_rewarded for update;
  if found then
    update public.users set credits=credits+3,updated_at=now() where telegram_id=v_ref.inviter_user_id;
    update public.referrals set purchase_rewarded=true where invited_user_id=v_payment.user_id;
  end if;
  return jsonb_build_object('user_id',v_payment.user_id,'package_name',v_package.name,'already_paid',false);
end $$;

revoke all on function public.claim_random_link(text) from public, anon, authenticated;
revoke all on function public.accept_terms_and_reward(text) from public, anon, authenticated;
revoke all on function public.fulfill_payment(uuid,text,text) from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.claim_random_link(text) to service_role;
grant execute on function public.accept_terms_and_reward(text) to service_role;
grant execute on function public.fulfill_payment(uuid,text,text) to service_role;
