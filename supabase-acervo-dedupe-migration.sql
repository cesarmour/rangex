-- =============================================================
-- Migration: Acervo dedupe + seeding flag
-- Run in Supabase SQL Editor
-- =============================================================

-- 1) Add a flag to profile so we know if defaults were already seeded
alter table public.profiles
  add column if not exists acervo_seeded boolean default false;

-- 2) Mark all existing users with any acervo entries as already seeded
-- (prevents re-seeding for users who already have stuff)
update public.profiles p
set acervo_seeded = true
where exists (select 1 from public.acervo a where a.user_id = p.id);

-- 3) Dedupe existing acervo: for each (user_id, arma, calibre), keep oldest
with ranked as (
  select id,
    row_number() over (
      partition by user_id, arma, calibre
      order by created_at asc, id asc
    ) as rn
  from public.acervo
)
delete from public.acervo
where id in (select id from ranked where rn > 1);

-- 4) Prevent future duplicates at the database level
-- Unique on (user_id, arma, calibre). Use a partial index that ignores blank rows.
create unique index if not exists acervo_user_arma_calibre_uniq
  on public.acervo (user_id, arma, calibre)
  where arma is not null and arma <> '';

-- 5) Safe bulk-seed RPC: idempotent, sets acervo_seeded on success
create or replace function public.seed_default_acervo(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_already boolean;
  v_item jsonb;
  v_idx int := 0;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;

  -- Atomic check + claim
  select coalesce(acervo_seeded, false) into v_already
    from public.profiles where id = auth.uid()
    for update;

  if v_already then
    return; -- nothing to do
  end if;

  -- Insert default items (ignore conflicts on the unique index)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      insert into public.acervo (user_id, arma, calibre, sort_order)
      values (
        auth.uid(),
        v_item->>'arma',
        v_item->>'calibre',
        v_idx
      )
      on conflict (user_id, arma, calibre) where arma is not null and arma <> ''
      do nothing;
      v_idx := v_idx + 1;
    exception when others then
      -- Skip silently on any per-row error
      null;
    end;
  end loop;

  update public.profiles set acervo_seeded = true where id = auth.uid();
end;
$func$;

grant execute on function public.seed_default_acervo(jsonb) to authenticated;
