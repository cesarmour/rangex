-- =============================================================
-- Migration: Sanctioned duels (live, between registered users)
-- Run in Supabase SQL Editor
-- Replaces previous challenges table with a proper turn-based system
-- =============================================================

-- Drop old version if exists
drop trigger if exists on_challenge_created on public.challenges;
drop function if exists public.update_challenge_stats();
drop table if exists public.challenges cascade;

-- Add challenge stats to profiles (idempotent)
alter table public.profiles
  add column if not exists challenge_wins integer default 0,
  add column if not exists challenge_losses integer default 0;

-- Challenges table: state machine
-- States:
--   'pending'   = challenger created, waiting opponent to accept (10 min window)
--   'active'    = opponent accepted, both shooting/uploading
--   'completed' = both submitted, winner decided
--   'declined'  = opponent refused
--   'expired'   = 10 min passed without response
--   'cancelled' = challenger cancelled before opponent accepted

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid not null references auth.users(id) on delete cascade,

  -- Context
  club_name text not null,
  club_address text,
  arma text not null,
  calibre text not null,
  distancia numeric,

  -- State machine
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'declined', 'expired', 'cancelled')),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  accepted_at timestamptz,
  completed_at timestamptz,

  -- Challenger results
  challenger_pontos integer,
  challenger_disparos integer,
  challenger_quadrantes jsonb,
  challenger_photo_path text,
  challenger_submitted_at timestamptz,

  -- Opponent results
  opponent_pontos integer,
  opponent_disparos integer,
  opponent_quadrantes jsonb,
  opponent_photo_path text,
  opponent_submitted_at timestamptz,

  -- Final outcome: 'challenger' | 'opponent' | 'tie'
  winner text check (winner in ('challenger', 'opponent', 'tie')),

  -- Prevent duplicate active duels between same pair
  constraint no_self_duel check (challenger_id <> opponent_id)
);

create index if not exists challenges_challenger_idx on public.challenges(challenger_id, created_at desc);
create index if not exists challenges_opponent_idx on public.challenges(opponent_id, created_at desc);
create index if not exists challenges_pending_idx on public.challenges(opponent_id, status, expires_at) where status = 'pending';
create index if not exists challenges_active_idx on public.challenges(status, expires_at) where status in ('pending', 'active');

-- RLS
alter table public.challenges enable row level security;

drop policy if exists "challenger_or_opponent_read" on public.challenges;
create policy "challenger_or_opponent_read"
  on public.challenges for select
  using (auth.uid() = challenger_id or auth.uid() = opponent_id);

drop policy if exists "challenger_create" on public.challenges;
create policy "challenger_create"
  on public.challenges for insert
  with check (auth.uid() = challenger_id);

-- Updates handled via security-definer RPCs only (no direct update policy)

-- Storage bucket pra fotos de challenge (privado, isolado por user)
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

-- Both challenger and opponent need to read each others photos
drop policy if exists "Users read own challenge photos" on storage.objects;
drop policy if exists "Duel participants read photos" on storage.objects;
create policy "Duel participants read photos"
  on storage.objects for select
  using (
    bucket_id = 'challenge-photos'
    and exists (
      select 1 from public.challenges c
      where (c.challenger_photo_path = name or c.opponent_photo_path = name)
        and (c.challenger_id = auth.uid() or c.opponent_id = auth.uid())
    )
  );

drop policy if exists "Users delete own challenge photos" on storage.objects;
create policy "Users delete own challenge photos"
  on storage.objects for delete
  using (
    bucket_id = 'challenge-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- =============================================================
-- RPCs (security definer pra validar transitions de estado)
-- =============================================================

-- Search for potential opponents at the same club, opt-in to ranking, not self
create or replace function public.find_duel_opponents(p_club_name text, p_query text default null)
returns table (
  id uuid,
  display_name text,
  email text,
  challenge_wins integer
)
language sql
security definer
set search_path = public
as $func$
  select
    p.id,
    coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) as display_name,
    p.email,
    coalesce(p.challenge_wins, 0) as challenge_wins
  from public.profiles p
  where p.show_in_ranking = true
    and p.id <> auth.uid()
    and p.club_name = p_club_name
    and (
      p_query is null
      or p_query = ''
      or coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) ilike '%' || p_query || '%'
      or p.email ilike '%' || p_query || '%'
    )
  order by display_name
  limit 20;
$func$;

grant execute on function public.find_duel_opponents(text, text) to authenticated;

-- Create a duel (only opt-in challengers can do this)
create or replace function public.create_duel(
  p_opponent_id uuid,
  p_club_name text,
  p_club_address text,
  p_arma text,
  p_calibre text,
  p_distancia numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_challenger_optin boolean;
  v_opponent_optin boolean;
  v_opponent_club text;
  v_active_count int;
  v_new_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_opponent_id = auth.uid() then raise exception 'Não pode desafiar a si mesmo'; end if;

  -- Both must be opt-in
  select show_in_ranking into v_challenger_optin from profiles where id = auth.uid();
  if not coalesce(v_challenger_optin, false) then
    raise exception 'Você precisa ativar o ranking pra criar duelos';
  end if;

  select show_in_ranking, club_name into v_opponent_optin, v_opponent_club from profiles where id = p_opponent_id;
  if not coalesce(v_opponent_optin, false) then
    raise exception 'Esse usuário não aceita duelos (não está no ranking)';
  end if;

  -- Opponent must be in the same club
  if v_opponent_club is null or v_opponent_club <> p_club_name then
    raise exception 'O oponente precisa estar no mesmo clube (%)', p_club_name;
  end if;

  -- Block if there's already a pending/active duel between this pair
  select count(*) into v_active_count from challenges
    where status in ('pending', 'active')
      and (
        (challenger_id = auth.uid() and opponent_id = p_opponent_id)
        or
        (challenger_id = p_opponent_id and opponent_id = auth.uid())
      );
  if v_active_count > 0 then
    raise exception 'Já existe um duelo em andamento com esse oponente';
  end if;

  insert into challenges (
    challenger_id, opponent_id, club_name, club_address,
    arma, calibre, distancia, status, expires_at
  )
  values (
    auth.uid(), p_opponent_id, p_club_name, p_club_address,
    p_arma, p_calibre, p_distancia, 'pending', now() + interval '10 minutes'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$func$;

grant execute on function public.create_duel(uuid, text, text, text, text, numeric) to authenticated;

-- Opponent accepts the duel
create or replace function public.accept_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_duel challenges%rowtype;
begin
  select * into v_duel from challenges where id = p_duel_id for update;
  if not found then raise exception 'Duelo não encontrado'; end if;
  if v_duel.opponent_id <> auth.uid() then raise exception 'Você não é o oponente'; end if;
  if v_duel.status <> 'pending' then raise exception 'Duelo não está pendente'; end if;
  if v_duel.expires_at < now() then
    update challenges set status = 'expired' where id = p_duel_id;
    raise exception 'Duelo expirou';
  end if;

  update challenges
    set status = 'active', accepted_at = now(), expires_at = now() + interval '30 minutes'
    where id = p_duel_id;
end;
$func$;

grant execute on function public.accept_duel(uuid) to authenticated;

-- Opponent declines
create or replace function public.decline_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_duel challenges%rowtype;
begin
  select * into v_duel from challenges where id = p_duel_id for update;
  if not found then raise exception 'Duelo não encontrado'; end if;
  if v_duel.opponent_id <> auth.uid() then raise exception 'Você não é o oponente'; end if;
  if v_duel.status <> 'pending' then raise exception 'Duelo não está mais pendente'; end if;

  update challenges set status = 'declined' where id = p_duel_id;
end;
$func$;

grant execute on function public.decline_duel(uuid) to authenticated;

-- Challenger cancels before opponent accepts
create or replace function public.cancel_duel(p_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_duel challenges%rowtype;
begin
  select * into v_duel from challenges where id = p_duel_id for update;
  if not found then raise exception 'Duelo não encontrado'; end if;
  if v_duel.challenger_id <> auth.uid() then raise exception 'Você não é o desafiante'; end if;
  if v_duel.status not in ('pending') then raise exception 'Não pode cancelar agora'; end if;

  update challenges set status = 'cancelled' where id = p_duel_id;
end;
$func$;

grant execute on function public.cancel_duel(uuid) to authenticated;

-- Submit own result (challenger or opponent). When both submitted, mark completed.
create or replace function public.submit_duel_result(
  p_duel_id uuid,
  p_pontos integer,
  p_disparos integer,
  p_quadrantes jsonb,
  p_photo_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_duel challenges%rowtype;
  v_is_challenger boolean;
  v_other_submitted boolean;
  v_winner text;
begin
  select * into v_duel from challenges where id = p_duel_id for update;
  if not found then raise exception 'Duelo não encontrado'; end if;
  if v_duel.status <> 'active' then raise exception 'Duelo não está ativo'; end if;

  v_is_challenger := (v_duel.challenger_id = auth.uid());
  if not v_is_challenger and v_duel.opponent_id <> auth.uid() then
    raise exception 'Você não participa desse duelo';
  end if;

  if v_is_challenger then
    if v_duel.challenger_submitted_at is not null then raise exception 'Você já submeteu seu resultado'; end if;
    update challenges set
      challenger_pontos = p_pontos,
      challenger_disparos = p_disparos,
      challenger_quadrantes = p_quadrantes,
      challenger_photo_path = p_photo_path,
      challenger_submitted_at = now()
    where id = p_duel_id;
    v_other_submitted := v_duel.opponent_submitted_at is not null;
  else
    if v_duel.opponent_submitted_at is not null then raise exception 'Você já submeteu seu resultado'; end if;
    update challenges set
      opponent_pontos = p_pontos,
      opponent_disparos = p_disparos,
      opponent_quadrantes = p_quadrantes,
      opponent_photo_path = p_photo_path,
      opponent_submitted_at = now()
    where id = p_duel_id;
    v_other_submitted := v_duel.challenger_submitted_at is not null;
  end if;

  -- Both submitted? complete it
  if v_other_submitted then
    -- Re-read to get fresh data
    select * into v_duel from challenges where id = p_duel_id;

    if v_duel.challenger_pontos > v_duel.opponent_pontos then v_winner := 'challenger';
    elsif v_duel.opponent_pontos > v_duel.challenger_pontos then v_winner := 'opponent';
    else v_winner := 'tie';
    end if;

    update challenges set
      status = 'completed',
      completed_at = now(),
      winner = v_winner
    where id = p_duel_id;

    -- Update stats
    if v_winner = 'challenger' then
      update profiles set challenge_wins = coalesce(challenge_wins, 0) + 1 where id = v_duel.challenger_id;
      update profiles set challenge_losses = coalesce(challenge_losses, 0) + 1 where id = v_duel.opponent_id;
    elsif v_winner = 'opponent' then
      update profiles set challenge_wins = coalesce(challenge_wins, 0) + 1 where id = v_duel.opponent_id;
      update profiles set challenge_losses = coalesce(challenge_losses, 0) + 1 where id = v_duel.challenger_id;
    end if;
  end if;
end;
$func$;

grant execute on function public.submit_duel_result(uuid, integer, integer, jsonb, text) to authenticated;

-- List duels for the calling user (incoming pending, outgoing pending, active, history)
create or replace function public.list_my_duels(p_limit int default 50)
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  expires_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  challenger_id uuid,
  challenger_name text,
  opponent_id uuid,
  opponent_name text,
  club_name text,
  arma text,
  calibre text,
  distancia numeric,
  challenger_pontos integer,
  opponent_pontos integer,
  challenger_submitted boolean,
  opponent_submitted boolean,
  challenger_quadrantes jsonb,
  opponent_quadrantes jsonb,
  challenger_photo_path text,
  opponent_photo_path text,
  winner text,
  i_am text
)
language sql
security definer
set search_path = public
as $func$
  select
    c.id, c.created_at, c.status, c.expires_at, c.accepted_at, c.completed_at,
    c.challenger_id,
    coalesce(nullif(pc.nickname, ''), pc.display_name, split_part(pc.email, '@', 1)) as challenger_name,
    c.opponent_id,
    coalesce(nullif(po.nickname, ''), po.display_name, split_part(po.email, '@', 1)) as opponent_name,
    c.club_name, c.arma, c.calibre, c.distancia,
    c.challenger_pontos, c.opponent_pontos,
    (c.challenger_submitted_at is not null) as challenger_submitted,
    (c.opponent_submitted_at is not null) as opponent_submitted,
    c.challenger_quadrantes, c.opponent_quadrantes,
    c.challenger_photo_path, c.opponent_photo_path,
    c.winner,
    case when c.challenger_id = auth.uid() then 'challenger' else 'opponent' end as i_am
  from challenges c
  join profiles pc on pc.id = c.challenger_id
  join profiles po on po.id = c.opponent_id
  where c.challenger_id = auth.uid() or c.opponent_id = auth.uid()
  order by
    case when c.status = 'pending' then 0
         when c.status = 'active' then 1
         else 2 end,
    c.created_at desc
  limit p_limit;
$func$;

grant execute on function public.list_my_duels(int) to authenticated;

-- Sweep expired duels (called by client periodically; safe to call anytime)
create or replace function public.sweep_expired_duels()
returns void
language sql
security definer
set search_path = public
as $func$
  update challenges
    set status = 'expired'
    where status = 'pending'
      and expires_at < now();
$func$;

grant execute on function public.sweep_expired_duels() to authenticated;
