-- =============================================================
-- Migration: niveis de usuario (user/ro/admin) + catalogo global de armas
-- Run in Supabase SQL Editor
-- =============================================================

-- Papel do usuario:
--   'user'  = atirador normal
--   'ro'    = atirador com permissao de Range Officer (audita campeonatos onde e arbitro)
--   'admin' = faz tudo (audita e encerra qualquer campeonato, ve todos)
alter table public.profiles
  add column if not exists role text not null default 'user'
  check (role in ('user', 'ro', 'admin'));

-- Promover um admin (rodar com o email certo):
-- update public.profiles set role = 'admin' where email = 'cesar@hypr.mobi';

-- ============================================================
-- Convite de arbitro agora promove user -> ro (aditivo, nao rebaixa admin)
-- ============================================================
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
    raise exception 'Esse campeonato já tem Árbitro/RO';
  end if;

  update championships set judge_id = auth.uid() where id = v_row.id;
  update profiles set
    judge_badge = true,
    role = case when role = 'user' then 'ro' else role end
  where id = auth.uid();

  return jsonb_build_object('id', v_row.id, 'name', v_row.name);
end;
$func$;

-- ============================================================
-- Admin: audita e encerra qualquer campeonato, ve todos
-- ============================================================
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
  v_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Status inválido'; end if;

  select * into v_sub from championship_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submissão não encontrada'; end if;
  select * into v_champ from championships where id = v_sub.championship_id;
  select role into v_role from profiles where id = auth.uid();
  if v_champ.judge_id is distinct from auth.uid() and coalesce(v_role, 'user') <> 'admin' then
    raise exception 'Apenas o Árbitro/RO deste campeonato (ou um admin) pode auditar';
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

create or replace function public.close_championship(p_championship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row championships%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_row from championships where id = p_championship_id;
  if v_row.id is null then raise exception 'Campeonato não encontrado'; end if;
  select role into v_role from profiles where id = auth.uid();
  if v_row.organizer_id <> auth.uid() and coalesce(v_role, 'user') <> 'admin' then
    raise exception 'Só o organizador (ou um admin) pode encerrar';
  end if;
  update championships set status = 'closed' where id = p_championship_id;
end;
$func$;

drop function if exists public.list_championships(int);

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
  submission_mode text,
  organizer_id uuid,
  organizer_name text,
  judge_id uuid,
  judge_name text,
  i_am_organizer boolean,
  i_am_judge boolean,
  i_am_admin boolean,
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
  v_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select p.club_name, p.role into v_club, v_role from profiles p where p.id = auth.uid();
  v_role := coalesce(v_role, 'user');

  return query
  select
    c.id, c.created_at, c.name, c.shots, c.target_type, c.target_photo_path,
    c.scope, c.clubs, c.arma, c.calibre, c.ends_at, c.status,
    c.submission_mode,
    c.organizer_id,
    coalesce(nullif(po.nickname, ''), po.display_name, split_part(po.email, '@', 1)) as organizer_name,
    c.judge_id,
    coalesce(nullif(pj.nickname, ''), pj.display_name, split_part(pj.email, '@', 1)) as judge_name,
    (c.organizer_id = auth.uid()) as i_am_organizer,
    (c.judge_id = auth.uid()) as i_am_judge,
    (v_role = 'admin') as i_am_admin,
    case when c.organizer_id = auth.uid() or v_role = 'admin' then c.judge_invite_token else null end as judge_invite_token,
    (select count(*) from championship_submissions s
      where s.championship_id = c.id and s.shooter_id = auth.uid()) as my_submissions,
    case when c.organizer_id = auth.uid() or c.judge_id = auth.uid() or v_role = 'admin' then
      (select count(*) from championship_submissions s
        where s.championship_id = c.id and s.status = 'pending')
    else 0 end as pending_count
  from championships c
  left join profiles po on po.id = c.organizer_id
  left join profiles pj on pj.id = c.judge_id
  where c.scope = 'nacional'
     or c.organizer_id = auth.uid()
     or c.judge_id = auth.uid()
     or v_role = 'admin'
     or (v_club is not null and c.clubs is not null and v_club = any(c.clubs))
  order by (c.status = 'open') desc, c.ends_at asc
  limit p_limit;
end;
$func$;

-- Admin e o arbitro tambem podem listar todas as submissoes (ja cobre juiz/org;
-- adiciona admin)
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
  v_role text;
  v_all boolean;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select c.* into v_row from championships c where c.id = p_championship_id;
  if v_row.id is null then raise exception 'Campeonato não encontrado'; end if;
  select p.role into v_role from profiles p where p.id = auth.uid();
  v_all := (v_row.judge_id = auth.uid() or v_row.organizer_id = auth.uid() or coalesce(v_role, 'user') = 'admin');

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

-- Admin/arbitro leem fotos de submissao no storage (admin adicionado)
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
        select 1 from public.profiles pr
        where pr.id = auth.uid() and pr.role = 'admin'
      )
      or exists (
        select 1 from public.championships c2
        where c2.target_photo_path = storage.objects.name
          and auth.uid() is not null
      )
    )
  );

-- ============================================================
-- Catalogo global de armas (anonimo): modelos arma+calibre ja cadastrados
-- por qualquer usuario, sem expor o dono. Pra treino esporadico com busca.
-- ============================================================
create or replace function public.search_armas(p_query text)
returns table (
  arma text,
  calibre text,
  usuarios bigint
)
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  return query
  select a.arma, a.calibre, count(distinct a.user_id) as usuarios
  from acervo a
  where coalesce(trim(a.arma), '') <> ''
    and (coalesce(trim(p_query), '') = ''
      or a.arma ilike '%' || trim(p_query) || '%'
      or a.calibre ilike '%' || trim(p_query) || '%')
  group by a.arma, a.calibre
  order by count(distinct a.user_id) desc, a.arma asc
  limit 15;
end;
$func$;
