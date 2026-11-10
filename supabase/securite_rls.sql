-- ============================================================================
-- Suivi Heures — vérification / mise en place de la sécurité (RLS)
-- La clé « anon » présente dans config.js est publique par nature : c'est le
-- Row Level Security qui empêche quiconque de lire vos données.
--
-- 1) Vérifier l'état actuel (lecture seule) :
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in ('pointages', 'absences', 'parametres', 'sauvegardes');
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('pointages', 'absences', 'parametres', 'sauvegardes');
--
-- 2) Si "rowsecurity" vaut false ou si aucune règle n'existe, exécutez le bloc
--    ci-dessous. Il crée des règles « chacun ne voit que ses lignes » sans
--    supprimer vos règles existantes.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['pointages', 'absences', 'parametres'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_own') then
      execute format('create policy %I on public.%I for all using (auth.uid()::text = user_id::text) with check (auth.uid()::text = user_id::text)', t || '_own', t);
    end if;
  end loop;
end $$;

-- 3) (Recommandé) Index pour accélérer le chargement
create index if not exists pointages_user_ts_idx on public.pointages (user_id, "timestamp");
create index if not exists absences_user_debut_idx on public.absences (user_id, date_debut);
