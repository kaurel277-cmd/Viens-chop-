-- ============================================================================
--  VIENS CHOP — migration « paiement du Mode Debout »
--  À exécuter UNE FOIS dans Neon → SQL Editor → coller → Run.
--
--  Ce script ne supprime rien et ne touche à aucune donnée existante.
--  Il peut être relancé sans risque.
--
--  Principe (aucun compte marchand nécessaire) :
--    1. la personne envoie 700 FCFA par Wave au numéro que TU renseignes
--       dans la console d'admin (rien n'est écrit en dur dans le site) ;
--    2. elle colle l'identifiant de la transaction Wave dans l'application ;
--    3. tu valides dans la console → le Mode Debout s'active 30 jours.
--
--  Plus tard, quand tu auras un compte marchand (Wave Business ou CinetPay),
--  le même circuit se valide tout seul via le webhook : rien à refaire ici.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Réglages du paiement, modifiables depuis la console d'admin
--    (prix, durée, numéro Wave, nom du bénéficiaire, interrupteur général)
-- ----------------------------------------------------------------------------
create table if not exists public.reglages (
    cle     text primary key,
    valeur  text,
    maj_le  timestamptz not null default now()
);

insert into public.reglages (cle, valeur) values
    ('prix_debout',    '700'),
    ('duree_jours',    '30'),
    ('devise',         'FCFA'),
    ('paiement_actif', 'oui'),
    ('wave_numero',    ''),
    ('wave_nom',       ''),
    ('operateurs',     'wave')
on conflict (cle) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Paiements : deux colonnes de plus + le statut « refusé »
--    (la table public.payments existe déjà depuis le schéma initial)
-- ----------------------------------------------------------------------------
alter table public.payments add column if not exists note           text;
alter table public.payments add column if not exists decided_at     timestamptz;
alter table public.payments add column if not exists checkout_url   text;      -- lien Wave à ouvrir
alter table public.payments add column if not exists transaction_id text;      -- n° de transaction Wave
alter table public.payments add column if not exists mode           text not null default 'manuel';

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
    check (status in ('pending', 'paid', 'failed', 'rejected', 'refunded'));

-- Une seule demande en attente par personne : impossible d'empiler les preuves
create unique index if not exists payments_one_pending_idx
    on public.payments (user_id) where status = 'pending';

create index if not exists payments_status_idx
    on public.payments (status, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Activation : un paiement « paid » = 30 jours de Mode Debout
--    (la durée suit le réglage `duree_jours`, 30 par défaut)
--    Un renouvellement s'ajoute à la date de fin existante, il ne la remplace pas.
-- ----------------------------------------------------------------------------
create or replace function app.activate_plan_on_payment()
returns trigger
language plpgsql
as $$
declare
    jours integer;
begin
    if new.status = 'paid' and (old.status is distinct from 'paid') then
        select coalesce(nullif(valeur, '')::integer, 30)
          into jours
          from public.reglages where cle = 'duree_jours';
        if jours is null or jours < 1 or jours > 366 then
            jours := 30;
        end if;

        update public.users
           set plan            = 'debout',
               plan_expires_at = greatest(coalesce(plan_expires_at, now()), now())
                                 + (jours || ' days')::interval
         where id = new.user_id;

        new.paid_at    := coalesce(new.paid_at, now());
        new.decided_at := coalesce(new.decided_at, now());
    end if;

    if new.status in ('rejected', 'failed') and (old.status is distinct from new.status) then
        new.decided_at := coalesce(new.decided_at, now());
    end if;

    return new;
end;
$$;

drop trigger if exists payments_activate on public.payments;
create trigger payments_activate
    before update of status on public.payments
    for each row execute function app.activate_plan_on_payment();

-- ----------------------------------------------------------------------------
-- 4. Droits (sans effet si ton rôle d'application est le propriétaire,
--    ce qui est le cas par défaut sur Neon)
-- ----------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'vienschop_api') then
        execute 'grant select, insert, update, delete on public.reglages to vienschop_api';
        execute 'grant select, insert, update, delete on public.payments to vienschop_api';
    end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Contrôle : doit renvoyer t | t | t
--    (table des réglages, colonne note, déclencheur d'activation)
-- ----------------------------------------------------------------------------
select
    to_regclass('public.reglages') is not null                            as reglages,
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payments'
               and column_name = 'checkout_url')                          as colonne_lien,
    exists (select 1 from pg_trigger
             where tgname = 'payments_activate')                          as declencheur;
