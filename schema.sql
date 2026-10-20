-- Algida Saha: başlangıç şeması (gerçek ekip kullanımını etkinleştirmek için)
-- Bu SQL'i Supabase SQL Editor'da inceleyip çalıştırın. Storage bucket/policies ayrıca ayarlanmalı.
create extension if not exists pgcrypto;

create type public.submission_status as enum ('pending','approved','rejected');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'field' check (role in ('field','admin')),
  team text,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  stores text[] not null default '{}',
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint valid_campaign_dates check (ends_on >= starts_on)
);

create table if not exists public.poster_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  store text not null,
  branch text not null,
  photo_path text not null,
  note text,
  status public.submission_status not null default 'pending',
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.poster_submissions enable row level security;

-- Conservative starter policies. Admin role is checked against the authenticated profile.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;

create policy "Users can read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "Users can update own display name" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));
create policy "Authenticated users can read campaigns" on public.campaigns for select to authenticated using (true);
create policy "Admins manage campaigns" on public.campaigns for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Users read own submissions or admins read all" on public.poster_submissions for select to authenticated using (submitted_by = auth.uid() or public.is_admin());
create policy "Field users submit own photos" on public.poster_submissions for insert to authenticated with check (submitted_by = auth.uid());
create policy "Admins review submissions" on public.poster_submissions for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- IMPORTANT: create a private Storage bucket named `poster-photos` and add storage.objects
-- policies that restrict upload/read to authenticated users and authorized admins.
-- Do not put a service-role key in frontend code or GitHub Pages.
