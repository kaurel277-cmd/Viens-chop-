-- ============================================================================
--  VIENS CHOP — migration « mot de passe oublié »
--  À exécuter UNE FOIS dans Neon → SQL Editor → coller → Run.
--
--  Pas de SMS, pas d'email : la clé de secours est le seul moyen de récupérer
--  un compte. Elle est hachée en base (scrypt), affichée une seule fois, et
--  utilisable une seule fois.
--
--  Ce script ne supprime rien. Il peut être relancé sans risque.
-- ============================================================================

alter table public.users add column if not exists recovery_hash       text;
alter table public.users add column if not exists recovery_created_at timestamptz;
alter table public.users add column if not exists recovery_used_at    timestamptz;

-- Vérification finale : les trois colonnes doivent répondre true.
select
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users'
               and column_name = 'recovery_hash')       as colonne_cle,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users'
               and column_name = 'recovery_created_at') as colonne_date,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users'
               and column_name = 'recovery_used_at')    as colonne_usage;
