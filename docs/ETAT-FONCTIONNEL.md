# Viens chop — ce qui marche vraiment

Mis à jour le 30/10/2026, après vérification en production
(`https://viens-chop-api.onrender.com` + `https://kaurel277-cmd.github.io/Viens-chop-/`).

Légende : ✅ opérationnel · 🟡 partiel · ⛔ pas encore fait

## Le parcours de base

| Fonction | État | Ce qui se passe réellement |
|---|---|---|
| Inscription au numéro + mot de passe (sans SMS) | ✅ | `POST /api/auth/register` crée le compte, puis l'écran de profil demande prénom, date, commune, genre, « je cherche » et artistes |
| Connexion / déconnexion / jetons | ✅ | Jeton d'accès + jeton de rafraîchissement, rotation à chaque renouvellement |
| Fil de profils | ✅ | Vraies personnes, photos visibles, ta commune d'abord puis les profils vus récemment |
| 3 likes par jour (Mode Coulé) | ✅ | Compteur appliqué par le serveur, pas seulement par l'écran |
| Match et discussions | ✅ | Messages enregistrés en base, rafraîchis toutes les 3 secondes |
| « Qui m'a aimé » | ✅ | Gratuit ; la photo n'apparaît qu'en Mode Debout |
| Photos et vidéos en vue unique | ✅ | Envoi, durée limite, effacement après la première ouverture, expiration à 30 jours. La migration est passée : `/api/health` annonce `chat-media` |
| Signaler / bloquer | ✅ | Depuis le fil et depuis la discussion ; un profil bloqué disparaît partout |
| Mot de passe oublié | ✅ | Clé de secours de 12 caractères (ni SMS ni email), hachée et à usage unique. Vérifié en production : bonne clé `200`, mauvaise `401 CLE_INVALIDE`, rejeu `401 CLE_DEJA_UTILISEE` |
| Changer son mot de passe (connecté) | ✅ | Depuis **Mon profil → Mot de passe & clé de secours** ; la clé de secours est régénérée au passage |
| Faux appel d'urgence | ✅ | Route serveur réelle, quota d'un essai par semaine en Mode Coulé |
| PWA installable + page hors ligne | ✅ | Manifeste, icônes, service worker, page « tu es hors ligne » |
| Console d'admin | ✅ | `admin.html` : statistiques, signalements, selfies, photos à modérer, journal. `ADMIN_TOKEN` est posé (`/api/admin/etat` → `configuree: true`) |
| Vérification selfie | ✅ | Envoi du selfie depuis le profil, file d'attente et décision dans la console d'admin, badge « Vérifié » affiché **uniquement** si le serveur dit `is_certified` |
| Modération des photos | ✅ | Détection automatique de peau à l'envoi, file de validation et décision dans la console d'admin |

## Ce qui n'est pas encore une vraie fonctionnalité

| Fonction | État | Pourquoi |
|---|---|---|
| Paiement du Mode Debout par Wave | 🟡 prêt, à allumer | Circuit complet et testé : la personne paie sur ton numéro Wave, colle l'identifiant de la transaction, tu valides dans la console, la base active 30 jours. **Il reste à coller `MIGRATION-PAIEMENTS.sql` dans Neon et à saisir ton numéro Wave** (console → Réglages). Tant que ce n'est pas fait, la fenêtre dit « bientôt » |
| Activation du Mode Debout | 🟡 | Automatique dès qu'un paiement est validé (déclencheur en base). Un renouvellement s'ajoute à la date de fin |
| Paiement automatique (API marchand) | ⛔ prêt derrière | Webhook écrit et signé (HMAC), inactif : il s'allume avec `PAIEMENT_WEBHOOK_SECRET` le jour où tu auras un compte Wave Business / CinetPay. Voir `PAIEMENT.md` |
| Quiz Mode Flirt | 🟡 | Les questions sont écrites dans la page (4 questions, tirage local). La route serveur existe mais n'est pas branchée |
| Mode Incognito | ⛔ | Annoncé dans les pages, pas encore développé |
| SOS / Check-In | ⛔ | Annoncés dans les pages, pas encore développés (marqués « bientôt ») |

## Le paiement du Mode Debout (30/10)

Le faux bouton « Paiement confirmé » a disparu. À la place :

- la fenêtre affiche le **prix**, la **durée** et le **numéro Wave** réglés dans
  la console d'admin — rien n'est écrit en dur dans le site ;
- la personne envoie l'argent, puis colle **l'identifiant de la transaction** ;
- la demande arrive dans **admin.html → Paiements** ; « Valider » passe la ligne
  en `paid`, et le déclencheur PostgreSQL active 30 jours ;
- une référence Wave ne sert qu'une fois, une seule demande en attente par
  personne, 6 déclarations par quart d'heure ;
- le montant est imposé par le serveur (pas de paiement à 1 FCFA).

Procédure complète, écran par écran : `PAIEMENT.md`.

## Ce qui a été corrigé le 30/10

1. **Un compte neuf n'enregistrait jamais son profil.** L'écran demandait
   « Homme / Femme » alors que le serveur n'acceptait que « M / F » : la mise à
   jour était refusée en silence, le compte restait `membre1234` sans genre et
   sans prénom. Les deux côtés parlent maintenant la même langue.
2. **Le bouton photo de la discussion ne faisait rien** (variable hors de
   portée). Il envoie désormais réellement le média.
3. **Le passage inscription → application changeait de serveur** et
   déconnectait la personne. Le serveur choisi est mémorisé (`?api=reset`
   l'oublie).
4. **Les pages vendaient SOS, Check-In et Mode Incognito** comme s'ils étaient
   livrés : ils sont marqués « bientôt » et le Faux Appel, lui réel, est mis en
   avant.
5. **Les raccourcis de l'application installée ne menaient nulle part.**
   `?ecran=profil` et `?ecran=discussions` étaient ignorés : on retombait sur
   l'écran par défaut. Ils ouvrent maintenant le bon écran (et renvoient à la
   connexion si l'on n'est pas connecté).
6. **L'écran de démarrage pouvait rester bloqué** (aucun compte, session
   expirée, serveur muet) : il mène désormais toujours à la connexion, avec le
   message « Ta session a expiré » quand c'est le cas.
7. **Un double appui = deux likes, deux messages.** Sur un réseau lent, liker
   ou passer deux fois brûlait un crédit ; un message dont l'envoi échouait
   disparaissait. Un seul geste = un envoi, et le message raté revient dans le
   champ, marqué « non envoyé ».
8. **Le bouton de connexion ne réagissait pas** au premier appui (réseau lent) :
   il affiche « Connexion… » et ne part qu'une fois.
9. **Le retour du téléphone quittait l'application** : il ramène maintenant à
   l'écran précédent.
10. **Le site glissait de travers sur les petits téléphones** (320–360 px) : le
    menu ☰ élargissait la page et le formulaire « Proposer un lieu » débordait.
    Plus aucun débordement sur les 14 pages.
11. **Le service worker pouvait servir un ancien script avec une page neuve.**
    Les pages **et le code** (JS, CSS) passent désormais par le réseau d'abord ;
    seules les images viennent du cache.
12. **Se connecter par le formulaire laissait l'application à moitié morte.**
    Les écrans (Mon profil, photos, discussions, abonnement) se préparaient au
    chargement uniquement si une session existait déjà : après une connexion,
    l'avatar ne répondait pas (`openMonProfil is not defined`). La page se
    recharge maintenant avec la session, comme pour un utilisateur qui revient.
13. **Une base en retard bloquait toute l'application** : si la migration du
    mot de passe n'était pas passée sur Neon, l'inscription marchait mais le
    fil, les matchs et le profil répondaient 500. Les colonnes de la clé de
    secours sont lues de façon tolérante : une base sans migration reste
    utilisable.

## Comment marche le « mot de passe oublié »

Il n'y a ni SMS ni email : la preuve d'identité, c'est une **clé de secours**
de 12 caractères, dans l'alphabet sans pièges (pas de 0/O, ni de 1/I/L).

- donnée **une seule fois**, à l'inscription, et affichée dans un cadre orange ;
- stockée **hachée** (scrypt) : même en lisant la base, personne ne peut s'en servir ;
- **utilisable une seule fois** : après dépannage, il faut en générer une nouvelle ;
- régénérable depuis **Mon profil → Mot de passe & clé de secours**, avec le mot de passe ;
- 10 essais par quart d'heure et par adresse IP sur la route de récupération ;
- un mot de passe oublié **déconnecte tous les autres appareils**.

Cas sans clé (compte créé avant le dispositif) : le propriétaire du site lance
`node tools/nouvelle-cle.js <numéro>` avec la `DATABASE_URL` de Neon, et
transmet la clé obtenue.

## Comment marche la vue unique (chat)

- **Photo** : compressée sur l'appareil (280 Ko visés), 400 Ko maximum serveur.
- **Vidéo** : 15 secondes et 3 Mo maximum, durée mesurée avant l'envoi.
- **Une seule ouverture**, réservée à l'autre personne : l'expéditeur ne peut pas
  rouvrir son propre média, la deuxième tentative répond `410 MEDIA_DEJA_VU`.
- **Le fichier est effacé de la base avant même que la réponse parte** : il ne
  reste que la ligne « vue », pour que l'expéditeur voie « Vue 👁️ ».
- **Expiration** : un média jamais ouvert est effacé au bout de 30 jours
  (statut « Expirée · jamais ouverte »), pour ne pas remplir l'offre gratuite.
- **Compte à rebours** : 8 s pour une photo, la durée + 2 s pour une vidéo.

## Le voyant qui dit tout : /api/health

`https://viens-chop-api.onrender.com/api/health` liste, en direct, ce que le
serveur et la base savent faire :

| Repère dans `features` | Ce qu'il prouve |
|---|---|
| `password-auth`, `photos` | le déploiement est à jour |
| `recuperation` | la migration « mot de passe oublié » est passée |
| `chat-media` | la vue unique est active |
| `verifications`, `moderation` | selfie de vérification et modération des photos actifs |
| `admin` | la variable `ADMIN_TOKEN` est posée sur Render |

Un repère absent = une chose à faire. Réponse garantie en moins d'une seconde,
même si la base est injoignable.

## Les étapes d'activation

1. `database/MIGRATION-SECURITE.sql` (vue unique, vérification, modération) — **passée**
2. `database/MIGRATION-MOT-DE-PASSE.sql` (clé de secours, changement de mot de passe) — **passée**
3. La variable `ADMIN_TOKEN` sur Render (console d'admin) — **posée**
4. `database/MIGRATION-PAIEMENTS.sql` (réglages + statut « refusé ») — **à passer**
   puis saisir le numéro Wave dans la console → Réglages (voir `PAIEMENT.md`)

Preuve en direct : `GET /api/health` renvoie les 7 repères
(`password-auth`, `photos`, `recuperation`, `chat-media`, `verifications`,
`moderation`, `admin`) — le 8ᵉ, `paiement`, apparaîtra après l'étape 4. et `GET /api/admin/etat` répond
`{"configuree":true,"verifications":true,"moderation":true,"chatMedia":true}`.

## Avancement par bloc

| Bloc | État | Détail |
|---|---|---|
| Inscription, connexion, profil | ✅ 100 % | Pas de SMS, mot de passe + clé de secours, profil complet, photos |
| Découvrir, liker, matcher | ✅ 100 % | 3 likes/jour tenus par la base, fil trié, matchs automatiques |
| Discuter | ✅ 100 % | Messages en base, rafraîchissement, photos/vidéos en vue unique |
| Sécurité minimum avant lancement | ✅ 100 % | Signaler + bloquer partout, faux appel, modération des photos, selfie |
| Console d'administration | ✅ 100 % | Stats, signalements, selfies, photos, journal |
| Plateforme (PWA, hors ligne, vitesse) | ✅ 100 % | Installable, page hors ligne, service worker v2 |
| Monétisation (Mode Debout) | 🟡 85 % | Encaissement Wave réel, validation en console, activation automatique. Reste : coller le SQL et saisir le numéro Wave. Les 15 % restants = paiement automatique (compte marchand) |
| Extras annoncés (SOS, Check-In, Incognito) | ⛔ 0 % | Annoncés « bientôt » sur les pages, pas de code serveur |
| Quiz Mode Flirt | 🟡 60 % | Jouable, mais questions écrites dans la page ; la route `/api/safety/quiz` existe sans être utilisée |
| Répertoire des maquis | 🟡 40 % | Page et formulaire de proposition ; pas encore de liste de lieux en base |
