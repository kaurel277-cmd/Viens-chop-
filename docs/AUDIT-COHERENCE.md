# Audit de cohérence — 29 octobre 2026

> Vérification faite en exécution : pages ouvertes dans un vrai navigateur,
> API lancée contre une vraie base PostgreSQL, parcours joué avec de vrais
> comptes. Rien n'est déduit de mémoire.

## 1. Ce qui a été vérifié

| Contrôle | Méthode | Résultat |
|---|---|---|
| Liens internes et ancres | `audit/coherence.js` sur les 9 pages | 0 lien mort, 0 ancre cassée, 0 ressource manquante |
| Vocabulaire périmé (flou, SMS, note vocale, Boss, 5 messages…) | même script | 0 occurrence |
| Titres d'onglet | même script | un nom de page, rien d'autre |
| Syntaxe HTML | `html-validate` sur les 9 pages | 0 erreur |
| Écrans de l'appli (7) | `audit/parcours-complet.js` | tous présents, tous atteignables |
| Boutons et modales (quiz, faux appel, Debout, certification) | même script | fonctionnement vérifié |
| Requêtes serveur pendant le parcours | même script (écoute réseau) | 0 requête en échec |
| Erreurs JavaScript | même script, mode local + serveur + API coupée | 0 |
| Règles métier côté base | `server/test/api.test.js` | 20/20 |
| Likes, matchs, messages | `audit/test-likes-matchs.js` | 17/17 |
| Signaler / bloquer / débloquer | `audit/test-securite.js` | 31/31 |
| Photos et profil vu par un autre compte | `audit/test-serveur.js` | 14/14 |
| Médias en vue unique | `audit/test-media.js` | 22/22 |
| Inscription locale et bascule hors ligne | `audit/test-inscription-locale.js` | 31/31 |
| Entrée automatique / accès visiteur | `audit/test-entree.js` | 4/4 |
| « Qui m'a aimé » (liste offerte, photo Debout) | `audit/test-qui-ma-aime.js` | 11/11 |
| Parcours général | `audit/regression.js` | 40/40 |

## 2. Bugs trouvés et corrigés pendant l'audit

1. **Compteur de likes faux au démarrage** — l'en-tête affichait « ∞ / 3 »
   pour tout le monde, y compris les comptes gratuits. Il affiche maintenant
   les 3 likes du jour, puis la vraie valeur renvoyée par le serveur.
2. **« Passer » un profil n'était pas enregistré** — le profil revenait au
   rechargement du fil. Nouvelle table `public.passes`, route
   `POST /api/likes/pass`, et le fil exclut les profils passés. Sur une base
   qui n'a pas encore la table, l'API répond `enregistré : non` sans planter.
3. **Onglet « Sécurité » qui déclenchait un faux appel** — l'onglet s'appelle
   maintenant « Faux Appel », ce qu'il fait réellement.
4. **Essai gratuit du Faux Appel bloqué** — le bandeau promettait « 1 essai
   gratuit cette semaine » mais l'appli renvoyait directement vers le Mode
   Debout. L'essai fonctionne, le 2ᵉ de la semaine propose le Debout, et le
   quota est aussi tenu par la base en mode serveur.
5. **Aucune déconnexion possible** — un bouton « Se déconnecter » existe dans
   Mon profil : il ferme la conversation, efface le compte local et les jetons.
6. **Libellé « Stockage de l'appareil »** alors que les photos sont en base →
   « Photos de profil en ligne ».
7. **CSS mort** des anciens champs de code par SMS supprimé.

## 3. Limites assumées (écrites telles quelles sur le site)

| Sujet | État réel |
|---|---|
| SOS à un proche | **Prévu** — pas encore dans l'appli, badge « Prévu » sur `securite.html` |
| Check-in de rendez-vous | **Prévu** — idem |
| Mode discret | **Prévu** — idem |
| Blocage et signalement | API prête (`/api/safety/block`, `/api/safety/report`), pas encore de bouton dans l'appli |
| Paiement Mobile Money | maquette |
| Faxe de sécurité restant | SOS, Check-in et Mode discret restent à coder |
| Profils de démonstration | en mode appareil uniquement ; en mode serveur, ce sont de vrais comptes |
