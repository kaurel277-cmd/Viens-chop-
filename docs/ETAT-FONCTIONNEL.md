# Viens chop — ce qui marche vraiment

Mis à jour le 30/10/2026, après vérification en production
(`https://viens-chop-api.onrender.com` + `https://kaurel277-cmd.github.io/Viens-chop-/`).

Légende : ✅ opérationnel · 🟡 partiel · ⛔ pas encore fait

## Le parcours de base

| Fonction | État | Ce qui se passe réellement |
|---|---|---|
| Inscription au numéro + mot de passe (sans SMS) | ✅ | `POST /api/auth/register` crée le compte, puis l'écran de profil demande prénom, date, commune, genre, « je cherche » et artistes |
| Connexion / déconnexion / jetons | ✅ | Jeton d'accès + jeton de rafraîchissement, rotation à chaque renouvellement |
| Fil de profils | ✅ | Vraies personnes, photos visibles, tri par commune puis par activité |
| 3 likes par jour (Mode Coulé) | ✅ | Compteur appliqué par le serveur, pas seulement par l'écran |
| Match et discussions | ✅ | Messages enregistrés en base, rafraîchis toutes les 2 secondes |
| « Qui m'a aimé » | ✅ | Gratuit ; la photo n'apparaît qu'en Mode Debout |
| Photos et vidéos en vue unique | 🟡 | Tout est en place et testé (envoi, durée, limites, effacement, expiration), **inactif tant que la migration SQL n'est pas passée** (voir plus bas) |
| Signaler / bloquer | ✅ | Depuis le fil et depuis la discussion ; un profil bloqué disparaît partout |
| Mot de passe oublié | 🟡 | Clé de secours de 12 caractères (ni SMS ni email) : code prêt et testé, **actif dès que le SQL `MIGRATION-MOT-DE-PASSE.sql` est passé** |
| Changer son mot de passe (connecté) | 🟡 | Route et écran prêts, même condition : la migration |
| Faux appel d'urgence | ✅ | Route serveur réelle, quota d'un essai par semaine en Mode Coulé |
| PWA installable + page hors ligne | ✅ | Manifeste, icônes, service worker, page « tu es hors ligne » |
| Console d'admin | 🟡 | Existe et fonctionne, **inactive sans `ADMIN_TOKEN`** sur Render |
| Vérification selfie | 🟡 | Code complet, attend la migration SQL + `ADMIN_TOKEN` |
| Modération des photos | 🟡 | Détection de peau automatique, attend la migration SQL |

## Ce qui n'est pas encore une vraie fonctionnalité

| Fonction | État | Pourquoi |
|---|---|---|
| Paiement Mobile Money (Wave, Orange, MTN, Moov) | ⛔ maquette | Le bouton affiche « Paiement confirmé » et débloque en local, sans encaisser quoi que ce soit ; tout disparaît au rechargement |
| Activation du Mode Debout | ⛔ | Aucun paiement ne l'active : aujourd'hui, seul un `UPDATE` en base peut le faire |
| Quiz Mode Flirt | 🟡 | Les questions sont écrites dans la page (4 questions, tirage local). La route serveur existe mais n'est pas branchée |
| Mode Incognito | ⛔ | Annoncé dans les pages, pas encore développé |
| SOS / Check-In | ⛔ | Annoncés dans les pages, pas encore développés (marqués « bientôt ») |

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

## À faire une fois pour activer le reste

1. `database/MIGRATION-SECURITE.sql` (vue unique, vérification, modération)
2. `database/MIGRATION-MOT-DE-PASSE.sql` (clé de secours, changement de mot de passe)
3. La variable `ADMIN_TOKEN` sur Render (console d'admin)

Coller `database/MIGRATION-SECURITE.sql` dans Neon → SQL Editor → Run, puis
ajouter la variable `ADMIN_TOKEN` sur Render. La requête de contrôle finale doit
renvoyer `t | t | t | t`.
