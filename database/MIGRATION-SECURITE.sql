-- ============================================================================
--  VIENS CHOP — migration « sécurité & modération »
--  À exécuter UNE FOIS dans Neon → SQL Editor → coller → Run.
--
--  Ce script ne supprime rien et ne touche à aucune donnée existante.
--  Il peut être relancé sans risque.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Vérification d'identité par selfie
--    Le selfie est gardé le temps de la vérification, puis effacé (colonne
--    selfie remise à NULL) dès que la décision est prise.
-- ----------------------------------------------------------------------------
create table if not exists public.verifications (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.users(id) on delete cascade,
    mime        text not null,
    bytes       integer not null,
    selfie      bytea,                                    -- effacé après décision
    status      text not null default 'pending'
                check (status in ('pending','approved','rejected')),
    note        text,
    reviewed_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists verifications_status_idx
    on public.verifications (status, created_at desc);

-- Une seule demande en attente par personne
create unique index if not exists verifications_one_pending_idx
    on public.verifications (user_id) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 2. Modération automatique des photos de profil
--    ok      = publiée normalement
--    review  = publiée, mais à regarder par l'équipe
--    blocked = retirée (elle disparaît du fil et n'est plus servie)
-- ----------------------------------------------------------------------------
alter table if exists public.photos
    add column if not exists moderation_status text not null default 'ok';

alter table if exists public.photos
    add column if not exists moderation_score real;

alter table if exists public.photos
    add column if not exists moderation_note text;

do $$
begin
    if to_regclass('public.photos') is not null and not exists (
        select 1 from pg_constraint where conname = 'photos_moderation_status_check'
    ) then
        alter table public.photos
            add constraint photos_moderation_status_check
            check (moderation_status in ('ok','review','blocked'));
    end if;
end $$;

create index if not exists photos_moderation_idx
    on public.photos (moderation_status, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Journal des actions d'administration (qui a validé quoi, quand)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_actions (
    id         uuid primary key default gen_random_uuid(),
    action     text not null,
    target_id  uuid,
    details    jsonb,
    created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_idx
    on public.admin_actions (created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Vérification finale : les trois blocs doivent répondre true
-- ----------------------------------------------------------------------------
select
    (to_regclass('public.verifications')  is not null) as table_verifications,
    (to_regclass('public.admin_actions')  is not null) as table_admin_actions,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'photos'
               and column_name = 'moderation_status')     as colonne_moderation;
