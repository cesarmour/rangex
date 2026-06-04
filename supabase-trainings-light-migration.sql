-- ============================================================
-- TRAININGS: carregamento leve no boot
-- ------------------------------------------------------------
-- Problema: as fotos dos alvos sao gravadas como base64 dentro
-- do jsonb "sessions". O boot fazia select('*') e baixava todas
-- as fotos de todos os treinos de uma vez, estourando o timeout
-- em conexao movel.
--
-- Correcao: o boot passa a usar list_trainings_light, que devolve
-- as sessions SEM o campo "photo" (strip no servidor). Os dados de
-- scoring continuam todos la (arma, calibre, disparos, pontos,
-- quadrantes, distancia, diagnostico). A foto so e buscada sob
-- demanda, ao abrir um treino, via get_training_full.
--
-- Nada e apagado. As fotos antigas seguem no banco.
-- Seguro rodar varias vezes (create or replace).
-- ============================================================

create or replace function public.list_trainings_light(p_limit int default 200)
returns table (
  id uuid,
  label text,
  trained_at timestamptz,
  club_name text,
  club_address text,
  sessions jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    t.label,
    t.trained_at,
    t.club_name,
    t.club_address,
    coalesce(
      (
        select jsonb_agg(e.elem - 'photo' order by e.ord)
        from jsonb_array_elements(t.sessions) with ordinality as e(elem, ord)
      ),
      '[]'::jsonb
    ) as sessions
  from public.trainings t
  where t.user_id = auth.uid()
  order by t.trained_at desc
  limit greatest(coalesce(p_limit, 200), 0);
$$;

create or replace function public.get_training_full(p_training_id uuid)
returns table (
  id uuid,
  label text,
  trained_at timestamptz,
  club_name text,
  club_address text,
  sessions jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.label, t.trained_at, t.club_name, t.club_address, t.sessions
  from public.trainings t
  where t.id = p_training_id
    and t.user_id = auth.uid();
$$;
