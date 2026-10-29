-- ============================================================================
-- VIENS CHOP — Remise à zéro de la base
--
-- À utiliser si l'installation s'est faite à moitié (certaines tables
-- existent, d'autres non) ou si /api/health/db renvoie SCHEMA_ABSENT.
--
-- ⚠️ CE SCRIPT SUPPRIME TOUT ce que Viens chop a créé dans la base :
--    tables, vues, fonctions, triggers. Données comprises.
--
-- Utilisable sans risque tant que l'inscription n'a jamais fonctionné :
-- s'il n'y a aucun compte dans public.users, rien ne peut être perdu.
--
-- Marche à suivre :
--   1. Coller CE fichier dans Neon → SQL Editor, puis Run.
--   2. Coller ensuite neon-schema.sql en entier, puis Run.
--   3. Recharger /api/health/db : tout doit être à true, triggers 7 / 7.
-- ============================================================================

-- 1. Vues
drop view  if exists public.who_liked_me cascade;

-- 2. Tables, dans l'ordre inverse des dépendances
drop table if exists public.messages      cascade;
drop table if exists public.matches       cascade;
drop table if exists public.likes         cascade;
drop table if exists public.reports       cascade;
drop table if exists public.blocks        cascade;
drop table if exists public.quiz_sessions cascade;
drop table if exists public.payments      cascade;
drop table if exists public.sessions      cascade;
drop table if exists public.passes        cascade;
drop table if exists public.users         cascade;

-- 3. Schéma applicatif (fonctions et vues internes)
drop schema if exists app cascade;

-- 4. Extension (laissée en place : elle ne gêne pas à la réinstallation)
--    create extension if not exists "pgcrypto";

-- Rapport : il ne doit plus rester aucune table applicative.
select
    'tables restantes : ' || count(*)::text as etat
from information_schema.tables
where table_schema = 'public'
  and table_name in ('users','sessions','likes','matches','passes',
                     'messages','reports','blocks','quiz_sessions','payments');

-- Attendu : "tables restantes : 0"
-- Ensuite : exécuter neon-schema.sql en entier.
