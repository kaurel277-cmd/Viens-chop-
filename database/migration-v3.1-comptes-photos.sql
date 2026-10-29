-- ============================================================================
-- VIENS CHOP — migration v3.1
--   * comptes par mot de passe (plus de SMS pour s'inscrire)
--   * photos stockées en base, en petit format
--
-- À exécuter dans Neon → SQL Editor, une seule fois.
-- Sans danger : tout est en « if not exists », rien n'est supprimé.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Mot de passe
--    Format stocké : scrypt:N:salt_hex:hash_hex  (jamais le mot de passe)
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists password_hash text;

-- Les comptes créés avant cette migration n'ont pas de mot de passe :
-- ils pourront en définir un plus tard (pas de blocage).

-- ----------------------------------------------------------------------------
-- 2. Photos
--    Stockées dans Neon (bytea). Chaque photo est déjà compressée côté
--    navigateur (≈ 60–100 Ko). 3 photos maximum par personne.
--    Les médias « vue unique » du chat ne sont JAMAIS stockés ici.
-- ----------------------------------------------------------------------------
create table if not exists public.photos (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.users(id) on delete cascade,
    position    smallint not null default 0 check (position between 0 and 2),
    mime        varchar(30) not null check (mime in ('image/webp', 'image/jpeg')),
    bytes       int not null check (bytes > 0 and bytes <= 120000),
    data        bytea not null,
    created_at  timestamptz not null default now(),
    unique (user_id, position)
);

create index if not exists photos_user_idx on public.photos (user_id, position);

-- Une seule photo par emplacement : la nouvelle remplace l'ancienne.
create or replace function app.replace_photo()
returns trigger
language plpgsql
as $$
begin
    delete from public.photos
     where user_id = new.user_id and position = new.position and id <> new.id;
    return new;
end;
$$;

drop trigger if exists photos_replace on public.photos;
create trigger photos_replace
    before insert on public.photos
    for each row execute function app.replace_photo();

-- La photo principale reste accessible depuis public.users (pratique pour
-- les jointures du fil), mais elle n'est qu'un raccourci vers photos.id.
alter table public.users add column if not exists main_photo_id uuid;

-- ----------------------------------------------------------------------------
-- 3. Journal des migrations (traçabilité)
-- ----------------------------------------------------------------------------
create table if not exists public.schema_migrations (
    version     text primary key,
    applied_at  timestamptz not null default now()
);
insert into public.schema_migrations (version) values ('v3.1-comptes-photos')
    on conflict (version) do nothing;
