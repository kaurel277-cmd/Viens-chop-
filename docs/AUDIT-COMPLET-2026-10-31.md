# Audit complet de Viens chop — 31 octobre 2026

Audit demandé après la mise en ligne de la version 14. Objectif : vérifier que
**ce que le site promet correspond à ce que l'application fait**, chercher les
bugs restants, et proposer des améliorations classées par priorité.

Ce document liste ce qui a été contrôlé, ce qui a été corrigé, ce qui reste à
décider, et ce qu'on peut améliorer ensuite.

---

## 1. Méthode

| Contrôle | Comment |
|---|---|
| Les 12 pages publiques | Ouvertes sur téléphone (390 px) **et** sur ordinateur (1280 px), avec relevé des erreurs JavaScript, des requêtes en échec et des images manquantes |
| Défilement | Molette, Page suivante, et mesure de la position de la page après chaque geste |
| Débordement horizontal | Comparaison `scrollWidth` / `innerWidth` sur chaque page, y compris menu ouvert |
| Liens internes | Les 12 destinations testées une par une (code de réponse + page d'arrivée) |
| Titres d'onglet | Un titre = un nom de page, aucun doublon entre deux pages |
| Chiffres affichés | Prix (700 FCFA), numéro WhatsApp, versions, nombre de places offertes |
| Accessibilité rapide | Images sans texte de remplacement, champs sans libellé, boutons sans type |
| Promesses « bientôt » | Chaque mention recoupée avec le code de l'application |
| Parcours fonctionnels | 14 suites Playwright (inscription, fil, likes, matchs, chat, photos vue unique, paiement Wave, admin, sécurité, PWA, Coins Chill, promoteurs…) |
| API de production | En-têtes de sécurité, CORS, routes protégées, données réellement servies |

Résultat global : **705 vérifications automatiques, 0 échec** après corrections.
Le détail des suites est en fin de document.

---

## 2. Cohérence : ce que le site promet / ce que l'application fait

Tout a été recoupé ligne par ligne dans `tarifs.html`, `securite.html`,
`comment-ca-marche.html`, `faq.html` et le code de `app.html`.

| Promesse affichée | Réalité dans l'application | Verdict |
|---|---|---|
| Mode Coulé gratuit : 3 likes par jour | `routes/auth.js` renvoie `3 - likes_today`, remis à zéro chaque jour | ✅ exact |
| Messages illimités | Aucun plafond de messages côté serveur | ✅ exact |
| 1 session Mode Flirt par jour | Quota `QUOTA_QUIZ` sur le quiz « Mode Flirt » | ✅ exact (même nom dans l'app) |
| Faux appel d'urgence | Bouton `triggerFakeCall()` présent dans le fil et dans le chat | ✅ exact |
| Photos en vue unique | `routes/photos.js` + expiration après ouverture | ✅ exact |
| « Qui m'a aimé » : liste gratuite, photo en Mode Debout | Liste ouverte à tous, photo réservée | ✅ exact |
| Signaler + Bloquer partout | Présents sur chaque profil et dans le chat | ✅ exact |
| Mode Debout 700 FCFA / 30 jours, Wave | Tarif unique dans le code et sur le site ; circuit Wave + repli manuel | ✅ exact |
| Coins Chill : liste réelle, filtres commune/quartier | `GET /api/lieux` + écran dans l'app et page publique | ✅ exact |
| Certifié : jamais payant, décidé par l'administrateur | Aucun lien entre paiement et badge | ✅ exact |
| ~~Vérification par SMS~~ | Routes supprimées (404 vérifié) | ✅ disparu |
| SOS & Check-In « bientôt » | **Absents** de l'application | ✅ promesse honnête |
| Mode Incognito « bientôt » | **Absent** de l'application | ✅ promesse honnête |
| Orange Money / MTN / Moov « bientôt » | Seul Wave est branché | ✅ promesse honnête |

Conclusion : aucune fonctionnalité annoncée comme disponible ne manque. Les
seules mentions « bientôt » correspondent à des fonctions réellement absentes —
elles sont donc gardées telles quelles.

---

## 3. Bugs trouvés et corrigés dans cette version (15)

1. **Accueil impossible à faire défiler avec deux doigts.** La classe
   `overflow-x-hidden` sur le `<body>` d'`index.html` bloquait le défilement
   tactile (même cause qu'en v12 sur `app.html`). Retirée : le `overflow-x` est
   déjà géré sur `<html>` par `common.css`.
2. **Titre d'onglet en double.** `index.html` et `app.html` s'appelaient tous
   les deux « Viens chop ». L'application s'appelle maintenant « Application ».
3. **Deux champs sans libellé** dans l'écran Coins Chill de l'application
   (`#cc-commune`, `#cc-quartier`) : `aria-label` ajoutés pour les lecteurs
   d'écran.
4. **Commune et quartier enregistrés tels que tapés.** La fiche
   « BON COIN / yopougon / selmer » arrivait en minuscules dans la liste
   publique et créait une commune « yopougon » à côté de « Abidjan — Yopougon ».
   L'API met désormais en forme : `yopougon` → `Yopougon`,
   `abidjan — port-bouët` → `Abidjan — Port-bouët`.
5. **Un seul compte WhatsApp.** Le pied de page de 7 pages renvoyait vers un
   numéro écrit « à la main » ; la FAQ utilisait une variable. Tout pointe
   maintenant vers **07 14 18 99 68** (`wa.me/2250714189968`), au format
   international, sinon le lien ne s'ouvre pas.

---

## 4. Points qui demandent ta décision (non modifiés volontairement)

1. **« 1 mois de Mode Debout offert aux 100 premiers inscrits »** (index,
   inscription, tarifs) : aucune trace dans le code. L'offre n'est donc pas
   automatique. Deux options : l'honorer à la main quand tu valides un paiement,
   ou retirer la mention avant qu'elle ne devienne une promesse non tenue.
2. **CORS ouvert (`*`) sur l'API de production.** `CORS_ORIGIN` n'est pas
   renseigné sur Render : n'importe quel site peut appeler l'API depuis un
   navigateur. Les données restent protégées par les jetons, mais la valeur à
   mettre est `https://kaurel277-cmd.github.io` (Render → Environment).
   À tester juste après : ouverture de l'application, connexion, chargement du
   fil. Si l'API bloque le site, revenir à `*`.
3. **Deux fiches de test en production** (« BON COIN », « kou ») : à supprimer
   depuis la console admin (Coins Chill → Supprimer), avant l'ouverture.
4. **`app.html` pèse 253 Ko** (CSS + JS + écrans dans un seul fichier). C'est
   acceptable sur le réseau ivoirien mais c'est le premier poste de lenteur.
5. **`MIGRATION-PROMOTEURS.sql` toujours à passer dans Neon** : sans elle, les
   routes promoteurs de production répondent 500.

---

## 5. Propositions d'amélioration, par priorité

### Priorité haute — ce qui bloque le lancement

| # | Proposition | Pourquoi | Effort |
|---|---|---|---|
| 1 | Passer `MIGRATION-PROMOTEURS.sql` dans Neon + redéployer l'API | Coins Chill et l'espace promoteurs sont en 500 en production aujourd'hui | 10 min |
| 2 | Nettoyer les fiches de test et remplir 10 vrais lieux | Une liste à 2 entrées ne donne pas envie ; c'est la vitrine de la page Coins Chill | 1 h de saisie |
| 3 | Fermer le CORS (`CORS_ORIGIN`) | Empêche qu'un site tiers pilote l'API depuis le navigateur d'un membre | 5 min |
| 4 | Trancher sur l'offre « 100 premiers » | Une promesse affichée trois fois page d'accueil | 5 min |

### Priorité moyenne — confort et confiance

| # | Proposition | Pourquoi |
|---|---|---|
| 5 | Découper `app.html` (CSS et JS dans des fichiers séparés, cache long) | 253 Ko à chaque première visite ; gain d'une bonne seconde sur téléphone lent |
| 6 | Ajouter un écran « Mes visites » côté gérant (déjà en base, pas affiché) | Le promoteur doit voir ce qu'il doit payer sans passer par toi |
| 7 | Envoyer un rappel automatique 3 jours avant la fin du mois Debout | Limite les coupures et les réclamations |
| 8 | Page « Mon abonnement » dans l'application (date de fin, bouton renouveler) | Aujourd'hui il faut te contacter pour savoir où on en est |
| 9 | Photos des lieux dans les fiches Coins Chill | Une liste sans photo se choisit mal |
| 10 | Fil d'actualité vide : proposer d'élargir la recherche au lieu de laisser la carte seule | Un nouvel inscrit qui ne voit personne part |

### Priorité basse — finitions

| # | Proposition |
|---|---|
| 11 | Ajouter `app.html` au `sitemap.xml` et une phrase de description sur la page Coins Chill |
| 12 | Créer un vrai favicon multi-tailles (déjà des icônes PWA, mais l'onglet reste petit) |
| 13 | Uniformiser les fins de page d'erreur (même carte, même bouton « Retour à l'accueil ») |
| 14 | Journaliser les paiements refusés dans une table dédiée pour les relances |

---

## 6. Comment relancer les vérifications

```bash
# site statique
cd /home/user/site && python3 -m http.server 8080

# API locale (Postgres local, faux Wave)
cd /home/user/site/server && PORT=3005 NODE_ENV=development node src/index.js

# suites
cd /home/user/audit
node audit-site.js          # 12 pages : défilement, liens, titres, poids
node regression.js          # parcours de l'application
node test-promoteurs.js     # Coins Chill, visites, espace promoteur
```

---

## 7. Résultats des suites (31/10, après corrections)

| Suite | Résultat |
|---|---|
| audit-site.js (12 pages × téléphone/bureau) | 107 / 107 |
| test-promoteurs.js | 109 / 109 |
| regression.js | 42 / 42 |
| test-parcours-pages.js | 51 / 51 |
| test-mobile.js | 77 / 77 |
| test-pwa.js | 42 / 42 |
| test-onboarding.js | 32 / 32 |
| test-genre.js | 33 / 33 |
| test-paiement.js | 44 / 44 |
| test-paiement-auto.js (Wave automatique) | 29 / 29 |
| test-media.js | 22 / 22 |
| test-securite.js | 32 / 32 |
| test-admin.js | 23 / 23 |
| test-mot-de-passe.js | 21 / 21 |
| parcours-complet.js | 32 / 32 |
| test-defilement.js | 9 / 9 |
| coherence.js | 0 problème |
| html-validate | 0 erreur |
