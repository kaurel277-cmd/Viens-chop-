/* ==========================================================================
   Viens chop — VÉRIFIER QUE LA BASE NEON EST COMPLÈTE
   ==========================================================================

   À coller dans Neon → SQL Editor → Run.

   Ce fichier NE MODIFIE RIEN : uniquement des lectures. Il peut être lancé
   autant de fois qu'on veut, même sur une base remplie de vraies données.

   Il affiche :
     1. les 20 tables attendues, avec « oui » ou « MANQUE » ;
     2. les compteurs (membres, promoteurs, lieux, visites, suggestions).

   Si une ligne affiche « ❌ MANQUE », on rejoue le fichier indiqué dans la
   colonne « fichier » (Neon → SQL Editor), puis on relance ce contrôle.
   Tous ces fichiers sont sans danger à rejouer : ils ne créent que ce qui
   n'existe pas encore.
   ========================================================================== */

with attendues (tbl, fichier) as (
    values
        ('users',             'neon-schema.sql'),
        ('sessions',          'neon-schema.sql'),
        ('likes',             'neon-schema.sql'),
        ('passes',            'neon-schema.sql'),
        ('matches',           'neon-schema.sql'),
        ('messages',          'neon-schema.sql'),
        ('reports',           'neon-schema.sql'),
        ('blocks',            'neon-schema.sql'),
        ('quiz_sessions',     'neon-schema.sql'),
        ('payments',          'neon-schema.sql'),
        ('photos',            'A-COLLER-DANS-NEON.sql'),
        ('schema_migrations', 'A-COLLER-DANS-NEON.sql'),
        ('verifications',     'MIGRATION-SECURITE.sql'),
        ('chat_media',        'MIGRATION-SECURITE.sql'),
        ('admin_actions',     'MIGRATION-SECURITE.sql'),
        ('reglages',          'MIGRATION-PAIEMENTS.sql'),
        ('promoteurs',        'MIGRATION-PROMOTEURS.sql'),
        ('lieux',             'MIGRATION-PROMOTEURS.sql'),
        ('visites',           'MIGRATION-PROMOTEURS.sql'),
        ('suggestions_lieux', 'MIGRATION-PROMOTEURS.sql')
),
presentes as (
    select table_name
      from information_schema.tables
     where table_schema = 'public'
)
select attendues.tbl              as table_attendue,
       attendues.fichier          as fichier,
       case when presentes.table_name is null then '❌ MANQUE'
            else '✅ oui' end     as presente
  from attendues
  left join presentes on presentes.table_name = attendues.tbl
 order by (presentes.table_name is null) desc, attendues.tbl;

/* --------------------------------------------------------------------------
   2. Les compteurs — tolérants : une table absente ne fait pas échouer la
      requête, elle affiche simplement « table absente ».
   -------------------------------------------------------------------------- */
drop table if exists pg_temp.controles;
create temp table controles (quoi text, valeur text);

do $$
declare
    c record;
begin
    for c in
        select * from (values
            ('membres inscrits',    'select count(*)::text from public.users'),
            ('promoteurs',          'select count(*)::text from public.promoteurs'),
            ('lieux en attente',    'select count(*)::text from public.lieux where statut = ''en_attente'''),
            ('lieux publiés',       'select count(*)::text from public.lieux where statut = ''publie'''),
            ('lieux certifiés',     'select count(*)::text from public.lieux where certifie'),
            ('visites comptées',    'select count(*)::text from public.visites'),
            ('visites à facturer',  'select count(*)::text from public.visites where not reglee'),
            ('suggestions reçues',  'select count(*)::text from public.suggestions_lieux'),
            ('prix d''une visite',  'select coalesce((select valeur from public.reglages where cle = ''prix_visite''), ''non réglé'')')
        ) as t(quoi, requete)
    loop
        begin
            execute format(
                'insert into pg_temp.controles (quoi, valeur) select %L, x.v from (%s) as x(v)',
                c.quoi, c.requete
            );
        exception when others then
            insert into pg_temp.controles (quoi, valeur) values (c.quoi, 'table absente');
        end;
    end loop;
end $$;

select quoi, valeur from controles;

drop table if exists pg_temp.controles;
