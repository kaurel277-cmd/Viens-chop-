-- ============================================================================
-- VIENS CHOP — Schéma PostgreSQL pour NEON
-- Version 3.0 · compatible PostgreSQL 17
--
-- À exécuter dans Neon → SQL Editor, ou en CLI :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/neon-schema.sql
--
-- Différences avec la version Supabase (v2.0) :
--   * aucune dépendance à `auth.uid()` ni au schéma `auth` de Supabase ;
--   * les colonnes générées `age` / `is_adult` sont remplacées par un trigger
--     (PostgreSQL refuse `age()` dans une colonne calculée : non immutable) ;
--   * `voice_note_url` supprimée (la note vocale a été retirée du produit) ;
--   * `is_vip` remplacé par `plan` ('coupe' | 'debout'), aligné sur le produit ;
--   * ajout des tables d'authentification (otp_codes, sessions) et de
--     modération (reports, blocks), indispensables hors Supabase Auth ;
--   * RLS désactivée : l'accès passe uniquement par l'API (voir docs/BACKEND.md).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. Schéma applicatif
-- ----------------------------------------------------------------------------
create schema if not exists app;

-- Drapeau « ce compte est-il en Mode Debout ? » (abonnement actif)
create or replace function app.has_debout(p_plan text, p_expires timestamptz)
returns boolean
language sql
immutable
as $$
    select p_plan = 'debout' and (p_expires is null or p_expires > now());
$$;

-- ============================================================================
-- 1. UTILISATEURS
-- ============================================================================
create table if not exists public.users (
    id                  uuid primary key default gen_random_uuid(),

    -- E.164 : +2250701020304 — un seul compte par numéro
    phone               varchar(20) unique not null,
    is_phone_verified   boolean not null default false,

    pseudo              varchar(20) not null,
    gender              char(1) check (gender in ('M', 'F')),
    seeking             char(1) check (seeking  in ('M', 'F', 'A')),

    birth_date          date not null,
    -- Remplies par trigger (current_date n'est pas immutable : interdit en colonne calculée)
    age                 int,
    is_adult            boolean not null default false,

    commune             varchar(50) not null,
    artists             text[] not null default '{}',
    bio                 varchar(140),

    photo_url           text,
    selfie_url          text,
    is_certified        boolean not null default false,

    -- Abonnement : 'coupe' (gratuit) ou 'debout' (700 FCFA/mois)
    plan                text not null default 'coupe' check (plan in ('coupe', 'debout')),
    plan_expires_at     timestamptz,

    -- Quota du Faux Appel : gratuit = 1 essai / 7 jours
    fake_call_last_used timestamptz,

    -- Quota de likes journalier
    likes_today         int  not null default 0,
    likes_reset_at      date not null default current_date,

    last_seen_at        timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists users_commune_idx  on public.users (commune);
create index if not exists users_plan_idx     on public.users (plan) where plan = 'debout';
create index if not exists users_lastseen_idx on public.users (last_seen_at desc nulls last);

-- ----------------------------------------------------------------------------
-- 1.1 Âge et majorité, recalculés à chaque écriture
-- ----------------------------------------------------------------------------
create or replace function app.set_age_and_check_adult()
returns trigger
language plpgsql
as $$
begin
    new.age      := extract(year from age(new.birth_date));
    new.is_adult := new.age >= 18;

    if not new.is_adult then
        raise exception 'MINEUR_INTERDIT : Viens chop est réservé aux 18 ans et plus (âge calculé : %).', new.age
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists users_age_adult on public.users;
create trigger users_age_adult
    before insert or update of birth_date on public.users
    for each row execute function app.set_age_and_check_adult();

-- `now()` ne doit pas vieillir les comptes en base : on rafraîchit age/is_adult
-- à la lecture via cette fonction (appelée par l'API dans les SELECT).
create or replace function app.refresh_age(p_user_id uuid)
returns void
language sql
as $$
    update public.users
       set age      = extract(year from age(birth_date)),
           is_adult = extract(year from age(birth_date)) >= 18
     where id = p_user_id
       and age is distinct from extract(year from age(birth_date));
$$;

-- ----------------------------------------------------------------------------
-- 1.2 updated_at
-- ----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists users_touch on public.users;
create trigger users_touch
    before update on public.users
    for each row execute function app.touch_updated_at();

-- ============================================================================
-- 2. AUTHENTIFICATION (ce que Supabase Auth fournissait)
-- ============================================================================

-- --- 2.1 Codes OTP -----------------------------------------------------------
create table if not exists public.otp_codes (
    id          bigserial primary key,
    phone       varchar(20) not null,
    code_hash   text not null,                 -- sha256(code + pepper), jamais en clair
    expires_at  timestamptz not null,
    attempts    int not null default 0,
    consumed_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists otp_phone_idx on public.otp_codes (phone, created_at desc);

-- Antibruteforce : 5 envois max par numéro et par heure
create or replace function app.check_otp_rate_limit(p_phone varchar)
returns void
language plpgsql
as $$
declare
    v_count int;
begin
    select count(*) into v_count
      from public.otp_codes
     where phone = p_phone
       and created_at > now() - interval '1 hour';

    if v_count >= 5 then
        raise exception 'TROP_DE_DEMANDES : 5 codes maximum par heure. Réessaie plus tard.'
            using errcode = 'check_violation';
    end if;
end;
$$;

-- --- 2.2 Sessions (JWT + refresh token) --------------------------------------
create table if not exists public.sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.users(id) on delete cascade,
    token_hash  text not null unique,
    user_agent  text,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    revoked_at  timestamptz
);

create index if not exists sessions_user_idx on public.sessions (user_id);

-- ============================================================================
-- 3. LIKES
-- ============================================================================
create table if not exists public.likes (
    id          uuid primary key default gen_random_uuid(),
    sender_id   uuid not null references public.users(id) on delete cascade,
    receiver_id uuid not null references public.users(id) on delete cascade,
    created_at  timestamptz not null default now(),

    constraint no_self_like check (sender_id <> receiver_id),
    constraint one_like_per_pair unique (sender_id, receiver_id)
);

create index if not exists likes_receiver_idx on public.likes (receiver_id, created_at desc);

-- --- 3.0 bis Profils passés (swipe à gauche) --------------------------------
-- Sans cette table, un profil passé revient au rechargement du fil.
create table if not exists public.passes (
    user_id    uuid not null references public.users(id) on delete cascade,
    target_id  uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),

    constraint no_self_pass check (user_id <> target_id),
    primary key (user_id, target_id)
);

create index if not exists passes_target_idx on public.passes (target_id);

-- --- 3.1 Quota : 3 likes/jour en gratuit, illimité en Debout ------------------
create or replace function app.enforce_daily_like_quota()
returns trigger
language plpgsql
as $$
declare
    u           public.users%rowtype;
    v_today     int;
    v_debout    boolean;
begin
    -- Verrouille la ligne pour éviter deux likes simultanés qui dépassent le quota
    select * into u from public.users where id = new.sender_id for update;

    v_debout := app.has_debout(u.plan, u.plan_expires_at);

    -- Remise à zéro si on a changé de jour
    if u.likes_reset_at <> current_date then
        v_today := 0;
    else
        v_today := u.likes_today;
    end if;

    if not v_debout and v_today >= 3 then
        raise exception 'QUOTA_LIKES_ATTEINT : 3 likes par jour en Mode Coulé. Passe en Mode Debout pour des likes illimités.'
            using errcode = 'check_violation';
    end if;

    update public.users
       set likes_today    = v_today + 1,
           likes_reset_at = current_date
     where id = new.sender_id;

    return new;
end;
$$;

drop trigger if exists likes_quota on public.likes;
create trigger likes_quota
    before insert on public.likes
    for each row execute function app.enforce_daily_like_quota();

-- ============================================================================
-- 4. MATCHS
-- ============================================================================
create table if not exists public.matches (
    id          uuid primary key default gen_random_uuid(),
    user_a      uuid not null references public.users(id) on delete cascade,
    user_b      uuid not null references public.users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    unlocked_at timestamptz,                 -- renseigné au 5ᵉ message

    constraint ordered_pair check (user_a < user_b),
    constraint one_match_per_pair unique (user_a, user_b)
);

create index if not exists matches_a_idx on public.matches (user_a);
create index if not exists matches_b_idx on public.matches (user_b);

-- --- 4.1 Like réciproque -> match --------------------------------------------
create or replace function app.maybe_create_match()
returns trigger
language plpgsql
as $$
begin
    if exists (
        select 1 from public.likes
         where sender_id = new.receiver_id
           and receiver_id = new.sender_id
    ) then
        insert into public.matches (user_a, user_b)
        values (least(new.sender_id, new.receiver_id),
                greatest(new.sender_id, new.receiver_id))
        on conflict (user_a, user_b) do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists likes_create_match on public.likes;
create trigger likes_create_match
    after insert on public.likes
    for each row execute function app.maybe_create_match();

-- ============================================================================
-- 5. MESSAGES + DÉBLOCAGE DE LA PHOTO APRÈS 5 MESSAGES
-- ============================================================================
create table if not exists public.messages (
    id         uuid primary key default gen_random_uuid(),
    match_id   uuid not null references public.matches(id) on delete cascade,
    sender_id  uuid not null references public.users(id) on delete cascade,
    body       text not null check (char_length(btrim(body)) between 1 and 1000),
    created_at timestamptz not null default now(),
    read_at    timestamptz
);

create index if not exists messages_match_idx on public.messages (match_id, created_at);

-- L'expéditeur doit appartenir au match
create or replace function app.check_message_sender()
returns trigger
language plpgsql
as $$
begin
    if not exists (
        select 1 from public.matches m
         where m.id = new.match_id
           and new.sender_id in (m.user_a, m.user_b)
    ) then
        raise exception 'ACCES_REFUSE : tu ne participes pas à ce match.'
            using errcode = 'insufficient_privilege';
    end if;
    return new;
end;
$$;

drop trigger if exists messages_check_sender on public.messages;
create trigger messages_check_sender
    before insert on public.messages
    for each row execute function app.check_message_sender();

-- Trigger hérité : au 5ᵉ message il renseigne unlocked_at. Conservé pour la
-- compatibilité et les tests SQL ; l'interface n'attend plus rien pour
-- afficher la photo (décision du 29/10/2026).
create or replace function app.unlock_photos_after_five()
returns trigger
language plpgsql
as $$
declare
    v_count int;
begin
    select count(*) into v_count from public.messages where match_id = new.match_id;

    if v_count >= 5 then
        update public.matches
           set unlocked_at = coalesce(unlocked_at, now())
         where id = new.match_id;
    end if;
    return new;
end;
$$;

drop trigger if exists messages_unlock on public.messages;
create trigger messages_unlock
    after insert on public.messages
    for each row execute function app.unlock_photos_after_five();

-- ============================================================================
-- 6. QUOTA DU FAUX APPEL (1 essai / 7 jours en gratuit)
-- ============================================================================
create or replace function app.enforce_fakecall_quota()
returns trigger
language plpgsql
as $$
begin
    if app.has_debout(new.plan, new.plan_expires_at) then
        return new;                               -- illimité en Mode Debout
    end if;

    -- Le PREMIER essai reste toujours possible : on ne bloque que si un essai
    -- a déjà eu lieu il y a moins de 7 jours.
    if old.fake_call_last_used is not null
       and old.fake_call_last_used > now() - interval '7 days'
       and new.fake_call_last_used is distinct from old.fake_call_last_used then
        raise exception 'QUOTA_FAUX_APPEL : 1 essai gratuit par semaine.'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists users_fakecall_quota on public.users;
create trigger users_fakecall_quota
    before update of fake_call_last_used on public.users
    for each row execute function app.enforce_fakecall_quota();

-- ============================================================================
-- 7. MODÉRATION
-- ============================================================================
create table if not exists public.reports (
    id            uuid primary key default gen_random_uuid(),
    reporter_id   uuid not null references public.users(id) on delete cascade,
    target_id     uuid not null references public.users(id) on delete cascade,
    reason        text not null check (reason in ('fake_profile','harassment','nudity','scam','minor','other')),
    details       text,
    status        text not null default 'open' check (status in ('open','reviewing','closed')),
    created_at    timestamptz not null default now(),
    resolved_at   timestamptz
);

create index if not exists reports_status_idx on public.reports (status, created_at desc);

create table if not exists public.blocks (
    blocker_id uuid not null references public.users(id) on delete cascade,
    blocked_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    constraint no_self_block check (blocker_id <> blocked_id)
);

-- ============================================================================
-- 8. QUIZ / DISQUETTES
-- ============================================================================
create table if not exists public.quiz_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.users(id) on delete cascade,
    partner_id uuid references public.users(id) on delete set null,
    question   text not null,
    answer     text,
    created_at timestamptz not null default now()
);

create index if not exists quiz_user_day_idx on public.quiz_sessions (user_id, created_at desc);

-- ============================================================================
-- 9. PAIEMENTS MOBILE MONEY
-- ============================================================================
create table if not exists public.payments (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references public.users(id) on delete cascade,
    provider       text not null check (provider in ('wave','orange','mtn','moov')),
    provider_ref   text unique,
    amount_fcfa    int  not null check (amount_fcfa > 0),
    plan           text not null default 'debout' check (plan in ('coupe','debout')),
    status         text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
    created_at     timestamptz not null default now(),
    paid_at        timestamptz
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- Un paiement confirmé active le Mode Debout pour 30 jours
create or replace function app.activate_plan_on_payment()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'paid' and (old.status is distinct from 'paid') then
        update public.users
           set plan            = 'debout',
               plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '30 days'
         where id = new.user_id;
        new.paid_at := coalesce(new.paid_at, now());
    end if;
    return new;
end;
$$;

drop trigger if exists payments_activate on public.payments;
create trigger payments_activate
    before update of status on public.payments
    for each row execute function app.activate_plan_on_payment();

-- ============================================================================
-- 10. VUES
-- ============================================================================

-- « Qui m'a liké » : la photo n'est révélée qu'aux abonnés Mode Debout.
drop view if exists public.who_liked_me;
create view public.who_liked_me as
select
    l.id             as like_id,
    l.created_at,
    u.id             as user_id,
    u.pseudo,
    u.age,
    u.commune,
    u.artists,
    u.is_certified,
    case when v.plan = 'debout' and (v.plan_expires_at is null or v.plan_expires_at > now())
         then u.photo_url
    end              as photo_url,          -- null si l'abonné n'est pas en Debout
    true             as is_blurred
from public.likes l
join public.users u on u.id = l.sender_id
join public.users v on v.id = l.receiver_id;   -- v = celui qui consulte

-- Vue publique des profils : elle ne sert jamais la photo elle-même, juste
-- l'information « ce profil a une photo ». L'API renvoie la photo principale
-- à tout inscrit (on doit voir la personne avant de la liker).
create or replace view app.public_profiles as
select
    id,
    pseudo,
    age,
    gender,
    commune,
    artists,
    bio,
    is_certified,
    plan,
    -- la photo n'est jamais servie directement par cette vue
    (photo_url is not null) as has_photo,
    last_seen_at
from public.users;

-- ============================================================================
-- 11. DROITS — facultatif
--
-- Sur Neon, le compte par défaut (`neondb_owner`) est propriétaire de la base
-- mais n'a pas le droit de créer des rôles : les rôles se gèrent depuis la
-- console Neon. Ce bloc est donc tolérant à l'échec : si la création du rôle
-- n'est pas autorisée, on l'ignore et l'API se connecte simplement avec le
-- rôle propriétaire.
-- ============================================================================
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'vienschop_api') then
        execute 'create role vienschop_api nologin';
    end if;

    execute 'grant usage on schema public, app to vienschop_api';
    execute 'grant select, insert, update, delete, truncate on all tables in schema public to vienschop_api';
    execute 'grant usage, select on all sequences in schema public to vienschop_api';
    execute 'grant execute on all functions in schema app to vienschop_api';
    execute 'alter default privileges in schema public grant select, insert, update, delete, truncate on tables to vienschop_api';
    execute 'alter default privileges in schema public grant usage, select on sequences to vienschop_api';

    raise notice 'Rôle vienschop_api créé et configuré.';
exception
    when insufficient_privilege then
        raise notice 'Rôle vienschop_api ignoré (création de rôle non autorisée) — l''API utilisera le rôle propriétaire de la base.';
end;
$$;

-- ============================================================================
-- 12. COMMENTAIRES
-- ============================================================================
comment on table  public.users      is 'Comptes. La majorité est vérifiée par trigger, pas par le client.';
comment on table  public.otp_codes  is 'Codes SMS hachés (sha256 + pepper). 5 envois max par heure et par numéro.';
comment on table  public.sessions   is 'Refresh tokens hachés. Le JWT court (15 min) n''est pas stocké.';
comment on table  public.likes      is 'Quota de 3/jour appliqué par trigger ; illimité en Mode Debout.';
comment on table  public.matches    is 'Paire ordonnée (user_a < user_b) : un seul match par couple.';
comment on column public.matches.unlocked_at is 'Renseigné au 5ᵉ message : débloque les photos.';
comment on view   public.who_liked_me        is 'Photo masquée hors Mode Debout.';
