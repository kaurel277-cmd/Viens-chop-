import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';

export const safetyRouter = Router();

/* ---------------------------------------------------------------------------
   POST /api/safety/fake-call — 1 essai/semaine en gratuit, illimité en Debout
   Le quota réel est tenu par un trigger PostgreSQL.
   --------------------------------------------------------------------------- */
safetyRouter.post('/fake-call', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `update public.users set fake_call_last_used = now()
        where id = $1
        returning fake_call_last_used, plan, plan_expires_at`,
      [req.user.id]
    );
    const u = rows[0];
    res.json({
      ok: true,
      started_at: u.fake_call_last_used,
      next_free_at: u.plan === 'debout'
        ? null
        : new Date(new Date(u.fake_call_last_used).getTime() + 7 * 864e5).toISOString()
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/safety/report — signaler un profil
   --------------------------------------------------------------------------- */
const REASONS = ['fake_profile', 'harassment', 'nudity', 'scam', 'minor', 'other'];

safetyRouter.post('/report', requireAuth, async (req, res, next) => {
  try {
    const { user_id, reason, details } = req.body || {};
    if (!user_id) throw new AppError(400, 'CIBLE_MANQUANTE', 'Profil ciblé manquant.');
    if (!REASONS.includes(reason)) throw new AppError(400, 'MOTIF_INVALIDE', 'Motif de signalement invalide.');
    if (user_id === req.user.id) throw new AppError(400, 'AUTO_SIGNALEMENT', 'Tu ne peux pas te signaler.');

    const { rows } = await query(
      `insert into public.reports (reporter_id, target_id, reason, details)
       values ($1, $2, $3, $4) returning id, created_at`,
      [req.user.id, user_id, reason, (details || '').slice(0, 1000) || null]
    );

    res.status(201).json({ ok: true, report: rows[0] });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/safety/block — bloquer (le profil disparaît du fil et du chat)
   --------------------------------------------------------------------------- */
safetyRouter.post('/block', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.body || {};
    if (!user_id) throw new AppError(400, 'CIBLE_MANQUANTE', 'Profil ciblé manquant.');

    await query(
      `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)
       on conflict do nothing`,
      [req.user.id, user_id]
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/safety/blocks — la liste de mes profils bloqués (pour débloquer)
   --------------------------------------------------------------------------- */
safetyRouter.get('/blocks', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select b.blocked_id as id, b.created_at as blocked_at, u.pseudo, u.commune
         from public.blocks b
         join public.users u on u.id = b.blocked_id
        where b.blocker_id = $1
        order by b.created_at desc`,
      [req.user.id]
    );
    res.json({ ok: true, blocks: rows });
  } catch (err) { next(err); }
});

safetyRouter.delete('/block/:id', requireAuth, async (req, res, next) => {
  try {
    await query('delete from public.blocks where blocker_id = $1 and blocked_id = $2',
      [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/safety/quiz — tirage de quiz selon les artistes en commun
   --------------------------------------------------------------------------- */
safetyRouter.get('/quiz', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select count(*)::int as today
         from public.quiz_sessions
        where user_id = $1 and created_at::date = current_date`,
      [req.user.id]
    );
    const used = rows[0].today;
    if (!req.isDebout && used >= 1) {
      throw new AppError(429, 'QUOTA_QUIZ', '1 session de quiz par jour en Mode Coulé.');
    }

    const questions = [
      { q: 'Garba ou Alloco ?', a: ['Garba', 'Alloco'] },
      { q: 'Rancart posé ou soirée mouvementée ?', a: ['Rancart posé', 'Soirée'] },
      { q: 'Maquis chill ou resto chic ?', a: ['Maquis chill', 'Resto chic'] },
      { q: 'Matinal ou oiseau de nuit ?', a: ['Matinal', 'Oiseau de nuit'] }
    ];
    const picked = questions[Math.floor(Math.random() * questions.length)];

    await query(
      `insert into public.quiz_sessions (user_id, question) values ($1, $2)`,
      [req.user.id, picked.q]
    );

    res.json({ ok: true, question: picked.q, answers: picked.a, remaining: req.isDebout ? null : 0 });
  } catch (err) { next(err); }
});
