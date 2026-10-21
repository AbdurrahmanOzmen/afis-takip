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

-- Kampanyanın hedef marketi dışında afiş gönderilmesini veritabanı seviyesinde de engelle.
create or replace function public.validate_submission_campaign_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campaign_stores text[];
  campaign_active boolean;
begin
  select stores, is_active
    into campaign_stores, campaign_active
    from public.campaigns
   where id = new.campaign_id;

  if not found then
    raise exception 'Seçilen kampanya bulunamadı.';
  end if;
  if campaign_active is distinct from true then
    raise exception 'Pasif kampanyaya afiş gönderilemez.';
  end if;
  -- Boş stores dizisi eski kayıtlarla uyumluluk için tüm marketler anlamına gelir.
  if cardinality(coalesce(campaign_stores, array[]::text[])) > 0
     and not (new.store = any(campaign_stores)) then
    raise exception 'Seçilen market bu kampanyanın hedef marketleri arasında değil.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_submission_campaign_store_trigger on public.poster_submissions;
create trigger validate_submission_campaign_store_trigger
before insert or update of campaign_id, store
on public.poster_submissions
for each row execute function public.validate_submission_campaign_store();
