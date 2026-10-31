/* ==========================================================================
   Viens chop — AJOUTER DES LIEUX DANS « COINS CHILL »
   ==========================================================================

   À coller dans Neon → SQL Editor → Run, en une seule fois (tout le fichier).

   ⚠️ Ce que fait ce fichier : il crée les fiches AU NOM DE VIENS CHOP, pas au
   nom du gérant. Elles s'affichent tout de suite sur maquis.html et dans
   l'application, mais le gérant ne peut pas encore les modifier lui-même.

   Quand un gérant crée son compte sur promoteur.html, il crée une SECONDE
   fiche pour le même lieu. À ce moment-là, deux options :
     • supprimer la fiche que tu avais saisie (console → Coins Chill →
       Supprimer), ou
     • rattacher la fiche au compte du gérant (section 6 en bas du fichier).

   Si les gérants s'inscrivent eux-mêmes sur promoteur.html, tu n'as pas
   besoin de ce fichier : tu les valides dans la console (Coins Chill →
   Publier). C'est la meilleure voie quand c'est possible.

   Le fichier est sans risque à rejouer : il ne crée jamais de doublon.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Le compte qui portera les fiches saisies par l'administrateur.
      Il n'apparaît pas dans le fil, il ne reçoit rien : c'est un porteur.
   -------------------------------------------------------------------------- */
insert into public.promoteurs (phone, nom_gerant)
values ('+2250700000001', 'Viens chop — fiches vérifiées')
on conflict (phone) do nothing;

/* --------------------------------------------------------------------------
   2. ⬇️  LA SEULE PARTIE À REMPLIR  ⬇️

   Une ligne = un lieu. Garde les virgules et les guillemets simples.
   L'apostrophe dans un nom s'écrit doublée : Maquis l''Espoir
   Une valeur qui ne sert pas s'écrit null (sans guillemets).

   Colonnes, dans l'ordre :
     nom · type · commune · quartier · repère · téléphone · horaires ·
     budget par personne (FCFA) · ambiance · description

   type     : maquis | restaurant | cafe | lounge | terrasse | autre
   ambiance : calme | anime | terrasse | famille
   commune  : reprends la liste de villes.js, par exemple
              'Abidjan — Cocody', 'Abidjan — Yopougon', 'Bouaké'…

   Les trois lignes ci-dessous sont des EXEMPLES. Remplace-les par tes lieux :
   le fichier REFUSE de tourner tant qu'il en reste une (message d'erreur).
   -------------------------------------------------------------------------- */
create temp table a_ajouter (
    nom         text,
    type        text,
    commune     text,
    quartier    text,
    repere      text,
    telephone   text,
    horaires    text,
    budget      int,
    ambiance    text,
    description text
);

insert into a_ajouter values
    ('REMPLACE 1 — Maquis exemple',     'maquis',     'Abidjan — Cocody',   'Riviera',  'En face de la pharmacie', '0700000001', '18h - 2h',  3000, 'anime',    'Poulet braisé et poisson braisé, ambiance du soir.'),
    ('REMPLACE 2 — Café exemple',       'cafe',       'Abidjan — Yopougon', 'Selmer',   'À côté de la station',    '0700000002', '8h - 22h',  2000, 'calme',    'Café, jus naturels, coin tranquille pour discuter.'),
    ('REMPLACE 3 — Restaurant exemple', 'restaurant', 'Abidjan — Marcory',  'Zone 4',   'Derrière le carrefour',   '0700000003', '12h - 23h', 5000, 'terrasse', 'Cuisine ivoirienne et poisson, grande terrasse.');

/* --------------------------------------------------------------------------
   3. Vérification, puis ajout. Cette partie ne se modifie pas.
   -------------------------------------------------------------------------- */
do $$
declare
    v_promo    uuid;
    v_ligne    record;
    v_code     text;
    v_exemples int;
    v_ajoutes  int := 0;
    v_deja     int := 0;
begin
    select count(*) into v_exemples from a_ajouter where nom like 'REMPLACE%';
    if v_exemples > 0 then
        raise exception 'Il reste % ligne(s) d''exemple (REMPLACE…). Remplace-les par tes vrais lieux, puis relance le fichier.', v_exemples;
    end if;

    select id into v_promo from public.promoteurs where phone = '+2250700000001';
    if v_promo is null then
        raise exception 'Le compte porteur n''a pas été créé : relance le fichier entier.';
    end if;

    for v_ligne in select * from a_ajouter loop
        if exists (
            select 1 from public.lieux
             where lower(trim(nom)) = lower(trim(v_ligne.nom))
               and commune = v_ligne.commune
        ) then
            v_deja := v_deja + 1;
            continue;
        end if;

        loop
            v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
            exit when not exists (select 1 from public.lieux where code_visite = v_code);
        end loop;

        insert into public.lieux
            (promoteur_id, nom, type, commune, quartier, repere, telephone,
             horaires, budget, ambiance, description, statut, certifie,
             code_visite, published_at)
        values
            (v_promo,
             trim(v_ligne.nom),
             case when v_ligne.type in ('maquis','restaurant','cafe','lounge','terrasse','autre')
                  then v_ligne.type else 'autre' end,
             coalesce(nullif(trim(v_ligne.commune), ''), 'Abidjan'),
             nullif(trim(coalesce(v_ligne.quartier, '')), ''),
             nullif(trim(coalesce(v_ligne.repere, '')), ''),
             coalesce(nullif(trim(coalesce(v_ligne.telephone, '')), ''), '+2250700000001'),
             nullif(trim(coalesce(v_ligne.horaires, '')), ''),
             v_ligne.budget,
             case when v_ligne.ambiance in ('calme','anime','terrasse','famille')
                  then v_ligne.ambiance else null end,
             nullif(trim(coalesce(v_ligne.description, '')), ''),
             'publie', false, v_code, now());

        v_ajoutes := v_ajoutes + 1;
    end loop;

    raise notice '% lieu(x) ajouté(s), % déjà présent(s).', v_ajoutes, v_deja;
end $$;

/* --------------------------------------------------------------------------
   4. Ce qui est maintenant en ligne (même requête que la page publique)
   -------------------------------------------------------------------------- */
select nom, type, commune, quartier, budget, certifie
  from public.lieux
 where statut = 'publie'
 order by commune, nom;

drop table if exists a_ajouter;

/* --------------------------------------------------------------------------
   5. Rappel : le badge « certifié » ne s'achète pas. Il se pose dans la
      console (Coins Chill → Certifier), après une visite réelle.

   6. Plus tard, rattacher une fiche au compte du gérant
      (quand il a créé son compte sur promoteur.html)

   update public.lieux
      set promoteur_id = (select id from public.promoteurs where phone = '+22507XXXXXXXX')
    where lower(trim(nom)) = lower(trim('Nom du lieu'));

   Puis supprimer la fiche en double créée par le gérant, dans la console.
   -------------------------------------------------------------------------- */
