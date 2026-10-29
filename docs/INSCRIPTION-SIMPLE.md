# Inscription simple : numéro + mot de passe

> Version du 29 octobre 2026 — bêta sans serveur

## Ce qui a changé

| Avant | Maintenant |
|---|---|
| On demandait un numéro, puis un **code à 6 chiffres envoyé par SMS** | On demande un numéro et un **mot de passe choisi par toi** |
| Il fallait que le SMS arrive (donc l'API, donc les logs) | **Aucun réseau, aucune attente** : ça marche tout de suite |
| 3 écrans | **Un seul formulaire** |
| Compte perdu si le téléphone change de navigateur | Compte enregistré **sur l'appareil** |

Le formulaire demande maintenant exactement ce que montrait ta capture :
numéro, mot de passe, confirmation, **code d'invitation (facultatif)**,
date de naissance et la case des 18 ans.

## Comment ça marche

Un seul fichier fait le travail : `assets/js/compte.js`.

- Le numéro est l'identifiant, le mot de passe protège l'accès.
- **Le mot de passe n'est jamais écrit en clair.** On garde un sel aléatoire et
  une empreinte PBKDF2-SHA256 (120 000 tours, WebCrypto).
- Le compte garde aussi : date de naissance, âge calculé, code d'invitation,
  plan (Coulé), 3 likes gratuits.
- Une fois inscrit, la personne est **déjà connectée** : `app.html` s'ouvre
  directement sur le fil de découverte.
- Si elle revient plus tard, elle retrouve son compte : `app.html` va droit au
  fil. Après une déconnexion, elle se reconnecte avec **numéro + mot de passe**.

## Ce qui est vérifié

- **31/31** vérifications sur le parcours complet, dans un vrai navigateur
  mobile, **sans réseau** (`audit/test-inscription-locale.js`).
- **39/39** tests de régression sur tout le site (`audit/regression.js`).
- Aucune erreur JavaScript, **aucun appel à une API**.
- Contrôles toujours actifs : numéro invalide, mot de passe trop court,
  confirmation différente, **moins de 18 ans bloqué**, CGU obligatoires,
  numéro déjà utilisé.

## La limite, dite franchement

Un compte enregistré sur l'appareil **ne suit pas la personne** d'un téléphone
à l'autre, et s'efface si elle vide son navigateur. C'est le prix du « sans
API ». Pour la version publique, il faudra :

1. les vrais comptes serveur (c'est déjà écrit et testé : `server/`) ;
2. un fournisseur SMS (Termii ou Twilio) pour vérifier les numéros ;
3. ou la connexion par WhatsApp / Google, qui évite le SMS.

Rien n'est perdu : `assets/js/api.js` et le parcours serveur restent dans le
dépôt, prêts à reprendre quand tu voudras.

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `assets/js/compte.js` | **nouveau** — création, connexion, session, mot de passe |
| `inscription.html` | formulaire unique, sans SMS |
| `app.html` | connexion par mot de passe, entrée automatique si déjà inscrit |
| `assets/js/api.js` | conservé, mais **plus utilisé par le site** |
