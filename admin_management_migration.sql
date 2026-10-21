-- Algida Afiş Takip: market, şube, kampanya-şube ve yönetici kullanıcı yönetimi
-- Supabase SQL Editor'da bir kez çalıştırın.

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.market_branches (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  name text not null,
  address text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(market_id, name)
);

create table if not exists public.campaign_branch_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  branch_id uuid not null references public.market_branches(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique(campaign_id, branch_id)
);

alter table public.markets enable row level security;
alter table public.market_branches enable row level security;
alter table public.campaign_branch_assignments enable row level security;

drop policy if exists "Authenticated users read markets" on public.markets;
create policy "Authenticated users read markets" on public.markets for select to authenticated using (true);
drop policy if exists "Admins manage markets" on public.markets;
create policy "Admins manage markets" on public.markets for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users read branches" on public.market_branches;
create policy "Authenticated users read branches" on public.market_branches for select to authenticated using (true);
drop policy if exists "Admins manage branches" on public.market_branches;
create policy "Admins manage branches" on public.market_branches for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users read campaign branch assignments" on public.campaign_branch_assignments;
create policy "Authenticated users read campaign branch assignments" on public.campaign_branch_assignments for select to authenticated using (true);
drop policy if exists "Admins manage campaign branch assignments" on public.campaign_branch_assignments;
create policy "Admins manage campaign branch assignments" on public.campaign_branch_assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Migrate existing static chain names into the new managed market list without duplicates.
insert into public.markets(name, is_active)
select distinct name, true from (values
 ('BİM'),('A101'),('ŞOK'),('CarrefourSA'),('Migros'),('Hakmar'),('Seç Market'),('Bizim Toptan')
) as defaults(name)
on conflict (name) do nothing;

-- Allow admins to load the directory for the user-management screen.
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select to authenticated using (public.is_admin());

-- Admin-only user creation is intentionally performed by the Edge Function using the service role.
-- Never expose the service-role key in the static site.
