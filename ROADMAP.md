# Viens chop — Feuille de route

> État au 26 octobre 2026
> Ce document répond à : **« quelle est la prochaine étape ? »**

---

## Où on en est aujourd'hui

**Ce qui est fait et solide**

- 9 pages statiques complètes, responsive, validées (HTML 0 erreur, 0 erreur JS,
  0 débordement, 42 tests de régression au vert).
- Charte, ton et parcours utilisateur fixés : profil → photo floutée → 5 messages
  → déblocage, likes 3/jour, Mode Coulé / Mode Debout.
- `database/neon-schema.sql` : 11 tables, 9 triggers, testé sur PostgreSQL 17.
- `server/` : API Node complète (auth SMS, feed, likes, chat, sécurité),
  17 suites de tests d'intégration au vert contre un vrai PostgreSQL.
- Site rapide sans aucune dépendance externe (CSS compilé en local, polices
  système, images optimisées à 160 Ko).

**Le point bloquant**

> Le site est une **maquette de démonstration**. Rien n'est réel :
> `DEMO_MODE: true` (code SMS `1234`), aucun appel serveur (`0` requête réseau),
> photos non stockées, paiements simulés, swipe joué à partir d'un tableau JS.
> On ne peut pas ouvrir au public en l'état.

La prochaine étape n'est donc pas une nouvelle page : c'est **brancher un backend**.

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
| Base de données | ✅ **livré** — schéma v3 testé sur PostgreSQL 17 | `database/neon-schema.sql` |
| Règles métier (âge, quotas, match, déblocage) | ✅ **livré** — 14 vérifications SQL | `database/test-schema.sql` |
| API Node (auth, feed, likes, chat, sécurité) | ✅ **livré** — 17 suites, 31 vérifications | `server/` |
| Envoi des SMS | ⚙️ prêt, fournisseur à choisir (Termii / Twilio) | `server/src/sms.js` |
| Brancher le site sur l'API | ⏳ **prochaine tâche** | `inscription.html` l. 484-504 |
| Stockage des photos | ⏳ à faire (Cloudflare R2 conseillé) | voir BACKEND.md §6.1 |
| Chat temps réel | ⏳ polling d'abord, SSE ensuite | voir BACKEND.md §6.2 |
| Notifications | ⏳ push web ou SMS | — |

⚠️ Les règles sensibles doivent vivre **côté serveur**, pas dans le JavaScript :
quota de likes, majorité 18+, déblocage après 5 messages, « qui m'a liké » flouté.
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

- Vérification selfie **réelle** (comparaison photo/selfie, détection de visage).
- Bouton **Signaler** et **Bloquer** sur chaque profil et chaque message.
- Modération des photos (au moins un filtre automatique + une revue manuelle).
- Journal des signalements et délai de traitement.
- Test des politiques RLS : vérifier qu'un utilisateur ne peut pas lire les
  messages d'un autre.

---

## Étape 4 — Mise en ligne · *1 semaine*

- Nom de domaine + hébergement statique (Cloudflare Pages, Netlify ou Vercel).
- HTTPS, redirections `www`, page 404.
- **Open Graph** : aujourd'hui absentes, donc un lien partagé sur WhatsApp
  s'affiche sans image ni titre. C'est le premier canal d'acquisition en CI,
  à ne pas négliger.
- `sitemap.xml`, `robots.txt`.
- **PWA** : manifest + service worker → l'app s'installe sur l'écran d'accueil
  sans passer par un store. Gros levier en Côte d'Ivoire.
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
   matchs deviennent une discussion de 5 messages ?).
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
