-- Algida Afiş Takip ek özellikleri. Supabase SQL Editor'da bir kez çalıştırın.
-- Her şube tek saha personeline atanabilir; atama yoksa eski davranış korunur.
alter table public.market_branches
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete set null;

create index if not exists market_branches_assigned_user_id_idx
  on public.market_branches(assigned_user_id);

-- Şube ataması olan saha personeli yalnızca kendisine atanmış şubelerde kayıt açabilir.
-- Mevcut RLS politikalarına ek olarak, istemci tarafındaki kontrolü veritabanı seviyesinde de destekler.
create or replace function public.is_branch_assigned_to_current_user(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.market_branches b
    where b.id = p_branch_id
      and (b.assigned_user_id is null or b.assigned_user_id = auth.uid() or public.is_admin())
  );
$$;

-- Not: poster_submissions eski şemasında branch adı metin olarak tutuluyor.
-- Bu trigger doğrular market/şube adını ve kampanya tarihini, ayrıca şube-personel atamasını.
create or replace function public.validate_poster_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_branch public.market_branches%rowtype;
  v_market public.markets%rowtype;
begin
  select * into v_campaign from public.campaigns where id = new.campaign_id;
  if not found or not v_campaign.is_active or v_campaign.ends_on < current_date then
    raise exception 'Bu kampanya pasif veya süresi dolmuş; fotoğraf gönderilemez.';
  end if;
  select b.* into v_branch
    from public.market_branches b
    join public.markets m on m.id = b.market_id
   where b.name = new.branch and m.name = new.store and b.is_active and m.is_active
   limit 1;
  if not found then raise exception 'Market/şube kaydı bulunamadı veya pasif.'; end if;
  if v_branch.assigned_user_id is not null and v_branch.assigned_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Bu şube size atanmamış.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_poster_submission on public.poster_submissions;
create trigger trg_validate_poster_submission
before insert or update of campaign_id, store, branch on public.poster_submissions
for each row execute function public.validate_poster_submission();
