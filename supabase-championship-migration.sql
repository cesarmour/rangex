-- =============================================================
-- Migration: Campeonatos (setup, juiz de prova/IAT, submissoes, ranking)
-- Run in Supabase SQL Editor
-- =============================================================

-- Badge de Juiz de Prova/IAT no perfil (ganha ao aceitar convite)
alter table public.profiles
  add column if not exists judge_badge boolean default false;

-- ============================================================
-- Tabelas
-- ============================================================

create table if not exists public.championships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now() not null,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  name text not null,

  -- Setup obrigatorio
  shots integer not null check (shots > 0),
  target_type text not null default 'fc4',
  target_photo_path text not null,           -- foto do alvo utilizado (storage)
  scope text not null check (scope in ('local', 'regional', 'nacional')),
  clubs text[],                              -- local: [clube do organizador]; regional: lista; nacional: null
  arma text not null,
  calibre text not null,
  ends_at timestamptz not null,

  status text not null default 'open' check (status in ('open', 'closed')),

  -- Juiz de Prova / IAT
  judge_id uuid references auth.users(id) on delete set null,
  judge_invite_token uuid not null default gen_random_uuid()
);

create index if not exists championships_scope_idx on public.championships(scope);
create index if not exists championships_organizer_idx on public.championships(organizer_id);
create index if not exists championships_judge_idx on public.championships(judge_id);

create table if not exists public.championship_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now() not null,
  championship_id uuid not null references public.championships(id) on delete cascade,
  shooter_id uuid not null references auth.users(id) on delete cascade,
  photo_path text not null,

  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),

  -- Preenchidos pelo Juiz de Prova/IAT na auditoria
  pontos integer,
  disparos integer,
  scoring jsonb,
  frame jsonb,
  judge_note text,
  reviewed_at timestamptz
);

create index if not exists champ_subs_champ_idx on public.championship_submissions(championship_id);
create index if not exists champ_subs_shooter_idx on public.championship_submissions(shooter_id);

-- Acesso so via RPC (security definer). RLS ligado sem policies de escrita.
alter table public.championships enable row level security;
alter table public.championship_submissions enable row level security;

-- ============================================================
-- Storage: fotos de campeonato (alvo de referencia + submissoes)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('championship-photos', 'championship-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users upload own championship photos" on storage.objects;
create policy "Users upload own championship photos"
  on storage.objects for insert
  with check (
    bucket_id = 'championship-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Leitura: dono da foto; juiz/organizador do campeonato da submissao;
-- e qualquer autenticado pra foto de referencia do alvo.
drop policy if exists "Championship photos read" on storage.objects;
create policy "Championship photos read"
  on storage.objects for select
  using (
    bucket_id = 'championship-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1 from public.championship_submissions s
        join public.championships c on c.id = s.championship_id
        where s.photo_path = storage.objects.name
          and (c.judge_id = auth.uid() or c.organizer_id = auth.uid())
      )
      or exists (
        select 1 from public.championships c2
        where c2.target_photo_path = storage.objects.name
          and auth.uid() is not null
      )
    )
  );

drop policy if exists "Users delete own championship photos" on storage.objects;
create policy "Users delete own championship photos"
  on storage.objects for delete
  using (
    bucket_id = 'championship-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- RPCs
-- ============================================================

-- Criar campeonato (todas as etapas obrigatorias do setup)
create or replace function public.create_championship(
  p_name text,
  p_shots integer,
  p_target_type text,
  p_target_photo_path text,
  p_scope text,
  p_clubs text[],
  p_arma text,
  p_calibre text,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_club text;
  v_clubs text[];
  v_row championships%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Dê um nome ao campeonato'; end if;
  if coalesce(p_shots, 0) <= 0 then raise exception 'Informe a quantidade de tiros'; end if;
  if coalesce(p_target_photo_path, '') = '' then raise exception 'Envie a foto do alvo utilizado'; end if;
  if p_scope not in ('local', 'regional', 'nacional') then raise exception 'Escopo inválido'; end if;
  if coalesce(trim(p_arma), '') = '' or coalesce(trim(p_calibre), '') = '' then
    raise exception 'Escolha arma e calibre';
  end if;
  if p_ends_at is null or p_ends_at <= now() then
    raise exception 'A data de encerramento precisa ser no futuro';
  end if;

  select club_name into v_club from profiles where id = auth.uid();

  if p_scope = 'local' then
    if v_club is null then raise exception 'Selecione seu clube antes de criar um campeonato local'; end if;
    v_clubs := array[v_club];
  elsif p_scope = 'regional' then
    if p_clubs is null or array_length(p_clubs, 1) is null then
      raise exception 'Campeonato regional precisa da lista de clubes participantes';
    end if;
    v_clubs := p_clubs;
  else
    v_clubs := null;
  end if;

  insert into championships
    (organizer_id, name, shots, target_type, target_photo_path, scope, clubs, arma, calibre, ends_at)
  values
    (auth.uid(), trim(p_name), p_shots, coalesce(p_target_type, 'fc4'), p_target_photo_path,
     p_scope, v_clubs, trim(p_arma), trim(p_calibre), p_ends_at)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'judge_invite_token', v_row.judge_invite_token);
end;
$func$;

-- Juiz aceita o convite (link do WhatsApp com o token). Ganha o badge.
create or replace function public.accept_judge_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row championships%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_row from championships where judge_invite_token = p_token;
  if v_row.id is null then raise exception 'Convite inválido ou expirado'; end if;
  if v_row.status <> 'open' then raise exception 'Esse campeonato já foi encerrado'; end if;
  if v_row.judge_id is not null and v_row.judge_id <> auth.uid() then
    raise exception 'Esse campeonato já tem Juiz de Prova';
  end if;

  update championships set judge_id = auth.uid() where id = v_row.id;
  update profiles set judge_badge = true where id = auth.uid();

  return jsonb_build_object('id', v_row.id, 'name', v_row.name);
end;
$func$;

-- Lista campeonatos visiveis pro usuario (escopo + organizador + juiz)
create or replace function public.list_championships(p_limit int default 100)
returns table (
  id uuid,
  created_at timestamptz,
  name text,
  shots integer,
  target_type text,
  target_photo_path text,
  scope text,
  clubs text[],
  arma text,
  calibre text,
  ends_at timestamptz,
  status text,
  organizer_id uuid,
  organizer_name text,
  judge_id uuid,
  judge_name text,
  i_am_organizer boolean,
  i_am_judge boolean,
  judge_invite_token uuid,
  my_submissions bigint,
  pending_count bigint
)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_club text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select club_name into v_club from profiles where id = auth.uid();

  return query
  select
    c.id, c.created_at, c.name, c.shots, c.target_type, c.target_photo_path,
    c.scope, c.clubs, c.arma, c.calibre, c.ends_at, c.status,
    c.organizer_id,
    coalesce(nullif(po.nickname, ''), po.display_name, split_part(po.email, '@', 1)) as organizer_name,
    c.judge_id,
    coalesce(nullif(pj.nickname, ''), pj.display_name, split_part(pj.email, '@', 1)) as judge_name,
    (c.organizer_id = auth.uid()) as i_am_organizer,
    (c.judge_id = auth.uid()) as i_am_judge,
    case when c.organizer_id = auth.uid() then c.judge_invite_token else null end as judge_invite_token,
    (select count(*) from championship_submissions s
      where s.championship_id = c.id and s.shooter_id = auth.uid()) as my_submissions,
    case when c.organizer_id = auth.uid() or c.judge_id = auth.uid() then
      (select count(*) from championship_submissions s
        where s.championship_id = c.id and s.status = 'pending')
    else 0 end as pending_count
  from championships c
  left join profiles po on po.id = c.organizer_id
  left join profiles pj on pj.id = c.judge_id
  where c.scope = 'nacional'
     or c.organizer_id = auth.uid()
     or c.judge_id = auth.uid()
     or (v_club is not null and c.clubs is not null and v_club = any(c.clubs))
  order by (c.status = 'open') desc, c.ends_at asc
  limit p_limit;
end;
$func$;

-- Atirador envia submissao (so a foto; sem analise no lado do atirador).
-- Pode reenviar ate o fim: vale a melhor APROVADA pelo juiz.
create or replace function public.submit_championship_entry(
  p_championship_id uuid,
  p_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row championships%rowtype;
  v_club text;
  v_new_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(p_photo_path, '') = '' then raise exception 'Envie a foto do alvo'; end if;

  select * into v_row from championships where id = p_championship_id;
  if v_row.id is null then raise exception 'Campeonato não encontrado'; end if;
  if v_row.status <> 'open' then raise exception 'Campeonato encerrado'; end if;
  if now() > v_row.ends_at then raise exception 'Prazo de submissão encerrado'; end if;
  if v_row.judge_id = auth.uid() then
    raise exception 'O Juiz de Prova não pode competir no campeonato que audita';
  end if;

  if v_row.scope <> 'nacional' then
    select club_name into v_club from profiles where id = auth.uid();
    if v_club is null or not (v_club = any(v_row.clubs)) then
      raise exception 'Seu clube não participa deste campeonato';
    end if;
  end if;

  insert into championship_submissions (championship_id, shooter_id, photo_path)
  values (p_championship_id, auth.uid(), p_photo_path)
  returning id into v_new_id;

  return v_new_id;
end;
$func$;

-- Lista submissoes: o atirador ve as proprias; juiz e organizador veem todas.
create or replace function public.list_championship_submissions(p_championship_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  shooter_id uuid,
  shooter_name text,
  photo_path text,
  status text,
  pontos integer,
  disparos integer,
  scoring jsonb,
  frame jsonb,
  judge_note text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row championships%rowtype;
  v_all boolean;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_row from championships where id = p_championship_id;
  if v_row.id is null then raise exception 'Campeonato não encontrado'; end if;
  v_all := (v_row.judge_id = auth.uid() or v_row.organizer_id = auth.uid());

  return query
  select s.id, s.created_at, s.shooter_id,
    coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) as shooter_name,
    s.photo_path, s.status, s.pontos, s.disparos, s.scoring, s.frame,
    s.judge_note, s.reviewed_at
  from championship_submissions s
  left join profiles p on p.id = s.shooter_id
  where s.championship_id = p_championship_id
    and (v_all or s.shooter_id = auth.uid())
  order by (s.status = 'pending') desc, s.created_at desc;
end;
$func$;

-- Auditoria do Juiz de Prova/IAT: aprova ou rejeita com a pontuacao corrigida.
-- Pode re-revisar (corrigir um erro) enquanto o campeonato estiver aberto.
create or replace function public.judge_review_submission(
  p_submission_id uuid,
  p_status text,
  p_pontos integer,
  p_disparos integer,
  p_scoring jsonb,
  p_frame jsonb,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_sub championship_submissions%rowtype;
  v_champ championships%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Status inválido'; end if;

  select * into v_sub from championship_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submissão não encontrada'; end if;
  select * into v_champ from championships where id = v_sub.championship_id;
  if v_champ.judge_id is distinct from auth.uid() then
    raise exception 'Apenas o Juiz de Prova deste campeonato pode auditar';
  end if;
  if v_champ.status <> 'open' then raise exception 'Campeonato encerrado'; end if;
  if p_status = 'approved' and (p_pontos is null or p_disparos is null) then
    raise exception 'Aprovação exige pontos e disparos auditados';
  end if;

  update championship_submissions set
    status = p_status,
    pontos = p_pontos,
    disparos = p_disparos,
    scoring = p_scoring,
    frame = p_frame,
    judge_note = p_note,
    reviewed_at = now()
  where id = p_submission_id;
end;
$func$;

-- Ranking do campeonato: melhor submissao APROVADA de cada atirador.
create or replace function public.championship_ranking(p_championship_id uuid)
returns table (
  shooter_id uuid,
  shooter_name text,
  best_pontos integer,
  best_disparos integer,
  approved_count bigint,
  best_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  return query
  select
    s.shooter_id,
    coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) as shooter_name,
    max(s.pontos) as best_pontos,
    (array_agg(s.disparos order by s.pontos desc, s.reviewed_at asc))[1] as best_disparos,
    count(*) as approved_count,
    (array_agg(s.reviewed_at order by s.pontos desc, s.reviewed_at asc))[1] as best_at
  from championship_submissions s
  left join profiles p on p.id = s.shooter_id
  where s.championship_id = p_championship_id and s.status = 'approved'
  group by s.shooter_id, p.nickname, p.display_name, p.email
  -- posicional: alias = nome de coluna de saida do plpgsql, referencia direta seria ambigua
  order by 3 desc, 6 asc;
end;
$func$;

-- Organizador encerra o campeonato (antes ou depois do prazo).
create or replace function public.close_championship(p_championship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row championships%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_row from championships where id = p_championship_id;
  if v_row.id is null then raise exception 'Campeonato não encontrado'; end if;
  if v_row.organizer_id <> auth.uid() then raise exception 'Só o organizador pode encerrar'; end if;
  update championships set status = 'closed' where id = p_championship_id;
end;
$func$;
