# Profils réels + photos : ce qui a changé

> 29 octobre 2026 — Cloudflare abandonné, photos stockées dans Neon

## Le choix retenu

Sans Cloudflare, il restait une évidence : **les photos vont dans Neon**, la
base qui garde déjà les comptes depuis des mois.

| Pourquoi c'est le bon endroit | |
|---|---|
| Render efface son disque à chaque déploiement | ✅ Neon garde les données |
| Une photo compressée pèse 25–90 Ko | ✅ 3 photos = ~200 Ko par personne |
| Aucun service de plus, aucune facture de plus | ✅ on reste sur l'existant |

## Ce qui fonctionne maintenant

1. **Inscription réelle** : numéro + mot de passe, compte créé dans Neon.
2. **Connexion réelle** : le compte suit la personne d'un téléphone à l'autre.
3. **Photos de profil** : 3 maximum, compressées dans le navigateur, stockées
   dans la base, servies par l'API.
4. **Fil de découverte** : les autres inscrits apparaissent, avec leur photo.
5. **Repli automatique** : si le serveur ne répond pas (hors ligne, aperçu
   intégré, déploiement en cours), le site enregistre le compte sur l'appareil
   et continue de fonctionner. Il ne casse jamais.

## Les règles de sécurité appliquées côté serveur

| Règle | Où |
|---|---|
| Mot de passe haché (scrypt, sel par compte) | `server/src/password.js` |
| Moins de 18 ans refusé | trigger PostgreSQL |
| 10 essais de connexion / 15 min / IP | `server/src/index.js` |
| 10 inscriptions / heure / IP | idem |
| Photo : WebP ou JPEG, 110 Ko max | `server/src/routes/photos.js` |
| Une seule photo par emplacement | trigger `photos_replace` |
| Photo introuvable = 404, jamais d'erreur interne | route photos |

## Ce qu'il reste à faire pour que ça vive en production

**Aucune ligne de code.** Deux gestes, dans cet ordre :

1. **La base** : coller `database/migration-v3.1-comptes-photos.sql` dans
   Neon → SQL Editor → Run. (Ajoute la colonne mot de passe et la table photos.
   Aucune donnée existante n'est touchée.)
2. **Le serveur** : il redéploie tout seul au prochain envoi sur GitHub.
   Vérifie que le déploiement est terminé (« Live »).

Ensuite `/api/health` renvoie `features: ["password-auth","photos"]`, et le
site passe de lui-même en mode serveur.

> Tant que la migration n'est pas faite, le site reste en mode « sur
> l'appareil » : il fonctionne, mais les profils ne sont pas partagés.

## Vérifié en exécution

| Test | Résultat |
|---|---|
| Inscription + photo côté serveur | **14/14** |
| Un autre compte voit le profil et sa photo | ✅ |
| Connexion sur un « autre téléphone » retrouve nom + photos | ✅ |
| Repli local sans serveur | **31/31** |
| Médias et vue unique | **22/22** |
| Régression du site | **39/39** |

## Limites connues, dites franchement

- **110 Ko par photo** : c'est volontairement petit pour économiser Neon.
  Sur écran de téléphone, ça reste net.
- **Les médias « vue unique » ne sont jamais stockés côté serveur** : ils
  restent sur l'appareil et disparaissent après lecture. C'est un choix de
  confidentialité, pas un oubli.
- **Neon gratuit ≈ 0,5 Go** : environ 5 000 photos. Au-delà, il faudra soit
  passer au plan payant, soit réduire le nombre de photos par profil.
- Les profils sans genre renseigné n'apparaissent pas dans le fil (normal :
  on ne sait pas qui les cherche).
