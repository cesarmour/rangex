-- =============================================================
-- Migration: Ranking feature
-- Run in Supabase SQL Editor AFTER the initial schema
-- =============================================================

-- Add opt-in and nickname columns to profiles
alter table public.profiles
  add column if not exists show_in_ranking boolean default false,
  add column if not exists nickname text;

-- Aggregated ranking view (computed across opt-in users only)
-- Uses a security definer function to bypass RLS on trainings/profiles
-- but still only exposes opt-in profiles.

create or replace function public.get_ranking()
returns table (
  id uuid,
  display_name text,
  total_trainings bigint,
  total_disparos bigint,
  total_pontos bigint,
  avg_pts_per_shot numeric,
  last_training_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) as display_name,
    count(distinct t.id) as total_trainings,
    coalesce(sum((s.value->>'disparos')::int), 0)::bigint as total_disparos,
    coalesce(sum((s.value->>'pontos')::int), 0)::bigint as total_pontos,
    case
      when coalesce(sum((s.value->>'disparos')::int), 0) = 0 then 0
      else round(
        coalesce(sum((s.value->>'pontos')::int), 0)::numeric /
        nullif(coalesce(sum((s.value->>'disparos')::int), 0), 0)::numeric,
        2
      )
    end as avg_pts_per_shot,
    max(t.trained_at) as last_training_at
  from public.profiles p
  left join public.trainings t on t.user_id = p.id
  left join lateral jsonb_array_elements(coalesce(t.sessions, '[]'::jsonb)) s on true
  where p.show_in_ranking = true
  group by p.id, p.display_name, p.nickname, p.email;
$$;

-- Allow any authenticated user to call this function (they see only opt-in users)
grant execute on function public.get_ranking() to authenticated;
