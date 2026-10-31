/* ==========================================================================
   Viens chop — LA PHOTO D'UN LIEU (Coins Chill)
   ==========================================================================

   À coller dans Neon → SQL Editor → Run, une seule fois.

   Ce que ça ajoute à la table public.lieux :
     • photo        : l'image elle-même, en petit format (WebP ou JPEG)
     • photo_mime   : image/webp ou image/jpeg
     • photo_bytes  : le poids, pour l'affichage et le contrôle
     • photo_at     : la date du dernier envoi (sert à forcer le
                      rechargement de l'image dans le navigateur)

   Pourquoi dans Neon et pas sur Render : le disque de Render est effacé à
   chaque redéploiement. Même choix que les photos de profil des membres.

   Poids : une photo de lieu est ramenée sous 140 Ko par le navigateur avant
   l'envoi. Neon offre 0,5 Go : de quoi stocker plus de 3 000 photos de lieux.

   Sans danger à rejouer : les colonnes déjà présentes sont laissées telles
   quelles, aucune donnée n'est modifiée.
   ========================================================================== */

alter table public.lieux
    add column if not exists photo       bytea,
    add column if not exists photo_mime  varchar(20),
    add column if not exists photo_bytes int,
    add column if not exists photo_at    timestamptz;

/* Vérification : les 4 colonnes doivent apparaître. */
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'lieux'
--    and column_name like 'photo%'
--  order by column_name;
