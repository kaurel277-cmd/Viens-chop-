# Viens chop — Feuille de route

> État au 26 octobre 2026
> Ce document répond à : **« quelle est la prochaine étape ? »**

---

## Où on en est aujourd'hui

**Ce qui est fait et solide**

- 9 pages statiques complètes, responsive, validées (HTML 0 erreur, 0 erreur JS,
  0 débordement, 42 tests de régression au vert).
- Charte, ton et parcours utilisateur fixés : profil + photo visibles → like →
  match → chat, likes 3/jour, Mode Coulé / Mode Debout.
- `database/neon-schema.sql` : 11 tables, 9 triggers, testé sur PostgreSQL 17.
- `server/` : API Node complète (comptes, feed, likes, chat, sécurité),
  17 suites de tests d'intégration au vert contre un vrai PostgreSQL.
- Site rapide sans aucune dépendance externe (CSS compilé en local, polices
  système, images optimisées à 160 Ko).

**Le point bloquant**

> Le site **est branché sur l'API** : comptes, photos, likes, matchs et messages
> sont réels et partagés entre les inscrits. Il reste la modération, la mise en
> ligne soignée et le paiement avant une ouverture au public.

---

## Étape 1 — Backend temps réel · *bloquant* · **base et API livrées**

Objectif : un vrai compte, de vrais profils, de vrais matchs.

**Mise en route pas à pas : [`docs/GUIDE-DEMARRAGE.md`](docs/GUIDE-DEMARRAGE.md).**

**Choix d'infrastructure retenu : Neon (PostgreSQL managé) + une API Node.**
Neon ne fournit que la base : l'authentification, le stockage des photos et le
temps réel ont donc été construits autour. Détail complet dans
[`docs/BACKEND.md`](docs/BACKEND.md).

| Quoi | État | Où |
|---|---|---|
| Base de données | ✅ **en production** — Neon, 6 tables, connexion vérifiée | `database/neon-schema.sql` |
| Règles métier (âge, quotas, match, déblocage) | ✅ **en production** — 7/7 triggers actifs | `database/test-schema.sql` |
| API Node (auth, feed, likes, chat, sécurité) | ✅ **déployée sur Render** — 20 routes | `server/` |
| Inscription | ✅ numéro + mot de passe, **aucun code à recevoir** | `server/src/routes/auth.js` |
| Brancher le site sur l'API | ✅ **fait** — inscription, fil, likes, matchs, chat | `assets/js/api.js` |
| Stockage des photos | ⏳ à faire (Cloudflare R2 conseillé) | voir BACKEND.md §6.1 |
| Chat temps réel | ⏳ polling d'abord, SSE ensuite | voir BACKEND.md §6.2 |
| Notifications | ⏳ push web | — |

**Adresse de l'API en production :** `https://viens-chop-api.onrender.com`
Diagnostic de la base : `/api/health/db`

⚠️ Les règles sensibles doivent vivre **côté serveur**, pas dans le JavaScript :
quota de likes, majorité 18+, « qui m'a liké ».
Le schéma SQL les contient déjà ; il faut les tester.

---

## Étape 2 — Paiement Mobile Money · *le revenu, 1 à 2 semaines*

700 FCFA/mois. Sans ça, le Mode Debout reste un bouton décoratif.

- **Wave** : API Checkout, la plus simple des quatre.
- **Orange Money** : Web Payment (contrat marchand à ouvrir).
- **MTN MoMo** / **Moov Money** : API marchande, dossier plus long.

À prévoir : webhooks de confirmation, table `payments` (déjà prévue),
renouvellement mensuel, et gestion des échecs.

> Ordre conseillé : Wave d'abord (couverture et intégration les plus rapides),
> puis Orange Money qui pèse le plus en Côte d'Ivoire.

---

## Étape 3 — Sécurité & modération · *obligatoire avant lancement*

Une app de rencontre sans modération se fait fermer, ou se vide.

- ✅ **Fait** — bouton **Signaler** et **Bloquer** sur chaque profil (fil) et dans
  la discussion : 6 motifs de signalement, blocage immédiat, liste
  « Profils bloqués » dans Mon profil avec déblocage.
- ✅ **Fait** — vérification selfie **réelle** : le selfie part au serveur,
  l'équipe le compare aux photos dans la console, le badge « Vérifié » ne
  s'affiche qu'après validation, puis le selfie est effacé.
- ✅ **Fait** — modération des photos : analyse automatique à l'envoi (peau,
  luminosité, taille), file « à vérifier » dans la console, retrait en un clic.
- ✅ **Fait** — console d'administration : signalements, vérifications, photos,
  journal des actions.

Voir `docs/ADMINISTRATION.md` et `docs/SECURITE-MODERATION.md`.
Reste : un vrai filtre d'image côté serveur (aujourd'hui l'analyse tourne dans
le navigateur et les seuils sont volontairement larges).
- Test des politiques RLS : vérifier qu'un utilisateur ne peut pas lire les
  messages d'un autre.

---

## Étape 4 — Mise en ligne · *1 semaine*

- ✅ **Fait** — hébergement statique : le site est en ligne sur GitHub Pages
  (`https://kaurel277-cmd.github.io/Viens-chop-/`), mis à jour à chaque push.
- ✅ **Fait** — **Open Graph** sur les 9 pages : un lien partagé sur WhatsApp
  affiche l'image « Viens chop », le titre et la description.
- ✅ **Fait** — `sitemap.xml`, `robots.txt` (console d'administration exclue).
- ✅ **Fait** — **PWA** : manifest, service worker, icônes 192/512/maskable,
  page « Pas de connexion ». Bouton « Installer » sur les pages vitrine.
- ⏳ **À toi** — nom de domaine + HTTPS : voir `docs/MISE-EN-LIGNE.md`.
- ⏳ **À faire** — page 404 personnalisée (GitHub Pages sert sa propre page).
- Analytics respectueux de la vie privée (Plausible ou Umami) pour mesurer
  inscription → match → message.

---

## Étape 5 — Conformité juridique · *en parallèle*

- Politique de confidentialité + CGU détaillées (aujourd'hui : mentions
  générales seulement).
- Loi ivoirienne n° 2013-450 sur la protection des données : déclaration ARTCI,
  consentement explicite, droit à l'effacement du compte.
- Conditions de conservation des photos et des messages.
- Vérification d'âge : ton blocage des mineurs est côté client, il faut aussi
  le garantir côté base (le trigger existe, à tester).

---

## Étape 6 — Lancement · *après tout le reste*

1. **Bêta fermée, 500 personnes** — celles du Mode Debout offert. But : mesurer
   la rétention à J+7, pas le nombre d'inscrits.
2. Corriger ce qui bloque la conversation (le vrai indicateur : combien de
   matchs deviennent une vraie discussion ?).
3. Ouvrir progressivement, commune par commune, pour garder une densité de
   profils suffisante — une app de rencontre vide ne se relance pas.

---

## Ce que je peux enchaîner tout de suite

| Chantier | Ce que je livre | Ce qu'il te faut |
|---|---|---|
| **A. Brancher le site sur l'API** | Remplacement de `DEMO_MODE` par de vrais appels dans `inscription.html` et `app.html` | Créer le projet Neon (gratuit) et coller `DATABASE_URL` dans `server/.env` |
| **B. Rendre le site installable (PWA)** | `manifest.json`, service worker, icônes, écran d'accueil | Rien |
| **C. Partage WhatsApp propre** | Open Graph + image de partage + `sitemap.xml` + `robots.txt` | Rien |
| **D. Comptes de démo** | Jeu de profils réalistes pour tester le parcours | Rien |

**Recommandation : A** — mais la base et l'API sont désormais écrites et
testées : il ne reste qu'à relier l'interface.
