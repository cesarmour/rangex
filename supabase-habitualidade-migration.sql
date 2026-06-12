-- =============================================================
-- Migration: Modulo de Habitualidade (Portaria 260-COLOG/2025)
-- v1: registro eletronico de sessao (append-only), acervo da entidade,
-- cessao, selfie georreferenciada, base pro Anexo E e pacote SFPC.
-- Run in Supabase SQL Editor
-- =============================================================

-- ============================================================
-- 1. Cadastro do atirador (CR/CPF na primeira vez, depois fica no perfil)
-- ============================================================
alter table public.profiles
  add column if not exists cpf text,
  add column if not exists cr_numero text,
  add column if not exists cr_data date,
  add column if not exists endereco_habitualidade text,
  add column if not exists filiacao_numero text,
  add column if not exists filiacao_data date,
  add column if not exists nivel_habitualidade text not null default '1'
    check (nivel_habitualidade in ('1', '2', '3', 'alto_rendimento'));

-- ============================================================
-- 2. Configuracao da entidade declarante + responsavel legal
-- (editar via SQL quando mudar; leitura por qualquer autenticado)
-- ============================================================
create table if not exists public.habit_config (
  id smallint primary key default 1 check (id = 1),
  entidade jsonb not null,
  responsavel jsonb not null,
  livro_sistema text not null default 'StrikeCore'
);

alter table public.habit_config enable row level security;
drop policy if exists "Authenticated read habit config" on public.habit_config;
create policy "Authenticated read habit config"
  on public.habit_config for select
  using (auth.uid() is not null);

insert into public.habit_config (id, entidade, responsavel)
values (
  1,
  jsonb_build_object(
    'nome', 'G16 UNIVERSIDADE DO TIRO PREMIUM',
    'cnpj', '36.029.202/0001-03',
    'endereco', 'Alameda dos Nhambiquaras, 1509 - Moema, São Paulo - SP, 04090-013',
    'cr_numero', '502342',
    'cr_data', null
  ),
  jsonb_build_object(
    'nome', 'Daniel Pazzini Araujo da Silva',
    'cargo', 'Diretor',
    'cpf', '483.308.208-07',
    'cert_assinatura_tipo', 'gov_br'
  )
)
on conflict (id) do nothing;

-- ============================================================
-- 3. Acervo da entidade (armas do clube disponiveis pra habitualidade)
-- Campos do motor de classificacao: tipo_fisico + energia_j (+ lisa/semiauto).
-- O grupo NUNCA e fixado aqui: e derivado no lancamento e gravado como snapshot.
-- ============================================================
create table if not exists public.club_guns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now() not null,
  tipo text not null,                 -- Pistola / Espingarda / Carabina Fuzil
  marca text not null,
  modelo text not null,
  calibre text not null,
  serie text not null,
  sigma text not null,
  tipo_fisico text not null check (tipo_fisico in ('curta', 'longa_raiada', 'longa_lisa')),
  semiautomatica boolean not null default false,
  energia_j numeric,                  -- energia de saida de referencia (J)
  calibre_lisa_numero smallint,       -- pra lisa: "calibre 12" etc.
  proprietario_tipo text not null default 'entidade'
    check (proprietario_tipo in ('entidade', 'terceiro')),
  ativo boolean not null default true
);

alter table public.club_guns enable row level security;
drop policy if exists "Authenticated read club guns" on public.club_guns;
create policy "Authenticated read club guns"
  on public.club_guns for select
  using (auth.uid() is not null);

-- Seed: acervo G16 (energias de referencia; validar na tabela conforme
-- Arts. 11/12 do Decreto 11.615/2023 - item 8.1 da spec)
insert into public.club_guns
  (tipo, marca, modelo, calibre, serie, sigma, tipo_fisico, semiautomatica, energia_j, calibre_lisa_numero)
select * from (values
  ('Pistola', 'TAURUS', 'PT58 PLUS', '.380 ACP', 'KRG29537', '255407', 'curta', true, 260::numeric, null::smallint),
  ('Espingarda', 'BOITO', 'ERA2001', '12 GAUGE', 'r5481409', '511818', 'longa_lisa', false, null::numeric, 12::smallint),
  ('Carabina Fuzil', 'IMBEL', 'PARAFAL', '7,62x51mm', 'aja07119', '1522397', 'longa_raiada', true, 3500::numeric, null::smallint)
) as v(tipo, marca, modelo, calibre, serie, sigma, tipo_fisico, semiautomatica, energia_j, calibre_lisa_numero)
where not exists (select 1 from public.club_guns g where g.sigma = v.sigma);

-- ============================================================
-- 4. Registro de sessao de habitualidade (APPEND-ONLY, retencao permanente)
-- ============================================================
create sequence if not exists public.habit_registro_seq;

create table if not exists public.habit_sessions (
  id uuid primary key default gen_random_uuid(),
  numero_registro text unique not null,
  livro_sistema text not null default 'StrikeCore',
  folha text not null,
  data_lancamento timestamptz not null default now(),
  data_hora_evento timestamptz not null,

  atirador_id uuid not null references auth.users(id) on delete restrict,
  atirador_nome text not null,        -- snapshot
  atirador_cpf text not null,         -- snapshot
  atirador_cr text not null,          -- snapshot
  atirador_nivel text not null,       -- snapshot

  gun_id uuid not null references public.club_guns(id) on delete restrict,
  arma_snapshot jsonb not null,       -- tipo/marca/modelo/calibre/serie/sigma
  grupo_no_evento smallint not null check (grupo_no_evento between 1 and 6),
  uso text not null check (uso in ('permitido', 'restrito')),
  inciso_legal text not null,

  qtd_municao integer not null check (qtd_municao > 0),
  municao_calibre text not null,
  tipo_evento text not null check (tipo_evento in ('treinamento', 'competicao')),
  nivel_competicao text check (nivel_competicao in ('estadual', 'distrital', 'regional', 'nacional', 'internacional')),
  atividade_desc text not null,

  -- presenca/autenticacao do atirador
  presenca_confirmada_em timestamptz not null default now(),
  presenca_metodo text not null default 'app_auth',
  selfie_path text,                   -- storage habit-selfies
  geo jsonb,                          -- { lat, lng, accuracy, capturado_em }

  -- cessao (arma da entidade/terceiro): snapshot do termo
  cessao jsonb,                       -- cedente completo + presenca_fisica_cedente + cessionario
  club_name text                      -- clube onde ocorreu (perfil no momento)
);

create index if not exists habit_sessions_atirador_idx on public.habit_sessions(atirador_id, data_hora_evento desc);
create index if not exists habit_sessions_evento_idx on public.habit_sessions(data_hora_evento);

alter table public.habit_sessions enable row level security;
-- Sem policy de update/delete: append-only por construcao (escrita so via RPC).

-- ============================================================
-- 5. Storage: selfies georreferenciadas
-- ============================================================
insert into storage.buckets (id, name, public)
values ('habit-selfies', 'habit-selfies', false)
on conflict (id) do nothing;

drop policy if exists "Users upload own habit selfies" on storage.objects;
create policy "Users upload own habit selfies"
  on storage.objects for insert
  with check (
    bucket_id = 'habit-selfies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Habit selfies read" on storage.objects;
create policy "Habit selfies read"
  on storage.objects for select
  using (
    bucket_id = 'habit-selfies'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
    )
  );

-- ============================================================
-- 6. RPCs
-- ============================================================

-- Lancamento de sessao. O grupo vem do motor JS (dirigido pela arma),
-- revalidado aqui contra os campos da arma pra nao aceitar snapshot torto.
create or replace function public.register_habit_session(
  p_gun_id uuid,
  p_data_hora_evento timestamptz,
  p_qtd_municao integer,
  p_tipo_evento text,
  p_nivel_competicao text,
  p_atividade text,
  p_grupo smallint,
  p_uso text,
  p_inciso text,
  p_selfie_path text,
  p_geo jsonb,
  p_presenca_fisica_cedente boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_profile profiles%rowtype;
  v_gun club_guns%rowtype;
  v_cfg habit_config%rowtype;
  v_seq bigint;
  v_numero text;
  v_folha text;
  v_grupo smallint;
  v_uso text;
  v_inciso text;
  v_row habit_sessions%rowtype;
  v_nome text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  select * into v_profile from profiles where id = auth.uid();
  if coalesce(trim(v_profile.cpf), '') = '' or coalesce(trim(v_profile.cr_numero), '') = '' then
    raise exception 'Cadastre seu CPF e CR antes de lançar habitualidade';
  end if;

  select * into v_gun from club_guns where id = p_gun_id and ativo;
  if v_gun.id is null then raise exception 'Arma não encontrada no acervo da entidade'; end if;

  if coalesce(p_qtd_municao, 0) <= 0 then raise exception 'Informe o consumo de munição'; end if;
  if p_tipo_evento not in ('treinamento', 'competicao') then raise exception 'Tipo de evento inválido'; end if;
  if p_tipo_evento = 'competicao' and p_nivel_competicao is null then
    raise exception 'Competição exige o nível (estadual a internacional)';
  end if;
  if coalesce(trim(p_atividade), '') = '' then raise exception 'Descreva a atividade'; end if;
  if p_data_hora_evento is null or p_data_hora_evento > now() + interval '5 minutes' then
    raise exception 'Data-hora do evento inválida';
  end if;

  -- Motor revalidado no servidor (mesmos limiares dos Arts. 11/12)
  if v_gun.tipo_fisico = 'curta' then
    if coalesce(v_gun.energia_j, 0) <= 407 then
      v_grupo := 1; v_uso := 'permitido'; v_inciso := 'Art.11,I';
    else
      v_grupo := 4; v_uso := 'restrito'; v_inciso := 'Art.12,III';
    end if;
  elsif v_gun.tipo_fisico = 'longa_raiada' then
    if coalesce(v_gun.energia_j, 0) <= 1620 then
      v_grupo := 2; v_uso := 'permitido'; v_inciso := 'Art.11,II';
    else
      v_grupo := 5; v_uso := 'restrito'; v_inciso := 'Art.12,IV';
    end if;
  else
    if coalesce(v_gun.calibre_lisa_numero, 12) > 12 or v_gun.semiautomatica then
      v_grupo := 6; v_uso := 'restrito'; v_inciso := 'Art.12,V';
    else
      v_grupo := 3; v_uso := 'permitido'; v_inciso := 'Art.11,III';
    end if;
  end if;

  if p_grupo is distinct from v_grupo then
    raise exception 'Classificação divergente entre app e servidor (app: %, servidor: %)', p_grupo, v_grupo;
  end if;

  -- Cessao obrigatoria: arma e da entidade/terceiro, exige presenca fisica do cedente
  if not coalesce(p_presenca_fisica_cedente, false) then
    raise exception 'A cessão exige a presença física do cedente no lançamento';
  end if;

  select * into v_cfg from habit_config where id = 1;

  v_seq := nextval('habit_registro_seq');
  v_numero := 'SC-' || lpad(v_seq::text, 6, '0');
  v_folha := lpad((((v_seq - 1) / 30) + 1)::text, 4, '0');
  v_nome := coalesce(nullif(v_profile.nickname, ''), v_profile.display_name, split_part(v_profile.email, '@', 1));

  insert into habit_sessions (
    numero_registro, livro_sistema, folha, data_hora_evento,
    atirador_id, atirador_nome, atirador_cpf, atirador_cr, atirador_nivel,
    gun_id, arma_snapshot, grupo_no_evento, uso, inciso_legal,
    qtd_municao, municao_calibre, tipo_evento, nivel_competicao, atividade_desc,
    presenca_metodo, selfie_path, geo, cessao, club_name
  ) values (
    v_numero, coalesce(v_cfg.livro_sistema, 'StrikeCore'), v_folha, p_data_hora_evento,
    auth.uid(), v_nome, trim(v_profile.cpf), trim(v_profile.cr_numero), v_profile.nivel_habitualidade,
    v_gun.id,
    jsonb_build_object(
      'tipo', v_gun.tipo, 'marca', v_gun.marca, 'modelo', v_gun.modelo,
      'calibre', v_gun.calibre, 'serie', v_gun.serie, 'sigma', v_gun.sigma
    ),
    v_grupo, v_uso, v_inciso,
    p_qtd_municao, v_gun.calibre, p_tipo_evento,
    case when p_tipo_evento = 'competicao' then p_nivel_competicao else null end,
    trim(p_atividade),
    'app_auth', p_selfie_path, p_geo,
    jsonb_build_object(
      'cedente', v_cfg.entidade,
      'cedente_assinante', v_cfg.responsavel,
      'cedente_sigma', v_gun.sigma,
      'cessionario', jsonb_build_object(
        'nome', v_nome, 'cpf', trim(v_profile.cpf), 'cr', trim(v_profile.cr_numero)
      ),
      'presenca_fisica_cedente', true,
      'termo_assinado_em', now()
    ),
    v_profile.club_name
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'numero_registro', v_row.numero_registro,
    'folha', v_row.folha,
    'data_lancamento', v_row.data_lancamento,
    'grupo', v_row.grupo_no_evento,
    'uso', v_row.uso,
    'inciso', v_row.inciso_legal
  );
end;
$func$;

-- Minhas sessoes (log imutavel; base do Anexo E no app)
create or replace function public.list_my_habit_sessions(p_limit int default 500)
returns table (
  id uuid,
  numero_registro text,
  livro_sistema text,
  folha text,
  data_lancamento timestamptz,
  data_hora_evento timestamptz,
  arma_snapshot jsonb,
  grupo_no_evento smallint,
  uso text,
  inciso_legal text,
  qtd_municao integer,
  municao_calibre text,
  tipo_evento text,
  nivel_competicao text,
  atividade_desc text,
  presenca_confirmada_em timestamptz,
  geo jsonb,
  cessao jsonb,
  club_name text
)
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  return query
  select s.id, s.numero_registro, s.livro_sistema, s.folha, s.data_lancamento,
    s.data_hora_evento, s.arma_snapshot, s.grupo_no_evento, s.uso, s.inciso_legal,
    s.qtd_municao, s.municao_calibre, s.tipo_evento, s.nivel_competicao,
    s.atividade_desc, s.presenca_confirmada_em, s.geo, s.cessao, s.club_name
  from habit_sessions s
  where s.atirador_id = auth.uid()
  order by s.data_hora_evento desc
  limit p_limit;
end;
$func$;

-- Pacote SFPC mensal (admin): todas as sessoes da competencia + snapshots
create or replace function public.habit_sfpc_export(p_competencia date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_role text;
  v_cfg habit_config%rowtype;
  v_ini timestamptz;
  v_fim timestamptz;
  v_atividades jsonb;
  v_atiradores jsonb;
  v_acervo jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select role into v_role from profiles where id = auth.uid();
  if coalesce(v_role, 'user') <> 'admin' then
    raise exception 'Apenas admin gera o pacote SFPC';
  end if;

  select * into v_cfg from habit_config where id = 1;
  v_ini := date_trunc('month', p_competencia);
  v_fim := v_ini + interval '1 month';

  select coalesce(jsonb_agg(to_jsonb(s) - 'selfie_path' order by s.data_hora_evento), '[]'::jsonb)
    into v_atividades
  from habit_sessions s
  where s.data_hora_evento >= v_ini and s.data_hora_evento < v_fim;

  select coalesce(jsonb_agg(distinct jsonb_build_object(
      'nome', s.atirador_nome, 'cpf', s.atirador_cpf, 'cr', s.atirador_cr, 'nivel', s.atirador_nivel
    )), '[]'::jsonb)
    into v_atiradores
  from habit_sessions s
  where s.data_hora_evento >= v_ini and s.data_hora_evento < v_fim;

  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_acervo
  from club_guns g where g.ativo;

  return jsonb_build_object(
    'competencia', to_char(v_ini, 'YYYY-MM'),
    'entidade', v_cfg.entidade,
    'responsavel', v_cfg.responsavel,
    'livro_sistema', v_cfg.livro_sistema,
    'acervo_snapshot', v_acervo,
    'atiradores_snapshot', v_atiradores,
    'atividades_snapshot', v_atividades,
    'gerado_em', now()
  );
end;
$func$;
