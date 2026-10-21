-- Algida Afiş Takip: örnek afiş ve ekip içi bildirimler için migration
-- Supabase SQL Editor'da bir kez çalıştırın.

alter table public.campaigns
  add column if not exists example_photo_path text;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  campaign_id uuid references public.campaigns(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins create team notifications" on public.notifications;
create policy "Admins create team notifications"
  on public.notifications for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Sample images use paths like {admin-user-uuid}/campaign-examples/{filename}.
-- Existing upload policy still ensures the first path segment is the uploader's user id.
drop policy if exists "Read campaign example photos" on storage.objects;
create policy "Read campaign example photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'poster-photos'
    and (storage.foldername(name))[2] = 'campaign-examples'
  );
