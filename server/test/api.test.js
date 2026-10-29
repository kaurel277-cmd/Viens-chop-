/**
 * Tests d'intégration de l'API, exécutés contre un vrai PostgreSQL.
 *   NODE_ENV=test DATABASE_URL=... node --test test/
 *
 * Chaque test appelle l'API HTTP réelle : rien n'est simulé.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { app } from '../src/index.js';
import { closePool, query } from '../src/db.js';

let server;
let base;

const results = [];
function ok(name, detail = '') {
  results.push(name);
  console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Inscrit un utilisateur complet et renvoie son jeton. */
async function signup(phone, pseudo, extra = {}) {
  const v = await api('/api/auth/register', {
    method: 'POST',
    body: { phone, password: 'Chop2026!', birth_date: extra.birth_date || '2000-05-12' }
  });
  assert.equal(v.status, 201, `inscription : ${JSON.stringify(v.json)}`);

  const token = v.json.access_token;
  const p = await api('/api/users/me', {
    method: 'POST', token,
    body: {
      pseudo,
      birth_date: extra.birth_date || '2000-05-12',
      gender: extra.gender || 'F',
      commune: extra.commune || 'Cocody',
      artists: extra.artists || ['Himra', 'Didi B']
    }
  });
  assert.equal(p.status, 200, `profil : ${JSON.stringify(p.json)}`);
  return { token, id: p.json.user.id, refresh: v.json.refresh_token };
}

/** Donne une photo principale à un utilisateur (contourne l'upload multipart). */
async function donnerPhoto(userId) {
  const { rows } = await query(
    `insert into public.photos (user_id, position, mime, bytes, data)
     values ($1, 0, 'image/webp', 8, decode('5249464600000000', 'hex')) returning id`,
    [userId]
  );
  await query('update public.users set main_photo_id = $2 where id = $1', [userId, rows[0].id]);
  return rows[0].id;
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // Base propre pour la campagne
  await query(`truncate public.messages, public.matches, public.likes, public.passes,
                        public.sessions, public.reports, public.blocks, public.quiz_sessions,
                        public.payments, public.users cascade`);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await closePool();
});

/* ========================================================================== */
test('santé de l\'API', async () => {
  const { status, json } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  ok('GET /api/health', 'service en ligne');
});

test('inscription : numéro + mot de passe, sans SMS ni code', async () => {
  const tel = '+2250701000001';
  const r = await api('/api/auth/register', {
    method: 'POST', body: { phone: tel, password: 'Chop2026!', birth_date: '1999-06-01' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.access_token);
  ok('compte créé immédiatement', 'aucun code à recevoir');

  const tropCourt = await api('/api/auth/register', {
    method: 'POST', body: { phone: '+2250701000002', password: '123', birth_date: '1999-06-01' }
  });
  assert.equal(tropCourt.status, 400);
  ok('mot de passe trop court refusé', tropCourt.json.error.code);

  const doublon = await api('/api/auth/register', {
    method: 'POST', body: { phone: tel, password: 'Chop2026!', birth_date: '1999-06-01' }
  });
  assert.equal(doublon.status, 409);
  ok('un numéro = un seul compte', doublon.json.error.code);

  const mauvais = await api('/api/auth/login', { method: 'POST', body: { phone: tel, password: 'PasLeBon!' } });
  assert.equal(mauvais.status, 401);
  ok('mauvais mot de passe refusé');

  const bon = await api('/api/auth/login', { method: 'POST', body: { phone: tel, password: 'Chop2026!' } });
  assert.equal(bon.status, 200);
  assert.ok(bon.json.access_token);
  ok('bon mot de passe accepté');
});

// Plus aucun point d'entrée par code envoyé par SMS
test("l'ancienne connexion par code SMS n'existe plus", async () => {
  const a = await api('/api/auth/otp', { method: 'POST', body: { phone: '+2250701000001' } });
  const b = await api('/api/auth/verify', { method: 'POST', body: { phone: '+2250701000001', code: '123456' } });
  assert.equal(a.status, 404, '/api/auth/otp doit avoir disparu');
  assert.equal(b.status, 404, '/api/auth/verify doit avoir disparu');
  ok('routes SMS supprimées', '404 sur /otp et /verify');
});

test('numéro invalide refusé', async () => {
  const r = await api('/api/auth/register', {
    method: 'POST', body: { phone: 'abc', password: 'Chop2026!', birth_date: '1999-06-01' }
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'TELEPHONE_INVALIDE');
  ok('numéro invalide rejeté');
});

test('profil : majorité vérifiée par le serveur, pas par le client', async () => {
  const v = await api('/api/auth/register', {
    method: 'POST', body: { phone: '+2250701000099', password: 'Chop2026!', birth_date: '1995-02-02' }
  });

  const mineur = new Date();
  mineur.setFullYear(mineur.getFullYear() - 16);

  const r = await api('/api/users/me', {
    method: 'POST', token: v.json.access_token,
    body: { pseudo: 'Mineur', birth_date: mineur.toISOString().slice(0, 10), gender: 'M', commune: 'Abobo' }
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'MINEUR_INTERDIT');
  ok('mineur refusé même si le client ment', 'trigger PostgreSQL');
});

test('profil : champs invalides rejetés', async () => {
  const { token } = await signup('+2250701000002', 'Test2');

  const court = await api('/api/users/me', { method: 'POST', token, body: { pseudo: 'A' } });
  assert.equal(court.status, 400);
  ok('pseudo trop court refusé');

  const trop = await api('/api/users/me', { method: 'POST', token, body: { artists: Array(20).fill('X') } });
  assert.equal(trop.status, 400);
  ok('plus de 12 artistes refusé');
});

test('fil de découverte : filtres respectés et photo exposée', async () => {
  const awa   = await signup('+2250701000010', 'Awa',   { gender: 'F', commune: 'Cocody' });
  const franck = await signup('+2250701000011', 'Franck', { gender: 'M', commune: 'Cocody' });
  const photoId = await donnerPhoto(franck.id);

  const feed = await api('/api/feed', { token: awa.token });
  assert.equal(feed.status, 200);
  const ligne = feed.json.profiles.find((p) => p.id === franck.id);
  assert.ok(ligne, 'Franck doit figurer dans le fil d\'Awa');
  assert.ok(!feed.json.profiles.some((p) => p.pseudo === 'Awa'), 'on ne se voit pas soi-même');
  assert.equal(ligne.main_photo_id, photoId, 'la photo doit être exposée dans le fil');
  assert.equal(ligne.has_photo, true);
  ok('fil : photo exposée', `${feed.json.profiles.length} profils`);
});

test('passer un profil : il ne revient plus dans le fil', async () => {
  const moi   = await signup('+2250701000015', 'PasseMe', { gender: 'M', commune: 'Abobo' });
  const autre = await signup('+2250701000016', 'PasseLui', { gender: 'F', commune: 'Abobo' });

  const avant = await api('/api/feed', { token: moi.token });
  assert.ok(avant.json.profiles.some(p => p.id === autre.id), 'le profil doit être proposé au départ');

  const p1 = await api('/api/likes/pass', { method: 'POST', token: moi.token, body: { user_id: autre.id } });
  assert.equal(p1.status, 201);
  assert.equal(p1.json.stored, true);

  const apres = await api('/api/feed', { token: moi.token });
  assert.ok(!apres.json.profiles.some(p => p.id === autre.id), 'le profil passé ne doit plus revenir');
  ok('profil passé = définitivement écarté du fil');

  const p2 = await api('/api/likes/pass', { method: 'POST', token: moi.token, body: { user_id: autre.id } });
  assert.equal(p2.status, 201, 'passer deux fois ne doit pas planter');
  ok('passer deux fois : sans erreur');
});

test('like réciproque -> match', async () => {
  const j1 = await signup('+2250701000020', 'J1', { gender: 'F' });
  const j2 = await signup('+2250701000021', 'J2', { gender: 'M' });
  await donnerPhoto(j2.id);

  const l1 = await api('/api/likes', { method: 'POST', token: j1.token, body: { user_id: j2.id } });
  assert.equal(l1.status, 201);
  assert.equal(l1.json.matched, false);
  ok('un like seul ne crée pas de match');

  const l2 = await api('/api/likes', { method: 'POST', token: j2.token, body: { user_id: j1.id } });
  assert.equal(l2.status, 201);
  assert.equal(l2.json.matched, true);
  assert.ok(l2.json.match_id);
  ok('like réciproque -> match', `match ${l2.json.match_id.slice(0, 8)}…`);

  const ms = await api('/api/matches', { token: j1.token });
  assert.equal(ms.json.matches.length, 1);
  assert.ok(ms.json.matches[0].other_photo_url, 'la photo doit être visible dès le match');
  assert.equal(ms.json.matches[0].photo_unlocked, false, 'photo_unlocked ne pilote plus rien');
  ok('photo visible dès le match, sans attendre aucun message');
});

test('quota de 3 likes/jour en Mode Coulé', async () => {
  const me = await signup('+2250701000030', 'QuotaMe', { gender: 'F' });
  const cibles = [];
  for (let i = 0; i < 4; i++) {
    cibles.push(await signup('+225070100003' + (1 + i), 'Cible' + i, { gender: 'M' }));
  }

  for (let i = 0; i < 3; i++) {
    const r = await api('/api/likes', { method: 'POST', token: me.token, body: { user_id: cibles[i].id } });
    assert.equal(r.status, 201, `like ${i + 1} : ${JSON.stringify(r.json)}`);
  }
  ok('3 likes acceptés');

  const trop = await api('/api/likes', { method: 'POST', token: me.token, body: { user_id: cibles[3].id } });
  assert.equal(trop.status, 429);
  assert.equal(trop.json.error.code, 'QUOTA_LIKES');
  ok('4ᵉ like refusé (429)', 'quota tenu par la base');

  // En Mode Debout, le quota saute
  await query(`update public.users set plan = 'debout', plan_expires_at = now() + interval '30 days'
                where id = $1`, [me.id]);
  const debout = await api('/api/likes', { method: 'POST', token: me.token, body: { user_id: cibles[3].id } });
  assert.equal(debout.status, 201);
  ok('likes illimités en Mode Debout');
});

test('chat : photo visible dès le premier message', async () => {
  const a = await signup('+2250701000040', 'ChatA', { gender: 'F' });
  const b = await signup('+2250701000041', 'ChatB', { gender: 'M' });
  const photoB = await donnerPhoto(b.id);

  // La photo se voit avant même le match
  const profil = await api(`/api/users/${b.id}`, { token: a.token });
  assert.equal(profil.status, 200);
  assert.equal(profil.json.profile.photo_url, `/api/photos/${photoB}`);
  assert.equal(profil.json.profile.photo_count, 1);
  ok('profil public : photo et nombre de photos renvoyés');

  await api('/api/likes', { method: 'POST', token: a.token, body: { user_id: b.id } });
  const l = await api('/api/likes', { method: 'POST', token: b.token, body: { user_id: a.id } });
  const matchId = l.json.match_id;

  const ms0 = await api('/api/matches', { token: a.token });
  assert.ok(ms0.json.matches[0].other_photo_url, 'photo attendue dès le match, sans message');
  ok('match : photo disponible à 0 message');

  for (let i = 1; i <= 5; i++) {
    const r = await api(`/api/matches/${matchId}/messages`, {
      method: 'POST', token: i % 2 ? a.token : b.token, body: { body: 'message ' + i }
    });
    assert.equal(r.status, 201);
    assert.ok(r.json.other_photo_url === undefined || r.json.other_photo_url, 'photo jamais masquée');
  }
  ok('photo visible pendant les 5 premiers messages');

  const ms = await api('/api/matches', { token: a.token });
  assert.ok(ms.json.matches[0].other_photo_url, 'photo toujours là après 5 messages');
  assert.equal(ms.json.matches[0].photo_unlocked, true, 'photo_unlocked reste informatif');
  ok('photo_unlocked conservé pour compatibilité');
});

test('chat : un tiers ne peut pas lire ni écrire', async () => {
  const a = await signup('+2250701000050', 'TiersA', { gender: 'F' });
  const b = await signup('+2250701000051', 'TiersB', { gender: 'M' });
  const c = await signup('+2250701000052', 'TiersC', { gender: 'F' });
  await api('/api/likes', { method: 'POST', token: a.token, body: { user_id: b.id } });
  const l = await api('/api/likes', { method: 'POST', token: b.token, body: { user_id: a.id } });

  const read = await api(`/api/matches/${l.json.match_id}/messages`, { token: c.token });
  assert.equal(read.status, 404);
  ok('lecture du match refusée à un tiers');

  const write = await api(`/api/matches/${l.json.match_id}/messages`, {
    method: 'POST', token: c.token, body: { body: 'intrusion' }
  });
  assert.equal(write.status, 404);
  ok('écriture refusée à un tiers');
});

test('message vide refusé', async () => {
  const a = await signup('+2250701000060', 'VideA', { gender: 'F' });
  const b = await signup('+2250701000061', 'VideB', { gender: 'M' });
  await api('/api/likes', { method: 'POST', token: a.token, body: { user_id: b.id } });
  const l = await api('/api/likes', { method: 'POST', token: b.token, body: { user_id: a.id } });

  const r = await api(`/api/matches/${l.json.match_id}/messages`, {
    method: 'POST', token: a.token, body: { body: '    ' }
  });
  assert.equal(r.status, 400);
  ok('message vide refusé');
});

test('faux appel : 1 par semaine en gratuit', async () => {
  const u = await signup('+2250701000070', 'AppelU', { gender: 'F' });

  const first = await api('/api/safety/fake-call', { method: 'POST', token: u.token });
  assert.equal(first.status, 200);
  ok('1er faux appel autorisé');

  const second = await api('/api/safety/fake-call', { method: 'POST', token: u.token });
  assert.equal(second.status, 429);
  assert.equal(second.json.error.code, 'QUOTA_FAUX_APPEL');
  ok('2ᵉ faux appel refusé la même semaine');
});

test('qui m\'a liké : liste offerte, photo réservée au Mode Debout', async () => {
  const cible = await signup('+2250701000080', 'Cible80', { gender: 'F' });
  const fan   = await signup('+2250701000081', 'Fan81',   { gender: 'M' });
  const photoFan = await donnerPhoto(fan.id);
  await api('/api/likes', { method: 'POST', token: fan.token, body: { user_id: cible.id } });

  const gratuit = await api('/api/likes/who-liked-me', { token: cible.token });
  const ligne = gratuit.json.likes.find((l) => l.user_id === fan.id);
  assert.ok(ligne, 'le like doit apparaître');
  assert.equal(ligne.photo_url, null);
  assert.equal(ligne.photo_visible, false);
  ok('liste visible, photo réservée au Debout');

  await query(`update public.users set plan = 'debout', plan_expires_at = now() + interval '30 days'
                where id = $1`, [cible.id]);
  const debout = await api('/api/likes/who-liked-me', { token: cible.token });
  const ligne2 = debout.json.likes.find((l) => l.user_id === fan.id);
  assert.equal(ligne2.photo_url, `/api/photos/${photoFan}`);
  assert.equal(ligne2.photo_visible, true);
  ok('photo révélée en Mode Debout');
});

test('blocage : le profil disparaît du fil', async () => {
  const a = await signup('+2250701000090', 'BlockA', { gender: 'F', commune: 'Abobo' });
  const b = await signup('+2250701000091', 'BlockB', { gender: 'M', commune: 'Abobo' });

  const avant = await api('/api/feed', { token: a.token });
  assert.ok(avant.json.profiles.some((p) => p.id === b.id));

  await api('/api/safety/block', { method: 'POST', token: a.token, body: { user_id: b.id } });

  const apres = await api('/api/feed', { token: a.token });
  assert.ok(!apres.json.profiles.some((p) => p.id === b.id));
  ok('profil bloqué absent du fil');
});

test('signalement enregistré', async () => {
  const a = await signup('+2250701000095', 'SigA', { gender: 'F' });
  const b = await signup('+2250701000096', 'SigB', { gender: 'M' });

  const r = await api('/api/safety/report', {
    method: 'POST', token: a.token,
    body: { user_id: b.id, reason: 'fake_profile', details: 'Photos volées' }
  });
  assert.equal(r.status, 201);

  const invalide = await api('/api/safety/report', {
    method: 'POST', token: a.token, body: { user_id: b.id, reason: 'nimporte-quoi' }
  });
  assert.equal(invalide.status, 400);
  ok('signalement valide accepté, motif inconnu refusé');
});

test('jeton : accès sans jeton refusé, refresh fonctionnel', async () => {
  const sans = await api('/api/feed');
  assert.equal(sans.status, 401);
  ok('accès sans jeton refusé');

  const u = await signup('+2250701000098', 'Refresh', { gender: 'F' });
  const r = await api('/api/auth/refresh', { method: 'POST', body: { refresh_token: u.refresh } });
  assert.equal(r.status, 200);
  assert.ok(r.json.access_token);
  assert.notEqual(r.json.refresh_token, u.refresh);
  ok('refresh token tourné', 'l\'ancien est révoqué');

  const rejoue = await api('/api/auth/refresh', { method: 'POST', body: { refresh_token: u.refresh } });
  assert.equal(rejoue.status, 401);
  ok('ancien refresh token rejoué refusé');
});

test('récapitulatif', () => {
  console.log(`\n${results.length} vérifications passées\n`);
});
