# Viens chop — Backend (Neon)

> Ce document explique comment le backend est construit, ce que Neon fournit
> **et ce qu'il ne fournit pas**, puis comment le lancer, le déployer et y
> brancher le site.

---

## 1. Ce que change le choix de Neon

Neon est **PostgreSQL managé**. Ni plus, ni moins. Là où Supabase est une
plateforme complète, Neon ne donne que la base : il faut donc construire
autour d'elle les briques qui, chez Supabase, étaient incluses.

| Brique | Supabase | Neon |
|---|---|---|
| Base PostgreSQL | ✅ | ✅ **c'est son métier** |
| Authentification par SMS | ✅ `auth.users` | ❌ à coder → `database/neon-schema.sql` + `server/src/routes/auth.js` |
| Stockage des photos | ✅ Storage | ❌ **à choisir** (voir §6) |
| Temps réel (chat) | ✅ Realtime | ❌ à choisir (voir §6) |
| Row Level Security | ✅ via `auth.uid()` | ⚠️ possible, mais il faut porter l'identité soi-même |
| Interface d'admin | ✅ | ❌ (Neon a un SQL Editor, pas de table editor avancé) |

**Conséquence pratique** : le navigateur ne parle jamais directement à Neon.
Il parle à l'API, qui parle à Neon. C'est plus de code, mais c'est aussi plus sûr :
les règles sensibles ne peuvent pas être contournées en modifiant le JavaScript.

```
Navigateur (site statique)
        │  HTTPS + JWT
        ▼
   API Node (server/)
        │  SQL (pool)
        ▼
   Neon PostgreSQL
```

---

## 2. Mise en route — 10 minutes

```bash
# 1. Créer la base
#    neon.tech → New Project → copier les deux chaînes de connexion

# 2. Créer les tables
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f database/neon-schema.sql

# 3. Vérifier que les règles métier tiennent
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f database/test-schema.sql
#    → doit afficher « TOUS LES TESTS PASSENT »

# 4. Configurer l'API
cd server
cp .env.example .env      # puis remplir DATABASE_URL, JWT_SECRET, OTP_PEPPER
npm install
npm run dev               # http://localhost:3001

# 5. Vérifier
curl http://localhost:3001/api/health
```

### Choisir la bonne chaîne de connexion

Neon en fournit deux. **Ce n'est pas un détail** :

- `DATABASE_URL` → chaîne **pooled** (hôte contenant `-pooler`). À utiliser par
  l'API. En serverless, une connexion directe par requête épuise les
  connexions disponibles.
- `DATABASE_URL_DIRECT` → chaîne **directe**. À utiliser par `psql` pour les
  migrations (le pooler ne gère pas certains ordres DDL).

### Générer les secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

À faire deux fois : une valeur pour `JWT_SECRET`, une autre pour `OTP_PEPPER`.
**Changer `OTP_PEPPER` invalide tous les codes en cours** — à ne jamais faire
en production.

---

## 3. Ce que la base garantit toute seule

Ces règles sont dans des triggers : même si l'API est contournée, la base
refuse. C'est le principal intérêt de les avoir mises en SQL.

| Règle | Où | Vérifié par |
|---|---|---|
| Aucun mineur en base | trigger `users_age_adult` | `test-schema.sql` + tests API |
| 3 likes/jour en gratuit, illimité en Debout | trigger `likes_quota` | test « 4ᵉ like refusé » |
| Un seul like par couple | contrainte `one_like_per_pair` | test dédié |
| Like réciproque → match automatique | trigger `likes_create_match` | test dédié |
| Photos débloquées au 5ᵉ message | trigger `messages_unlock` | test « pas avant / au 5ᵉ » |
| Seuls les 2 participants écrivent | trigger `messages_check_sender` | test « un tiers » |
| 1 faux appel/semaine en gratuit | trigger `users_fakecall_quota` | test dédié |
| Paiement confirmé → 30 jours de Debout | trigger `payments_activate` | `test-schema.sql` |
| 5 codes SMS max/heure/numéro | `app.check_otp_rate_limit()` | test API |

**Les tests tournent contre un vrai PostgreSQL**, pas contre des mocks :

```bash
cd server && npm test
# 17 suites, 31 vérifications
```

---

## 4. L'API

Base : `http://localhost:3001`. Toutes les réponses sont en JSON.
Authentification : `Authorization: Bearer <access_token>` (JWT, 15 min).

### Authentification

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| `POST` | `/api/auth/otp` | `{ phone }` | `{ expires_in }` — envoie le SMS |
| `POST` | `/api/auth/verify` | `{ phone, code }` | `{ access_token, refresh_token, is_new }` |
| `POST` | `/api/auth/refresh` | `{ refresh_token }` | nouveaux jetons (l'ancien est révoqué) |
| `POST` | `/api/auth/logout` | `{ refresh_token }` | `{ ok }` |
| `GET` | `/api/auth/me` | — | profil + `likes_left` |

**L'inscription est automatique**, comme demandé : `POST /api/auth/verify`
crée le compte immédiatement (`is_new: true`). Aucun lien à cliquer, aucune
attente d'ouverture d'accès. Le profil se complète ensuite.

### Profil et découverte

| Méthode | Route | Notes |
|---|---|---|
| `POST` | `/api/users/me` | pseudo, date de naissance, genre, commune, artistes |
| `GET` | `/api/users/:id` | photo renvoyée seulement si le match est débloqué |
| `GET` | `/api/feed` | même commune d'abord, **jamais de photo** |

`seeking` n'est **jamais** envoyé par le client : le serveur le déduit du genre
avec la même règle que le site (`M → F`, `F → A`).

### Likes et matchs

| Méthode | Route | Notes |
|---|---|---|
| `POST` | `/api/likes` | `{ user_id }` → `{ matched, match_id, likes_left }` |
| `DELETE` | `/api/likes/:id` | annule un like |
| `GET` | `/api/likes/who-liked-me` | photo masquée hors Mode Debout |
| `GET` | `/api/matches` | liste avec dernier message et non-lus |
| `GET` | `/api/matches/:id/messages` | marque les messages reçus comme lus |
| `POST` | `/api/matches/:id/messages` | `{ body }` → `{ photo_unlocked, messages_until_unlock }` |

### Sécurité

| Méthode | Route | Notes |
|---|---|---|
| `POST` | `/api/safety/fake-call` | 1/semaine en gratuit, illimité en Debout |
| `POST` | `/api/safety/report` | motifs : `fake_profile`, `harassment`, `nudity`, `scam`, `minor`, `other` |
| `POST` | `/api/safety/block` | le profil disparaît du fil et du chat |
| `DELETE` | `/api/safety/block/:id` | débloquer |
| `GET` | `/api/safety/quiz` | 1 session/jour en gratuit |

### Codes d'erreur

Toujours `{ error: { code, message } }`. Les plus utiles côté site :

| HTTP | Code | Signification |
|---|---|---|
| 400 | `CODE_INCORRECT` / `CODE_EXPIRE` | mauvais code ou expiré |
| 403 | `MINEUR_INTERDIT` | moins de 18 ans |
| 409 | `TELEPHONE_DEJA_UTILISE` | numéro déjà inscrit |
| 429 | `QUOTA_LIKES` | 3 likes du jour épuisés |
| 429 | `QUOTA_FAUX_APPEL` | 1 essai par semaine |
| 429 | `TROP_DE_DEMANDES` | trop de SMS demandés |

---

## 5. Brancher le site

Aujourd'hui `inscription.html` simule tout (`DEMO_MODE: true`, code `1234`).
Le contrat est déjà écrit dans le fichier, aux lignes 484-504. Il suffit de
remplacer les trois fonctions :

```js
const API = 'https://api.viens-chop.ci';

async function sendOtp(phone) {
  const r = await fetch(`${API}/api/auth/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+225' + phone })
  });
  if (!r.ok) throw new Error((await r.json()).error.message);
  return true;
}
```

Puis stocker les jetons côté client :

```js
localStorage.setItem('vc_access',  data.access_token);
localStorage.setItem('vc_refresh', data.refresh_token);
```

⚠️ `localStorage` est lisible par n'importe quel script de la page. Pour une
version aboutie, préférer un **cookie `HttpOnly` + `Secure` + `SameSite=Strict`**
pour le refresh token : une XSS ne peut alors pas voler la session.

---

## 6. Les deux briques que Neon ne fournit pas

### 6.1 Photos → stockage objet + CDN

Neon ne stocke pas de fichiers. Trois options crédibles :

| Solution | Prix | Pourquoi |
|---|---|---|
| **Cloudflare R2** | 10 Go gratuits, **aucun frais d'égression** | Le meilleur choix ici : les photos sont servies souvent, l'égress gratuit compte |
| Backblaze B2 + Cloudflare | 10 Go gratuits | Alternative simple |
| Bunny Storage + CDN | ~1 $/mois | Bon CDN africain |

À faire dans tous les cas :
- upload via **URL signée** générée par l'API (le navigateur n'a pas la clé) ;
- redimensionner et flouter côté serveur avant publication ;
- **jamais** d'URL publique devinable : passer par des URLs signées à durée
  courte, sinon la photo floutée devient inutile.

### 6.2 Chat temps réel

Le schéma est prêt (`messages` + index). Trois approches, par ordre de simplicité :

1. **Polling** toutes les 3 s sur `GET /api/matches/:id/messages` — 20 lignes de
   code, suffisant pour un lancement, et le CDC impose déjà 5 messages avant
   déblocage (donc peu de trafic).
2. **SSE** (`text/event-stream`) depuis l'API : un seul flux par utilisateur,
   compatible avec tous les hébergeurs Node.
3. **Service tiers** (Ably, Pusher) si le trafic explose.

Recommandation : commencer par le polling, migrer en SSE quand il y a 500
utilisateurs actifs.

---

## 7. Déploiement

L'API est un serveur Node classique.

| Hébergeur | Remarque |
|---|---|
| **Railway / Render / Fly.io** | Le plus simple, supporte un process long |
| Vercel / Netlify Functions | Possible, mais il faut alors utiliser `@neondatabase/serverless` (driver HTTP) |
| Cloudflare Workers | Nécessite le driver HTTP Neon également |

Variables à définir dans l'hébergeur : `DATABASE_URL`, `JWT_SECRET`,
`OTP_PEPPER`, `SMS_PROVIDER`, `CORS_ORIGIN`, `NODE_ENV=production`.

**En production : `CORS_ORIGIN` doit être l'URL exacte du site**, pas `*`.
Et `DEV_OTP_BYPASS` doit rester absent (sinon n'importe qui entre avec `123456`).

---

## 8. Limites du plan gratuit Neon

- 0,5 Go de stockage — largement suffisant pour plusieurs milliers de comptes
  (une ligne `users` pèse environ 1 Ko).
- Mise en veille après 5 minutes d'inactivité : la première requête suivante
  prend ~500 ms. Acceptable, ou passer au plan payant (19 $/mois) au lancement.
- Le calcul de l'autoscaler se fait à froid : prévoir un *ping* de l'API toutes
  les 5 minutes si la latence au premier écran compte.

---

## 9. Ce qui reste à faire

1. Brancher `inscription.html` et `app.html` sur cette API (le contrat est prêt).
2. Stockage des photos (§6.1) + upload signé.
3. Paiement Mobile Money : Wave, puis Orange Money (table `payments` prête).
4. Vérification selfie réelle.
5. Sauvegardes : Neon fait des *point-in-time restores* sur les plans payants ;
   sur le plan gratuit, prévoir un `pg_dump` quotidien.
