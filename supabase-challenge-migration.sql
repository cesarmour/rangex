-- =============================================================
-- Migration: Challenge feature
-- Run in Supabase SQL Editor
-- =============================================================

-- Add challenge stats to profiles
alter table public.profiles
  add column if not exists challenge_wins integer default 0,
  add column if not exists challenge_losses integer default 0;

-- Challenges table: registra cada duelo
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  -- Quem criou (sempre tem conta)
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Oponente: pode ser outro user com conta OU só um nome digitado
  opponent_user_id uuid references auth.users(id) on delete set null,
  opponent_name text not null,

  -- Contexto
  club_name text,
  club_address text,
  arma text,
  calibre text,
  distancia numeric,

  -- Resultados
  user_pontos integer default 0,
  user_disparos integer default 0,
  opponent_pontos integer default 0,
  opponent_disparos integer default 0,

  -- Análise dos quadrantes pra cada lado (JSON)
  user_quadrantes jsonb,
  opponent_quadrantes jsonb,

  -- Fotos (paths no storage)
  user_photo_path text,
  opponent_photo_path text,

  -- Quem ganhou: 'user' | 'opponent' | 'tie'
  winner text not null check (winner in ('user', 'opponent', 'tie'))
);

create index if not exists challenges_user_id_idx on public.challenges(user_id);
create index if not exists challenges_created_at_idx on public.challenges(created_at desc);

-- RLS
alter table public.challenges enable row level security;

drop policy if exists "Users read own challenges" on public.challenges;
create policy "Users read own challenges"
  on public.challenges for select
  using (auth.uid() = user_id);

drop policy if exists "Users create own challenges" on public.challenges;
create policy "Users create own challenges"
  on public.challenges for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own challenges" on public.challenges;
create policy "Users delete own challenges"
  on public.challenges for delete
  using (auth.uid() = user_id);

-- Storage bucket pra fotos de challenge (separado do acervo)
insert into storage.buckets (id, name, public)
values ('challenge-photos', 'challenge-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users upload own challenge photos" on storage.objects;
create policy "Users upload own challenge photos"
  on storage.objects for insert
  with check (
    bucket_id = 'challenge-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users read own challenge photos" on storage.objects;
create policy "Users read own challenge photos"
  on storage.objects for select
  using (
    bucket_id = 'challenge-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users delete own challenge photos" on storage.objects;
create policy "Users delete own challenge photos"
  on storage.objects for delete
  using (
    bucket_id = 'challenge-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Trigger pra incrementar challenge_wins/losses do criador automaticamente
create or replace function public.update_challenge_stats()
returns trigger
language plpgsql
security definer
as $func$
begin
  if NEW.winner = 'user' then
    update public.profiles
    set challenge_wins = coalesce(challenge_wins, 0) + 1
    where id = NEW.user_id;
  elsif NEW.winner = 'opponent' then
    update public.profiles
    set challenge_losses = coalesce(challenge_losses, 0) + 1
    where id = NEW.user_id;
  end if;
  return NEW;
end;
$func$;

drop trigger if exists on_challenge_created on public.challenges;
create trigger on_challenge_created
  after insert on public.challenges
  for each row
  execute function public.update_challenge_stats();

-- Atualiza a função de ranking pra incluir challenge_wins
drop function if exists public.get_ranking(text);

create or replace function public.get_ranking(p_club_name text default null)
returns table (
  id uuid,
  display_name text,
  total_trainings bigint,
  total_disparos bigint,
  total_pontos bigint,
  avg_pts_per_shot numeric,
  challenge_wins integer,
  last_training_at timestamptz
)
language sql
security definer
set search_path = public
as $func$
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
    coalesce(p.challenge_wins, 0) as challenge_wins,
    max(t.trained_at) as last_training_at
  from public.profiles p
  left join public.trainings t on t.user_id = p.id
    and (p_club_name is null or t.club_name = p_club_name)
  left join lateral jsonb_array_elements(coalesce(t.sessions, '[]'::jsonb)) s on true
  where p.show_in_ranking = true
  group by p.id, p.display_name, p.nickname, p.email, p.challenge_wins
  having p_club_name is null or count(distinct t.id) > 0;
$func$;

grant execute on function public.get_ranking(text) to authenticated;
