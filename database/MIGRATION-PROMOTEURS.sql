/* ==========================================================================
   Viens chop — ESPACE PROMOTEURS et COINS CHILL
   ==========================================================================

   À coller dans Neon → SQL Editor → Run (une seule fois).

   Ce que ça crée :
     • promoteurs       : les comptes des gérants (séparés des comptes de
                          rencontre : un gérant n'apparaît jamais dans le fil)
     • lieux            : la fiche de chaque établissement + son statut
     • visites          : une ligne par couple reçu grâce à l'app
     • suggestions_lieux: les lieux proposés par les membres

   Formule facturée : LA VISITE. Le gérant ne paie rien tant que personne
   n'arrive avec l'app. Une visite = prix_visite (500 FCFA par défaut),
   réglable plus tard dans la console d'administration.

   Rien n'est publié automatiquement : tout lieu arrive en « en_attente » et
   attend la validation de l'administrateur.
   ========================================================================== */

create table if not exists public.schema_migrations (
    version     text primary key,
    applied_at  timestamptz not null default now()
);

/* --------------------------------------------------------------------------
   1. Les gérants
   -------------------------------------------------------------------------- */
create table if not exists public.promoteurs (
    id              uuid primary key default gen_random_uuid(),

    -- Même format que les membres : +2250701020304
    phone           varchar(20) unique not null,
    password_hash   text,

    nom_gerant      varchar(80) not null,

    created_at      timestamptz not null default now(),
    last_login_at   timestamptz
);

/* --------------------------------------------------------------------------
   2. Les lieux
   -------------------------------------------------------------------------- */
create table if not exists public.lieux (
    id              uuid primary key default gen_random_uuid(),
    promoteur_id    uuid not null references public.promoteurs(id) on delete cascade,

    nom             varchar(80)  not null,
    type            varchar(20)  not null default 'maquis'
                    check (type in ('maquis', 'restaurant', 'cafe', 'lounge', 'terrasse', 'autre')),
    commune         varchar(50)  not null,
    quartier        varchar(80),
    repere          varchar(200),
    telephone       varchar(20)  not null,
    horaires        varchar(120),
    -- Budget moyen par personne, en FCFA
    budget          int,
    ambiance        varchar(20) check (ambiance in ('calme', 'anime', 'terrasse', 'famille')),
    description     varchar(400),

    -- Cycle de vie : en_attente → publie (ou refuse), remis en attente à
    -- chaque modification pour qu'aucune fiche ne change sans être relue.
    statut          varchar(20) not null default 'en_attente'
                    check (statut in ('en_attente', 'publie', 'refuse')),
    motif_refus     varchar(300),
    certifie        boolean not null default false,

    -- Code à afficher au comptoir : le client le saisit dans l'app en
    -- arrivant, c'est ce qui compte la visite.
    code_visite     char(6) not null unique,
    -- Prix d'une visite pour CE lieu (recopié du réglage à sa création).
    prix_visite     int not null default 500,

    published_at    timestamptz,
    reviewed_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists lieux_statut_idx on public.lieux (statut);
create index if not exists lieux_commune_idx on public.lieux (commune);

/* --------------------------------------------------------------------------
   3. Les visites
   -------------------------------------------------------------------------- */
create table if not exists public.visites (
    id          uuid primary key default gen_random_uuid(),
    lieu_id     uuid not null references public.lieux(id) on delete cascade,
    user_id     uuid not null references public.users(id) on delete cascade,

    prix        int not null,
    -- Le jour sert à empêcher un même membre de « compter » dix fois la même
    -- soirée. La colonne existe parce qu'une expression (created_at::date)
    -- n'est pas acceptée dans un index unique.
    jour        date not null default current_date,

    -- false = à facturer au gérant ; true = réglé (console d'administration)
    reglee      boolean not null default false,
    regle_at    timestamptz,

    created_at  timestamptz not null default now()
);

create unique index if not exists visites_une_par_jour
    on public.visites (lieu_id, user_id, jour);

create index if not exists visites_lieu_idx on public.visites (lieu_id);
create index if not exists visites_reglee_idx on public.visites (reglee);

/* --------------------------------------------------------------------------
   4. Les lieux proposés par les membres
   -------------------------------------------------------------------------- */
create table if not exists public.suggestions_lieux (
    id          uuid primary key default gen_random_uuid(),
    role        varchar(10)  not null default 'membre' check (role in ('gerant', 'membre')),
    nom         varchar(80)  not null,
    ville       varchar(50)  not null,
    type        varchar(30),
    phone       varchar(20),
    message     varchar(500),
    traite     boolean not null default false,
    created_at  timestamptz not null default now()
);

/* --------------------------------------------------------------------------
   5. Le réglage du prix d'une visite (modifiable dans la console)
   -------------------------------------------------------------------------- */
insert into public.reglages (cle, valeur)
values ('prix_visite', '500')
on conflict (cle) do nothing;

insert into public.schema_migrations (version) values ('promoteurs')
on conflict (version) do nothing;

/* ==========================================================================
   Vérification : les 4 tables doivent apparaître
   ========================================================================== */
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('promoteurs', 'lieux', 'visites', 'suggestions_lieux');
