-- =============================================================
-- Shooting Range Analytics - Database Schema
-- Run this in Supabase SQL Editor (one block at a time if needed)
-- =============================================================

-- ============================================================
-- 1. USER PROFILES
-- Extends auth.users with display name, club, prefs
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- Currently selected shooting club
  club_name text,
  club_address text,
  club_place_id text,
  -- PIX settings for invoices
  pix_key text,
  pix_merchant text default 'SHOOTING RANGE',
  pix_city text default 'SAO PAULO',
  -- Pricing per caliber (jsonb so it's flexible)
  precos jsonb default '{}'::jsonb
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. ACERVO (firearm collection per user)
-- ============================================================
create table if not exists public.acervo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  arma text not null,
  calibre text not null,
  sort_order integer default 0,
  created_at timestamptz default now() not null
);

create index if not exists acervo_user_id_idx on public.acervo(user_id);
create index if not exists acervo_sort_idx on public.acervo(user_id, sort_order);

alter table public.acervo enable row level security;

drop policy if exists "Users can read own acervo" on public.acervo;
create policy "Users can read own acervo"
  on public.acervo for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own acervo" on public.acervo;
create policy "Users can insert own acervo"
  on public.acervo for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own acervo" on public.acervo;
create policy "Users can update own acervo"
  on public.acervo for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own acervo" on public.acervo;
create policy "Users can delete own acervo"
  on public.acervo for delete
  using (auth.uid() = user_id);

-- ============================================================
-- 3. TRAININGS (saved training sessions)
-- ============================================================
create table if not exists public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  trained_at timestamptz default now() not null,
  -- Club info snapshot (so we keep historical record even if user changes club)
  club_name text,
  club_address text,
  -- Sessions array (jsonb): each session has arma, calibre, disparos, pontos, quadrantes, diagnostico
  -- Photos go to Supabase Storage and we keep URLs here
  sessions jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null
);

create index if not exists trainings_user_id_idx on public.trainings(user_id);
create index if not exists trainings_user_date_idx on public.trainings(user_id, trained_at desc);

alter table public.trainings enable row level security;

drop policy if exists "Users can read own trainings" on public.trainings;
create policy "Users can read own trainings"
  on public.trainings for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own trainings" on public.trainings;
create policy "Users can insert own trainings"
  on public.trainings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own trainings" on public.trainings;
create policy "Users can update own trainings"
  on public.trainings for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own trainings" on public.trainings;
create policy "Users can delete own trainings"
  on public.trainings for delete
  using (auth.uid() = user_id);

-- ============================================================
-- 4. STORAGE BUCKET for target photos
-- (Run separately in Storage section if SQL doesn't apply)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('target-photos', 'target-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload own photos" on storage.objects;
create policy "Users can upload own photos"
  on storage.objects for insert
  with check (
    bucket_id = 'target-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read own photos" on storage.objects;
create policy "Users can read own photos"
  on storage.objects for select
  using (
    bucket_id = 'target-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own photos" on storage.objects;
create policy "Users can delete own photos"
  on storage.objects for delete
  using (
    bucket_id = 'target-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
