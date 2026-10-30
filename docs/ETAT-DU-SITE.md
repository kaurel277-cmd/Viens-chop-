# Est-ce que le site est opérationnel ?

> Vérifié le 29 octobre 2026, en exécution — pas de mémoire.
> **Mise à jour du 29/10/2026 :** l'application fonctionne maintenant en deux
> modes, et le tableau des limites ci-dessous décrit **le mode local**.
> En **mode serveur** (adresse de l'API renseignée), les comptes, les photos,
> les likes, les matchs et les messages sont **réels et partagés** entre les
> inscrits, et **les photos sont visibles dès le fil** — plus aucun flou,
> plus de palier de 5 messages.

## Réponse courte

**Le site vitrine : oui, il est opérationnel.** 9 pages, toutes en ligne,
aucune erreur.

**L'application de rencontre : non, pas encore.** `app.html` est une
**démonstration** : les profils sont inventés, le chat parle à personne.

**Tous les bugs sont corrigés ?** Tous ceux qu'on a trouvés : oui. Mais dire
« aucun bug » serait faux — un logiciel de cette taille en cache toujours.

---

## 1. Ce qui marche vraiment

| Élément | État | Preuve |
|---|---|---|
| 11 pages du site | ✅ 200 OK | `index`, `comment-ca-marche`, `securite`, `tarifs`, `maquis`, `faq`, `inscription`, `mentions-legales`, `app`, `admin`, `hors-ligne` |
| Erreurs JavaScript | ✅ **0** sur les 9 pages | parcours automatisé |
| Ressources manquantes (404, images cassées) | ✅ **0** | idem |
| Liens internes (9 cibles distinctes) | ✅ **0 lien mort** | idem |
| Titres d'onglet (ta consigne : juste le nom) | ✅ conformes | idem |
| Inscription numéro + mot de passe | ✅ fonctionne | 31/31 vérifications |
| Enregistrement du compte | ✅ survit au rechargement | testé en `http://` **et** en `file://` |
| Mot de passe | ✅ jamais en clair (PBKDF2) | vérifié dans le stockage |
| Moins de 18 ans | ✅ bloqué | testé |
| Numéro déjà utilisé | ✅ refusé avec message clair | testé |
| Régression complète du site | ✅ **40/40** | `audit/regression.js` |
| Signaler / bloquer un profil | ✅ fonctionne (fil + discussion) | 32/32, `audit/test-securite.js` |
| Vérification selfie + badge | ✅ fonctionne | 23/23, `audit/test-admin.js` |
| Console d'administration | ✅ fonctionne (signalements, vérifications, photos) | idem |
| Installation sur l'écran d'accueil (PWA) | ✅ manifeste + service worker | 41/41, `audit/test-pwa.js` |
| Partage WhatsApp (image + titre) | ✅ Open Graph sur les 9 pages | idem |
| Liste « Profils bloqués » + déblocage | ✅ fonctionne | idem |
| Backend Neon (base + API) | ✅ `ok:true`, 6 tables | `/api/health/db` en production |
| Mobile | ✅ testé en 390 × 844 | captures |

## 2. Ce qui n'est PAS encore la vraie application

C'est la partie importante, et je ne veux pas te la vendre comme finie.

| Limite (mode local uniquement) | Ce que ça veut dire concrètement |
|---|---|
| **Les profils sont fictifs** | `app.html` contient 6 profils écrits en dur (Awa, Prisca, Fatou…). Tu ne vois pas de vraies personnes. |
| **Pas de photos** | En local, les profils de démonstration sont des dégradés. En mode serveur, les vraies photos sont affichées, sans flou. |
| **Les conversations sont inventées** | Le chat démarre avec de faux messages pré-remplis. Écrire ne joint personne. |
| **Aucune donnée partagée** | Deux personnes qui s'inscrivent ne se voient pas. Chacune reste seule sur son téléphone. |
| **Le compte ne suit pas d'un appareil à l'autre** | C'est la contrepartie du « sans API ». |
| **Mot de passe non récupérable** | Oublié = perdu, il faut écrire au support. |
| **Pas de paiement** | Les écrans Wave / Orange Money sont des maquettes. |

## 3. Les bugs corrigés jusqu'ici

Tous trouvés **en exécution**, pas en théorie. Les plus notables :

1. Compteur de likes affiché « ∞/3 » au lieu de 3.
2. Profil passé qui revenait au rechargement (table `public.passes`).
3. Onglet « Sécurité » qui envoyait sur le Faux Appel.
4. Faux Appel bloqué par le contrôle VIP alors que l'essai gratuit est prévu.
5. Bouton « Se déconnecter » absent de l'écran Mon profil.
6. Texte « Stockage de l'appareil » alors que les photos sont en ligne.
7. Un profil bloqué restait dans la liste des discussions.

## 4. Verdict honnête

- **À montrer à quelqu'un aujourd'hui** : oui. Le site est propre, rapide,
  sans erreur, l'inscription fonctionne.
- **À mettre entre les mains de vrais utilisateurs comme app de rencontre** :
  pas encore. Il manque le cœur : de vraies personnes, de vraies photos, de
  vrais messages.

## 5. Pour rendre l'app réellement opérationnelle

Dans cet ordre, et c'est ce que je propose d'attaquer :

1. **Profils réels** : les inscrits deviennent visibles les uns des autres.
2. **Photos** : envoi depuis le téléphone, stockage Cloudflare R2.
3. **Likes / matchs réels** : réciprocité, quota de 3 par jour côté serveur.
4. **Chat réel** : messages enregistrés, rafraîchis toutes les 3 s.
5. **Retour aux comptes serveur** pour que la donnée soit partagée.
6. Paiement Wave / Orange Money en dernier.

Le serveur nécessaire à tout ça **existe déjà** (Neon + Render, 11 tables,
9 triggers, 31 vérifications). Il n'est simplement pas encore branché à
l'interface.
