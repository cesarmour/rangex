-- =============================================================
-- Migration: gestao de usuarios pelo admin (listar + mudar papel)
-- Run in Supabase SQL Editor
-- =============================================================

-- Lista usuarios (so admin), com busca por nome/email/clube
create or replace function public.admin_list_users(p_query text default null, p_limit int default 50)
returns table (
  id uuid,
  email text,
  display_name text,
  nome_completo text,
  club_name text,
  role text,
  judge_badge boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select p.role into v_role from profiles p where p.id = auth.uid();
  if coalesce(v_role, 'user') <> 'admin' then
    raise exception 'Apenas admin gerencia usuários';
  end if;

  return query
  select p.id, p.email,
    coalesce(nullif(p.nickname, ''), p.display_name, split_part(p.email, '@', 1)) as display_name,
    p.nome_completo, p.club_name, coalesce(p.role, 'user') as role,
    coalesce(p.judge_badge, false) as judge_badge, p.created_at
  from profiles p
  where coalesce(trim(p_query), '') = ''
     or p.email ilike '%' || trim(p_query) || '%'
     or p.display_name ilike '%' || trim(p_query) || '%'
     or p.nickname ilike '%' || trim(p_query) || '%'
     or p.nome_completo ilike '%' || trim(p_query) || '%'
     or p.club_name ilike '%' || trim(p_query) || '%'
  order by p.created_at desc
  limit p_limit;
end;
$func$;

-- Muda o papel de um usuario (so admin; nao muda o proprio papel,
-- pra um admin nao se trancar fora sem querer)
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'user') <> 'admin' then
    raise exception 'Apenas admin muda papéis';
  end if;
  if p_role not in ('user', 'ro', 'admin') then raise exception 'Papel inválido'; end if;
  if p_user_id = auth.uid() then
    raise exception 'Não dá pra mudar o próprio papel (peça a outro admin ou use o SQL)';
  end if;

  update profiles set
    role = p_role,
    judge_badge = case when p_role in ('ro', 'admin') then true else judge_badge end
  where id = p_user_id;

  if not found then raise exception 'Usuário não encontrado'; end if;
end;
$func$;
