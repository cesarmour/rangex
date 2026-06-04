-- =============================================================
-- Migration: Ranking with club filter
-- Run in Supabase SQL Editor
-- Replaces previous get_ranking() with version that supports filtering
-- =============================================================

-- Drop old function to recreate with new signature
drop function if exists public.get_ranking();
drop function if exists public.get_ranking(text);

create or replace function public.get_ranking(p_club_name text default null)
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
    and (p_club_name is null or t.club_name = p_club_name)
  left join lateral jsonb_array_elements(coalesce(t.sessions, '[]'::jsonb)) s on true
  where p.show_in_ranking = true
  group by p.id, p.display_name, p.nickname, p.email
  having p_club_name is null or count(distinct t.id) > 0;
$$;

grant execute on function public.get_ranking(text) to authenticated;

-- Helper function to list all clubs that have ranking-visible activity
-- (useful for future "select any club" feature)
create or replace function public.get_ranking_clubs()
returns table (club_name text, user_count bigint, training_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    t.club_name,
    count(distinct t.user_id) as user_count,
    count(distinct t.id) as training_count
  from public.trainings t
  inner join public.profiles p on p.id = t.user_id
  where p.show_in_ranking = true
    and t.club_name is not null
    and t.club_name <> ''
  group by t.club_name
  order by training_count desc;
$$;

grant execute on function public.get_ranking_clubs() to authenticated;
