-- ============================================================================
-- VIENS CHOP — Schéma de base de données
-- Cahier des charges v2.0 · §5 Architecture PostgreSQL / Supabase
--
-- À exécuter dans Supabase → SQL Editor.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Utilisateurs avec validation automatique (§2 + §5)
-- ----------------------------------------------------------------------------
create table if not exists public.users (
    id                 uuid primary key default gen_random_uuid(),

    -- Format E.164 : +2250701020304 (un seul compte par numéro)
    phone              varchar(15) unique not null,
    is_phone_verified  boolean default true,          -- validation auto après OTP

    pseudo             varchar(20) not null,
    gender             char(1) check (gender in ('M', 'F')),
    seeking            char(1) check (seeking in ('M', 'F', 'A')),

    -- Majorité calculée par la base, jamais par le client
    birth_date         date not null,
    age                int generated always as
                       (extract(year from age(birth_date))) stored,
    is_adult           boolean generated always as
                       (extract(year from age(birth_date)) >= 18) stored,

    commune            varchar(50) not null,
    artists            text[]  default '{}',          -- tags musicaux
    voice_note_url     text,
    selfie_url         text,
    is_certified       boolean default false,         -- badge « Profil Certifié » (IA)

    is_vip             boolean default false,
    vip_expires_at     timestamptz,

    -- Quota du Faux Appel : gratuit = 1 essai / 7 jours
    fake_call_last_used timestamptz,

    -- Compteur de likes du jour (remis à zéro chaque jour)
    likes_today        int default 0,
    likes_reset_at     date default current_date,

    created_at         timestamptz default now(),
    updated_at         timestamptz default now(),

    -- Garde-fou : aucun mineur en base, même si le client est modifié
    constraint adult_only check (is_adult = true)
);

create index if not exists users_commune_idx on public.users (commune);
create index if not exists users_vip_idx     on public.users (is_vip) where is_vip = true;

-- ----------------------------------------------------------------------------
-- 2. Likes (§3.A) — un like = une ligne
-- ----------------------------------------------------------------------------
create table if not exists public.likes (
    id          uuid primary key default gen_random_uuid(),
    sender_id   uuid not null references public.users (id) on delete cascade,
    receiver_id uuid not null references public.users (id) on delete cascade,
    created_at  timestamptz default now(),
    unique (sender_id, receiver_id),
    constraint no_self_like check (sender_id <> receiver_id)
);

create index if not exists likes_receiver_idx on public.likes (receiver_id);

-- ----------------------------------------------------------------------------
-- 3. Matchs (like réciproque)
-- ----------------------------------------------------------------------------
create table if not exists public.matches (
    id         uuid primary key default gen_random_uuid(),
    user_a     uuid not null references public.users (id) on delete cascade,
    user_b     uuid not null references public.users (id) on delete cascade,
    created_at timestamptz default now(),
    unique (user_a, user_b),
    constraint ordered_pair check (user_a < user_b)   -- évite les doublons miroir
);

-- ----------------------------------------------------------------------------
-- 4. Messages (§3.B) — types texte / vocal / système
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
    id           uuid primary key default gen_random_uuid(),
    match_id     uuid not null references public.matches (id) on delete cascade,
    sender_id    uuid not null references public.users (id) on delete cascade,
    body         text,
    kind         text not null default 'text' check (kind in ('text', 'voice', 'quiz', 'system')),
    audio_url    text,
    duration_s   int,
    is_read      boolean default false,              -- coche ✓✓
    created_at   timestamptz default now(),
    constraint body_or_audio check (body is not null or audio_url is not null)
);

create index if not exists messages_match_created_idx
    on public.messages (match_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Sessions du Mode Flirt (§3.C) — gratuit : 1 par jour
-- ----------------------------------------------------------------------------
create table if not exists public.quiz_sessions (
    id         uuid primary key default gen_random_uuid(),
    match_id   uuid not null references public.matches (id) on delete cascade,
    started_at timestamptz default now(),
    score      int default 0
);

-- ----------------------------------------------------------------------------
-- 6. Paiements Mobile Money (§1 + §4)
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.users (id) on delete cascade,
    amount_fcfa   int not null default 700,
    operator      text not null check (operator in ('wave', 'orange', 'mtn', 'moov')),
    status        text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'failed', 'refunded')),
    external_ref  text,
    created_at    timestamptz default now(),
    confirmed_at  timestamptz
);

create index if not exists payments_user_idx on public.payments (user_id);

-- ----------------------------------------------------------------------------
-- 7. Triggers
-- ----------------------------------------------------------------------------

-- 7a. updated_at automatique
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
    for each row execute function public.touch_updated_at();

-- 7b. Blocage dur des mineurs (double sécurité avec la contrainte)
create or replace function public.reject_minor()
returns trigger language plpgsql as $$
begin
    if extract(year from age(new.birth_date)) < 18 then
        raise exception 'INSCRIPTION_REFUSEE : Viens chop est réservé aux personnes majeures (+18 ans).';
    end if;
    return new;
end $$;

drop trigger if exists users_adult_only on public.users;
create trigger users_adult_only before insert or update of birth_date on public.users
    for each row execute function public.reject_minor();

-- 7c. Création automatique du match quand deux likes se croisent
create or replace function public.maybe_create_match()
returns trigger language plpgsql as $$
declare
    reciprocal boolean;
    a uuid; b uuid;
begin
    select exists (
        select 1 from public.likes
        where sender_id = new.receiver_id and receiver_id = new.sender_id
    ) into reciprocal;

    if reciprocal then
        a := least(new.sender_id, new.receiver_id);
        b := greatest(new.sender_id, new.receiver_id);
        insert into public.matches (user_a, user_b)
        values (a, b)
        on conflict (user_a, user_b) do nothing;
    end if;
    return new;
end $$;

drop trigger if exists likes_create_match on public.likes;
create trigger likes_create_match after insert on public.likes
    for each row execute function public.maybe_create_match();

-- 7d. Quota de 3 likes / jour pour les comptes gratuits (§3.A)
create or replace function public.enforce_daily_like_quota()
returns trigger language plpgsql as $$
declare
    s public.users;
begin
    select * into s from public.users where id = new.sender_id for update;
    if s.is_vip then
        return new;
    end if;

    if s.likes_reset_at <> current_date then
        update public.users set likes_today = 0, likes_reset_at = current_date where id = s.id;
        return new;
    end if;

    if s.likes_today >= 3 then
        raise exception 'QUOTA_LIKES_ATTEINT : 3 likes par jour en Mode Coulé. Passe en Debout pour des likes illimités.';
    end if;

    update public.users set likes_today = likes_today + 1 where id = s.id;
    return new;
end $$;

drop trigger if exists likes_quota on public.likes;
create trigger likes_quota before insert on public.likes
    for each row execute function public.enforce_daily_like_quota();

-- 7e. Quota du Faux Appel : 1 essai / 7 jours pour les comptes gratuits (§4)
create or replace function public.enforce_fakecall_quota()
returns trigger language plpgsql as $$
begin
    if new.is_vip then
        return new;
    end if;
    if new.fake_call_last_used is not null
       and new.fake_call_last_used > now() - interval '7 days' then
        raise exception 'QUOTA_FAUX_APPEL : 1 essai gratuit par semaine. Passe en VIP pour un accès illimité 24/7.';
    end if;
    return new;
end $$;

drop trigger if exists users_fakecall_quota on public.users;
create trigger users_fakecall_quota before update of fake_call_last_used on public.users
    for each row execute function public.enforce_fakecall_quota();

-- ----------------------------------------------------------------------------
-- 8. Sécurité niveau ligne (RLS)
-- ----------------------------------------------------------------------------
alter table public.users         enable row level security;
alter table public.likes         enable row level security;
alter table public.matches       enable row level security;
alter table public.messages      enable row level security;
alter table public.payments      enable row level security;
alter table public.quiz_sessions enable row level security;

-- Chacun ne voit que son propre profil en écriture
drop policy if exists users_read_profiles on public.users;
create policy users_read_profiles on public.users
    for select using (true);          -- profils publics (photos restent floutées côté app)

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
    for update using (auth.uid() = id);

-- On ne peut liker qu'en son nom
drop policy if exists likes_insert_self on public.likes;
create policy likes_insert_self on public.likes
    for insert with check (auth.uid() = sender_id);

drop policy if exists likes_read_involved on public.likes;
create policy likes_read_involved on public.likes
    for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- On ne voit que ses propres matchs
drop policy if exists matches_read_own on public.matches;
create policy matches_read_own on public.matches
    for select using (auth.uid() = user_a or auth.uid() = user_b);

-- Messages : lecture/écriture réservées aux deux membres du match
drop policy if exists messages_read_own on public.messages;
create policy messages_read_own on public.messages
    for select using (
        exists (select 1 from public.matches m
                where m.id = match_id and (auth.uid() = m.user_a or auth.uid() = m.user_b))
    );

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
    for insert with check (
        auth.uid() = sender_id and
        exists (select 1 from public.matches m
                where m.id = match_id and (auth.uid() = m.user_a or auth.uid() = m.user_b))
    );

-- ----------------------------------------------------------------------------
-- 9. Vue « Qui m'a aimé » (§4)
--    Le floutage des photos est appliqué côté application :
--    is_vip = false → l'app ne reçoit pas les URLs en clair.
-- ----------------------------------------------------------------------------
create or replace view public.who_liked_me as
select
    l.created_at  as liked_at,
    u.id          as user_id,
    u.pseudo,
    u.age,
    u.commune,
    case when me.is_vip then u.selfie_url else null end as photo_url
from public.likes l
join public.users u  on u.id = l.sender_id
join public.users me on me.id = l.receiver_id
where l.receiver_id = auth.uid();

-- ============================================================================
-- Fin du schéma
-- ============================================================================
