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
  const a = await api('/api/auth/otp', { method: 'POST', body: { phone } });
  assert.equal(a.status, 200, `envoi OTP : ${JSON.stringify(a.json)}`);
  const code = a.json.dev_code || '123456';

  const v = await api('/api/auth/verify', { method: 'POST', body: { phone, code } });
  assert.equal(v.status, 200, `vérification OTP : ${JSON.stringify(v.json)}`);

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

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // Base propre pour la campagne
  await query(`truncate public.messages, public.matches, public.likes, public.sessions,
                        public.otp_codes, public.reports, public.blocks, public.quiz_sessions,
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

test('inscription : OTP -> compte créé automatiquement', async () => {
  const a = await api('/api/auth/otp', { method: 'POST', body: { phone: '+2250701000001' } });
  assert.equal(a.status, 200);
  ok('envoi du code OTP');

  const bad = await api('/api/auth/verify', { method: 'POST', body: { phone: '+2250701000001', code: '000000' } });
  assert.equal(bad.status, 400);
  ok('code erroné refusé', bad.json.error.code);

  const v = await api('/api/auth/verify', { method: 'POST', body: { phone: '+2250701000001', code: a.json.dev_code } });
  assert.equal(v.status, 200);
  assert.ok(v.json.access_token);
  assert.equal(v.json.is_new, true);
  ok('compte créé sans aucune validation par lien', 'is_new = true');

  // Le même numéro ne crée pas de doublon
  const a2 = await api('/api/auth/otp', { method: 'POST', body: { phone: '0701000001' } });
  const v2 = await api('/api/auth/verify', { method: 'POST', body: { phone: '0701000001', code: a2.json.dev_code } });
  assert.equal(v2.json.is_new, false);
  assert.equal(v2.json.user.id, v.json.user.id);
  ok('un numéro = un seul compte', 'is_new = false au 2ᵉ passage');
});

test('numéro invalide refusé', async () => {
  const r = await api('/api/auth/otp', { method: 'POST', body: { phone: 'abc' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'TELEPHONE_INVALIDE');
  ok('numéro invalide rejeté');
});

test('profil : majorité vérifiée par le serveur, pas par le client', async () => {
  const a = await api('/api/auth/otp', { method: 'POST', body: { phone: '+2250701000099' } });
  const v = await api('/api/auth/verify', { method: 'POST', body: { phone: '+2250701000099', code: a.json.dev_code } });

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

test('fil de découverte : filtres et photo jamais exposée', async () => {
  const awa   = await signup('+2250701000010', 'Awa',   { gender: 'F', commune: 'Cocody' });
  const franck = await signup('+2250701000011', 'Franck', { gender: 'M', commune: 'Cocody' });

  const feed = await api('/api/feed', { token: awa.token });
  assert.equal(feed.status, 200);
  assert.ok(feed.json.profiles.length >= 1);
  assert.ok(!('photo_url' in feed.json.profiles[0]), 'la photo ne doit pas figurer dans le fil');
  ok('fil renvoyé sans photo', `${feed.json.profiles.length} profils`);
});

test('like réciproque -> match', async () => {
  const j1 = await signup('+2250701000020', 'J1', { gender: 'F' });
  const j2 = await signup('+2250701000021', 'J2', { gender: 'M' });

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
  assert.equal(ms.json.matches[0].photo_unlocked, false);
  ok('match visible sans photo débloquée');
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

test('chat : photo débloquée au 5ᵉ message, pas avant', async () => {
  const a = await signup('+2250701000040', 'ChatA', { gender: 'F' });
  const b = await signup('+2250701000041', 'ChatB', { gender: 'M' });
  await api('/api/likes', { method: 'POST', token: a.token, body: { user_id: b.id } });
  const l = await api('/api/likes', { method: 'POST', token: b.token, body: { user_id: a.id } });
  const matchId = l.json.match_id;

  for (let i = 1; i <= 4; i++) {
    const r = await api(`/api/matches/${matchId}/messages`, {
      method: 'POST', token: i % 2 ? a.token : b.token, body: { body: 'message ' + i }
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.photo_unlocked, false, `débloqué trop tôt au message ${i}`);
  }
  ok('non débloquée après 4 messages');

  const fifth = await api(`/api/matches/${matchId}/messages`, {
    method: 'POST', token: a.token, body: { body: 'message 5' }
  });
  assert.equal(fifth.json.photo_unlocked, true);
  ok('débloquée au 5ᵉ message');

  const ms = await api('/api/matches', { token: a.token });
  assert.equal(ms.json.matches[0].photo_unlocked, true);
  ok('le match expose alors photo_unlocked = true');
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

test('qui m\'a liké : photo masquée hors Mode Debout', async () => {
  const cible = await signup('+2250701000080', 'Cible80', { gender: 'F' });
  const fan   = await signup('+2250701000081', 'Fan81',   { gender: 'M' });
  await query(`update public.users set photo_url = 'https://cdn.exemple/photo.jpg' where id = $1`, [fan.id]);
  await api('/api/likes', { method: 'POST', token: fan.token, body: { user_id: cible.id } });

  const gratuit = await api('/api/likes/who-liked-me', { token: cible.token });
  const ligne = gratuit.json.likes.find((l) => l.user_id === fan.id);
  assert.ok(ligne, 'le like doit apparaître');
  assert.equal(ligne.photo_url, null);
  assert.equal(ligne.is_blurred, true);
  ok('photo masquée en Mode Coulé');

  await query(`update public.users set plan = 'debout', plan_expires_at = now() + interval '30 days'
                where id = $1`, [cible.id]);
  const debout = await api('/api/likes/who-liked-me', { token: cible.token });
  const ligne2 = debout.json.likes.find((l) => l.user_id === fan.id);
  assert.equal(ligne2.photo_url, 'https://cdn.exemple/photo.jpg');
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
