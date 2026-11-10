-- ============================================================================
-- Suivi Heures — table des sauvegardes cloud
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Sans risque : ne touche pas à vos tables existantes.
-- ============================================================================

create table if not exists public.sauvegardes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'manuelle',   -- 'auto' | 'manuelle'
  label       text,
  counts      jsonb,                              -- { pointages, absences }
  payload     jsonb not null                      -- sauvegarde complète
);

create index if not exists sauvegardes_user_created_idx on public.sauvegardes (user_id, created_at desc);

alter table public.sauvegardes enable row level security;

-- Chaque utilisateur ne voit et ne modifie que ses propres sauvegardes
drop policy if exists "sauvegardes_select_own" on public.sauvegardes;
create policy "sauvegardes_select_own" on public.sauvegardes for select using (auth.uid() = user_id);
drop policy if exists "sauvegardes_insert_own" on public.sauvegardes;
create policy "sauvegardes_insert_own" on public.sauvegardes for insert with check (auth.uid() = user_id);
drop policy if exists "sauvegardes_delete_own" on public.sauvegardes;
create policy "sauvegardes_delete_own" on public.sauvegardes for delete using (auth.uid() = user_id);
