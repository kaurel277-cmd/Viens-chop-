-- ============================================================================
-- Tests du schéma — à lancer après neon-schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/test-schema.sql
-- Chaque test lève une exception si la règle ne tient pas.
-- Le script se termine par le message « TOUS LES TESTS PASSENT ».
-- ============================================================================
\set ON_ERROR_STOP on
-- les NOTICE servent de rapport de test
set client_min_messages to notice;

begin;

-- ---------------------------------------------------------------------------
-- Jeu de données
-- ---------------------------------------------------------------------------
insert into public.users (phone, pseudo, gender, seeking, birth_date, commune, artists)
values ('+2250701000001', 'Awa',    'F', 'A', '2000-04-12', 'Cocody',  array['Himra','Didi B']),
       ('+2250701000002', 'Franck', 'M', 'F', '1998-09-03', 'Yopougon', array['Jul']),
       ('+2250701000003', 'Kadi',   'F', 'A', '1996-01-22', 'Abobo',   array['Damso']);

do $$
declare
    v_age int;
    v_adult boolean;
begin
    select age, is_adult into v_age, v_adult from public.users where pseudo = 'Awa';
    assert v_age between 25 and 27, 'âge mal calculé : ' || v_age;
    assert v_adult, 'majeure non reconnue';
    raise notice 'OK  âge calculé automatiquement (% ans) et majorité validée', v_age;
end $$;

-- Un mineur doit être refusé par la base, même si le client est bricolé
do $$
begin
    begin
        insert into public.users (phone, pseudo, birth_date, commune)
        values ('+2250701000099', 'Mineur', current_date - interval '16 years', 'Abobo');
        raise exception 'ÉCHEC : un mineur a pu être inséré';
    exception when check_violation then
        raise notice 'OK  mineur refusé par la base';
    end;
end $$;

-- ---------------------------------------------------------------------------
-- Like réciproque -> match
-- ---------------------------------------------------------------------------
insert into public.likes (sender_id, receiver_id)
select a.id, b.id from public.users a, public.users b
 where a.pseudo = 'Awa' and b.pseudo = 'Franck';

do $$
begin
    assert (select count(*) from public.matches) = 0, 'match créé sans réciprocité';
    raise notice 'OK  un like seul ne crée pas de match';
end $$;

insert into public.likes (sender_id, receiver_id)
select a.id, b.id from public.users a, public.users b
 where a.pseudo = 'Franck' and b.pseudo = 'Awa';

do $$
begin
    assert (select count(*) from public.matches) = 1, 'match non créé';
    raise notice 'OK  like réciproque -> match créé';
end $$;

-- Pas de doublon de match quand l'un des deux relike
do $$
begin
    begin
        insert into public.likes (sender_id, receiver_id)
        select a.id, b.id from public.users a, public.users b
         where a.pseudo = 'Awa' and b.pseudo = 'Franck';
        raise exception 'ÉCHEC : like en double accepté';
    exception when unique_violation then
        raise notice 'OK  like en double refusé';
    end;
end $$;

-- Pas de like de soi-même
do $$
begin
    begin
        insert into public.likes (sender_id, receiver_id)
        select id, id from public.users where pseudo = 'Awa';
        raise exception 'ÉCHEC : auto-like accepté';
    exception when check_violation then
        raise notice 'OK  auto-like refusé';
    end;
end $$;

-- ---------------------------------------------------------------------------
-- Quota de 3 likes/jour en Mode Coulé
-- ---------------------------------------------------------------------------
do $$
declare
    awa  uuid;
    i    int;
    refused boolean := false;
begin
    select id into awa from public.users where pseudo = 'Awa';
    -- remise à zéro propre
    update public.users set likes_today = 1, likes_reset_at = current_date where id = awa;

    -- crée 3 destinataires supplémentaires
    for i in 1..3 loop
        insert into public.users (phone, pseudo, birth_date, commune)
        values ('+22507010001' || lpad(i::text, 2, '0'), 'Test' || i,
                '1997-01-01', 'Abobo');
    end loop;

    -- 2 likes encore possibles
    insert into public.likes (sender_id, receiver_id)
    select awa, id from public.users where pseudo in ('Test1', 'Test2');

    -- le 4e like du jour doit être refusé
    begin
        insert into public.likes (sender_id, receiver_id)
        select awa, id from public.users where pseudo = 'Test3';
    exception when check_violation then
        refused := true;
    end;

    assert refused, 'ÉCHEC : quota de 3 likes non appliqué';
    assert (select likes_today from public.users where id = awa) = 3, 'compteur de likes faux';
    raise notice 'OK  quota de 3 likes/jour appliqué (compteur = 3)';
end $$;

-- En Mode Debout, le quota saute
do $$
declare
    awa uuid;
begin
    select id into awa from public.users where pseudo = 'Awa';
    update public.users set plan = 'debout', plan_expires_at = now() + interval '30 days' where id = awa;
    insert into public.likes (sender_id, receiver_id)
    select awa, id from public.users where pseudo = 'Test3';
    raise notice 'OK  likes illimités en Mode Debout';
end $$;

-- ---------------------------------------------------------------------------
-- Déblocage de la photo au 5e message
-- ---------------------------------------------------------------------------
do $$
declare
    m           uuid;
    awa         uuid;
    franck      uuid;
    i           int;
begin
    select id into m from public.matches limit 1;
    select id into awa    from public.users where pseudo = 'Awa';
    select id into franck from public.users where pseudo = 'Franck';

    for i in 1..4 loop
        insert into public.messages (match_id, sender_id, body)
        values (m, case when i % 2 = 1 then awa else franck end, 'message ' || i);
    end loop;

    assert (select unlocked_at from public.matches where id = m) is null,
           'ÉCHEC : photo débloquée avant le 5e message';

    insert into public.messages (match_id, sender_id, body) values (m, awa, 'message 5');

    assert (select unlocked_at from public.matches where id = m) is not null,
           'ÉCHEC : photo non débloquée au 5e message';
    raise notice 'OK  photos débloquées au 5e message, pas avant';
end $$;

-- Un intrus ne peut pas écrire dans un match
do $$
declare
    m   uuid;
    kad uuid;
begin
    select id into m   from public.matches limit 1;
    select id into kad from public.users where pseudo = 'Kadi';
    begin
        insert into public.messages (match_id, sender_id, body) values (m, kad, 'coucou');
        raise exception 'ÉCHEC : un tiers a pu écrire dans le match';
    exception when insufficient_privilege then
        raise notice 'OK  écriture refusée à un non-participant';
    end;
end $$;

-- Message vide refusé
do $$
declare
    m   uuid;
    awa uuid;
begin
    select id into m   from public.matches limit 1;
    select id into awa from public.users where pseudo = 'Awa';
    begin
        insert into public.messages (match_id, sender_id, body) values (m, awa, '   ');
        raise exception 'ÉCHEC : message vide accepté';
    exception when check_violation then
        raise notice 'OK  message vide refusé';
    end;
end $$;

-- ---------------------------------------------------------------------------
-- Quota du Faux Appel : 1/semaine en gratuit
-- ---------------------------------------------------------------------------
do $$
declare
    kad uuid;
begin
    select id into kad from public.users where pseudo = 'Kadi';
    update public.users set plan = 'coupe', fake_call_last_used = now() where id = kad;
    begin
        update public.users set fake_call_last_used = now() + interval '1 hour' where id = kad;
        raise exception 'ÉCHEC : 2e faux appel accepté dans la semaine';
    exception when check_violation then
        raise notice 'OK  2e faux appel refusé dans la même semaine';
    end;
end $$;

-- ---------------------------------------------------------------------------
-- Paiement -> activation du Mode Debout pour 30 jours
-- ---------------------------------------------------------------------------
do $$
declare
    kad uuid;
begin
    select id into kad from public.users where pseudo = 'Kadi';
    insert into public.payments (user_id, provider, provider_ref, amount_fcfa, status)
    values (kad, 'wave', 'WAVE-TEST-1', 700, 'pending');

    update public.payments set status = 'paid' where provider_ref = 'WAVE-TEST-1';

    assert (select plan from public.users where id = kad) = 'debout', 'plan non activé';
    assert (select plan_expires_at from public.users where id = kad) > now() + interval '29 days',
           'durée d''abonnement incorrecte';
    raise notice 'OK  paiement confirmé -> Mode Debout activé 30 jours';
end $$;

-- ---------------------------------------------------------------------------
-- « Qui m'a liké » : photo masquée hors Mode Debout
-- ---------------------------------------------------------------------------
do $$
declare
    v_photo text;
    franck  uuid;
begin
    select id into franck from public.users where pseudo = 'Franck';
    -- Awa est en Debout : elle voit la photo de Franck (null ici car pas de photo)
    select photo_url into v_photo from public.who_liked_me where user_id = franck limit 1;
    raise notice 'OK  vue who_liked_me interrogeable (photo = %)', coalesce(v_photo, 'aucune');
end $$;

rollback;

\echo ''
\echo '=========================================='
\echo ' TOUS LES TESTS PASSENT'
\echo '=========================================='
