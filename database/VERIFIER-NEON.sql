-- ============================================================================
-- VIENS CHOP — Vérification de l'installation
--
-- À coller dans Neon → SQL Editor APRÈS avoir exécuté neon-schema.sql.
-- Aucune ligne de commande nécessaire : ce fichier est du SQL pur.
--
-- Il crée des données de test, vérifie les 9 règles métier, puis nettoie
-- tout. La dernière requête affiche le rapport.
--
-- ⚠️ Ne pas exécuter sur une base contenant de vraies données : le nettoyage
--    final supprime uniquement les comptes de test (+225070999xxxx).
-- ============================================================================

drop table if exists public._verifications;
create table public._verifications (
    n       int primary key,
    regle   text not null,
    resultat text not null
);

do $$
declare
    v_awa     uuid;
    v_franck  uuid;
    v_match   uuid;
    v_count   int;
    v_photo   text;
    v_plan    text;
    v_expire  timestamptz;
    v_age     int;
    v_ok      boolean;
    i         int;
begin
    ---------------------------------------------------------------- 1
    insert into public.users (phone, pseudo, gender, seeking, birth_date, commune, artists)
    values ('+2250709990001', 'TestAwa', 'F', 'A', current_date - interval '26 years', 'Cocody', array['Himra','Didi B'])
    returning id into v_awa;

    insert into public.users (phone, pseudo, gender, seeking, birth_date, commune, artists)
    values ('+2250709990002', 'TestFranck', 'M', 'F', current_date - interval '27 years', 'Yopougon', array['Jul'])
    returning id into v_franck;
    select age into v_age from public.users where id = v_awa;
    insert into public._verifications values (1, 'Âge calculé automatiquement',
        case when v_age between 25 and 27 then 'OK (' || v_age || ' ans)' else 'ÉCHEC : ' || v_age end);

    ---------------------------------------------------------------- 2
    begin
        insert into public.users (phone, pseudo, birth_date, commune)
        values ('+2250709990099', 'TestMineur', current_date - interval '16 years', 'Abobo');
        insert into public._verifications values (2, 'Mineur refusé', 'ÉCHEC : un mineur a été accepté');
    exception when check_violation then
        insert into public._verifications values (2, 'Mineur refusé', 'OK');
    end;

    ---------------------------------------------------------------- 3
    insert into public.likes (sender_id, receiver_id) values (v_awa, v_franck);
    select count(*) into v_count from public.matches;
    insert into public._verifications values (3, 'Un like seul ne crée pas de match',
        case when v_count = 0 then 'OK' else 'ÉCHEC : match créé trop tôt' end);

    ---------------------------------------------------------------- 4
    insert into public.likes (sender_id, receiver_id) values (v_franck, v_awa);
    select count(*) into v_count from public.matches;
    insert into public._verifications values (4, 'Like réciproque → match',
        case when v_count = 1 then 'OK' else 'ÉCHEC : pas de match' end);

    select id into v_match from public.matches limit 1;

    ---------------------------------------------------------------- 5
    begin
        insert into public.likes (sender_id, receiver_id) values (v_awa, v_franck);
        insert into public._verifications values (5, 'Like en double refusé', 'ÉCHEC : doublon accepté');
    exception when unique_violation then
        insert into public._verifications values (5, 'Like en double refusé', 'OK');
    end;

    ---------------------------------------------------------------- 6
    begin
        insert into public.likes (sender_id, receiver_id) values (v_awa, v_awa);
        insert into public._verifications values (6, 'Auto-like refusé', 'ÉCHEC : auto-like accepté');
    exception when check_violation then
        insert into public._verifications values (6, 'Auto-like refusé', 'OK');
    end;

    ---------------------------------------------------------------- 7
    -- quota : 3 likes max par jour en Mode Coulé
    insert into public.users (phone, pseudo, birth_date, commune)
    values ('+2250709990011', 'TestC1', current_date - interval '24 years', 'Abobo'),
           ('+2250709990012', 'TestC2', current_date - interval '24 years', 'Abobo'),
           ('+2250709990013', 'TestC3', current_date - interval '24 years', 'Abobo');

    -- Awa a déjà liké Franck (1 like). On en ajoute 2, puis un 4e doit échouer.
    insert into public.likes (sender_id, receiver_id)
    select v_awa, id from public.users where phone in ('+2250709990011','+2250709990012');

    begin
        insert into public.likes (sender_id, receiver_id)
        select v_awa, id from public.users where phone = '+2250709990013';
        insert into public._verifications values (7, 'Quota de 3 likes/jour',
            'ÉCHEC : un 4e like a été accepté');
    exception when check_violation then
        insert into public._verifications values (7, 'Quota de 3 likes/jour', 'OK (4e like refusé)');
    end;

    ---------------------------------------------------------------- 8
    update public.users set plan = 'debout', plan_expires_at = now() + interval '30 days'
     where id = v_awa;
    begin
        insert into public.likes (sender_id, receiver_id)
        select v_awa, id from public.users where phone = '+2250709990013';
        insert into public._verifications values (8, 'Likes illimités en Mode Debout', 'OK');
    exception when check_violation then
        insert into public._verifications values (8, 'Likes illimités en Mode Debout',
            'ÉCHEC : quota encore appliqué');
    end;

    ---------------------------------------------------------------- 9
    for i in 1..4 loop
        insert into public.messages (match_id, sender_id, body)
        values (v_match, case when i % 2 = 1 then v_awa else v_franck end, 'message ' || i);
    end loop;

    select (unlocked_at is not null) into v_ok from public.matches where id = v_match;
    if v_ok then
        insert into public._verifications values (9, 'Photo NON débloquée après 4 messages',
            'ÉCHEC : débloquée trop tôt');
    else
        insert into public.messages (match_id, sender_id, body) values (v_match, v_awa, 'message 5');
        select (unlocked_at is not null) into v_ok from public.matches where id = v_match;
        insert into public._verifications values (9, 'Photo débloquée au 5e message',
            case when v_ok then 'OK' else 'ÉCHEC : toujours verrouillée' end);
    end if;

    ---------------------------------------------------------------- 10
    begin
        insert into public.messages (match_id, sender_id, body)
        select v_match, id, 'intrusion' from public.users where phone = '+2250709990011';
        insert into public._verifications values (10, 'Écriture refusée à un tiers',
            'ÉCHEC : un intrus a écrit');
    exception when insufficient_privilege then
        insert into public._verifications values (10, 'Écriture refusée à un tiers', 'OK');
    end;

    ---------------------------------------------------------------- 11
    begin
        insert into public.messages (match_id, sender_id, body) values (v_match, v_awa, '   ');
        insert into public._verifications values (11, 'Message vide refusé', 'ÉCHEC : accepté');
    exception when check_violation then
        insert into public._verifications values (11, 'Message vide refusé', 'OK');
    end;

    ---------------------------------------------------------------- 12
    -- Awa est passée en Debout à l'étape 8 : le quota ne s'applique qu'en gratuit
    update public.users set plan = 'coupe', plan_expires_at = null where id = v_awa;
    update public.users set fake_call_last_used = now() where id = v_awa;
    begin
        update public.users set fake_call_last_used = now() + interval '1 hour' where id = v_awa;
        insert into public._verifications values (12, 'Faux appel limité à 1/semaine',
            'ÉCHEC : 2e essai accepté');
    exception when check_violation then
        insert into public._verifications values (12, 'Faux appel limité à 1/semaine', 'OK');
    end;

    ---------------------------------------------------------------- 13
    insert into public.payments (user_id, provider, provider_ref, amount_fcfa, status)
    values (v_franck, 'wave', 'TEST-WAVE-1', 700, 'pending');
    update public.payments set status = 'paid' where provider_ref = 'TEST-WAVE-1';

    select plan, plan_expires_at into v_plan, v_expire from public.users where id = v_franck;
    insert into public._verifications values (13, 'Paiement → 30 jours de Mode Debout',
        case when v_plan = 'debout' and v_expire > now() + interval '29 days'
             then 'OK' else 'ÉCHEC' end);

    ---------------------------------------------------------------- 14
    select photo_url into v_photo
      from public.who_liked_me w
     where w.user_id = (select id from public.users where phone = '+2250709990011')
     limit 1;
    insert into public._verifications values (14, 'Vue « qui m''a liké »',
        case when v_photo is null then 'OK (photo masquée)' else 'ÉCHEC' end);

    ---------------------------------------------------------------- nettoyage
    delete from public.payments where provider_ref = 'TEST-WAVE-1';
    delete from public.messages where match_id = v_match;
    delete from public.matches;
    delete from public.likes;
    delete from public.users where phone like '+225070999%';
end;
$$;

-- Rapport
select n as "#", regle as "Règle vérifiée", resultat as "Résultat"
  from public._verifications
 order by n;

-- À exécuter ensuite pour effacer le tableau de rapport :
-- drop table if exists public._verifications;
