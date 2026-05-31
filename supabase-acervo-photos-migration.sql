-- =============================================================
-- Migration: Acervo photos
-- Run in Supabase SQL Editor AFTER initial schema
-- =============================================================

-- Add photo_path column to acervo table
alter table public.acervo
  add column if not exists photo_path text;

-- Create private bucket for acervo photos
insert into storage.buckets (id, name, public)
values ('acervo-photos', 'acervo-photos', false)
on conflict (id) do nothing;

-- RLS: users can manage only their own photos (folder name = user UUID)
drop policy if exists "Users can upload own acervo photos" on storage.objects;
create policy "Users can upload own acervo photos"
  on storage.objects for insert
  with check (
    bucket_id = 'acervo-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read own acervo photos" on storage.objects;
create policy "Users can read own acervo photos"
  on storage.objects for select
  using (
    bucket_id = 'acervo-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own acervo photos" on storage.objects;
create policy "Users can update own acervo photos"
  on storage.objects for update
  using (
    bucket_id = 'acervo-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own acervo photos" on storage.objects;
create policy "Users can delete own acervo photos"
  on storage.objects for delete
  using (
    bucket_id = 'acervo-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
