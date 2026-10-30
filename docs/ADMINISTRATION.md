# La console d'administration

> Écrite le 30/10/2026. Tout est branché sur la vraie API et testé :
> `audit/test-admin.js` → **23 vérifications, 0 échec**.

Elle sert à trois choses : traiter les signalements, valider les profils
vérifiés, et vérifier les photos douteuses. Une seule page : `admin.html`.

---

## 1. La mettre en service · *3 min*

### a. Le SQL (une seule fois)

1. Va sur **https://console.neon.tech** → ton projet → **SQL Editor**.
2. Copie **tout** le contenu de `database/MIGRATION-SECURITE.sql`.
3. Colle-le dans l'éditeur → **Run**.
4. Tu dois voir, à la fin :

```
 table_verifications | table_admin_actions | colonne_moderation
---------------------+---------------------+--------------------
 t                   | t                   | t
```

Trois `t` = c'est prêt. (Le script peut être relancé sans risque.)

### b. Le mot de passe sur Render

1. Choisis un mot de passe long, par exemple 24 caractères : tu peux le
   fabriquer avec `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
2. Va sur **Render** → ton service **viens-chop-api** → onglet
   **Environment** → **Add Environment Variable**.
3. Case de gauche : `ADMIN_TOKEN`. Case de droite : ton mot de passe.
   → **Save Changes** (Render redéploie, ~2 min).
4. Note ce mot de passe : il ne se récupère pas.

> Si `ADMIN_TOKEN` est vide, la console est simplement **fermée** : le site
> continue de fonctionner normalement, et `admin.html` affiche
> « la console n'est pas configurée ».

### c. Ouvrir la console

1. Ouvre **`https://kaurel277-cmd.github.io/Viens-chop-/admin.html`**.
2. Colle le mot de passe → **Entrer**.
3. La console reste ouverte 8 h sur cet appareil, puis redemande le mot de passe.

---

## 2. Traiter un signalement · écran par écran

1. Onglet **Signalements**.
2. Chaque carte montre : la photo de la personne signalée, son prénom, le motif
   (Faux profil, Harcèlement, Contenu déplacé, Arnaque, Personne mineure, Autre),
   qui l'a signalé, la date et le détail écrit.
3. Si plusieurs personnes signalent le même compte, la carte l'indique
   (« 3 signalements visent ce compte »).
4. Après avoir regardé : **Marquer traité**. Le signalement quitte la liste et
   laisse une trace dans le **Journal**.

Un signalement n'est **jamais** supprimé de la base : il change de statut
(`open` → `closed`), donc l'historique reste consultable.

---

## 3. Valider un profil vérifié · écran par écran

1. Onglet **Vérifications**.
2. Deux images côte à côte : à gauche le **selfie** que la personne vient de
   prendre, à droite sa **photo de profil**.
3. **C'est la même personne** → le badge bleu « Vérifié » apparaît tout de suite
   à côté de son prénom dans le fil.
   **Refuser** → la personne voit dans Mon profil qu'elle peut recommencer.
4. Dans les deux cas, **le selfie est effacé de la base** immédiatement
   (colonne remise à vide). Il n'est jamais publié, jamais visible des autres.

Côté personne : **Mon profil → Profil vérifié → Faire vérifier mon profil →
Prendre le selfie**. Elle voit ensuite « Selfie reçu. La vérification est faite
à la main, sous 24 h. »

---

## 4. Vérifier une photo · écran par écran

1. Onglet **Photos à vérifier**.
2. Chaque carte explique **pourquoi** la photo est là :
   « Beaucoup de peau visible (72 %) », « Photo très sombre », « Image trop petite ».
3. **Elle est correcte** → la photo reste, l'étiquette disparaît.
   **Retirer la photo** → la photo disparaît du site (le serveur ne la sert plus,
   réponse 404) et la photo principale est remplacée par la suivante.

Comment la photo arrive ici : au moment de l'envoi, le navigateur mesure déjà
l'image qu'il vient de compresser (part de peau, luminosité, taille), et le
serveur applique des seuils fixes. Au-delà de 55 % de peau, sous 40 de
luminosité ou sous 300 px de côté → la photo part en vérification.

> C'est un **tri**, pas un juge : aucune photo n'est cachée automatiquement.
> Seule une décision humaine retire quelque chose du site.

---

## 5. Le journal

Onglet **Journal** : les 100 dernières actions, avec la date.
`Signalement traité`, `Profil vérifié`, `Vérification refusée`, `Photo validée`,
`Photo retirée`. C'est la trace de qui a fait quoi, utile si plusieurs
personnes utilisent la console.

---

## 6. Ce que la console ne fait pas

- Elle ne **supprime pas** de compte (volontairement : c'est irréversible).
- Elle ne **lit pas** les messages privés.
- Elle n'a pas de comptes multiples : un seul mot de passe, `ADMIN_TOKEN`.

Si tu veux un jour plusieurs comptes administrateurs avec des rôles, il faudra
une table `admins` — on peut le faire, mais ce n'est pas nécessaire aujourd'hui.

---

## 7. Vérifier soi-même

```bash
cd audit && node test-admin.js
```

23 vérifications : envoi du selfie, attente, mauvais mot de passe refusé,
validation, badge affiché dans le fil, selfie effacé, photo douteuse,
retrait (404), signalement traité, journal, déconnexion.
