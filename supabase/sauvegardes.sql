-- ============================================================================
-- Suivi Heures — table des sauvegardes cloud
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Sans risque : crée une NOUVELLE table, ne modifie ni ne supprime rien d'existant.
-- Peut être relancé plusieurs fois sans effet de bord.
-- ============================================================================

create table if not exists public.sauvegardes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'manuelle',   -- 'auto' | 'manuelle'
  label       text,
  counts      jsonb,                              -- { pointages, absences }
  payload     jsonb not null                      -- sauvegarde complète
);

create index if not exists sauvegardes_user_created_idx on public.sauvegardes (user_id, created_at desc);

alter table public.sauvegardes enable row level security;

-- Droits d'accès pour les utilisateurs connectés (sans eux : « permission denied »)
grant select, insert, delete on public.sauvegardes to authenticated;

-- Chaque utilisateur ne voit et ne modifie que ses propres sauvegardes
-- (créées seulement si elles n'existent pas : aucune suppression)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sauvegardes' and policyname = 'sauvegardes_select_own') then
    create policy "sauvegardes_select_own" on public.sauvegardes for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sauvegardes' and policyname = 'sauvegardes_insert_own') then
    create policy "sauvegardes_insert_own" on public.sauvegardes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sauvegardes' and policyname = 'sauvegardes_delete_own') then
    create policy "sauvegardes_delete_own" on public.sauvegardes for delete using (auth.uid() = user_id);
  end if;
end $$;
