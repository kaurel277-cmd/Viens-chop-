# Une seule chose à faire : la migration de la base

> 29 octobre 2026

## Où on en est

Le code est **poussé et déployé** (`53b2387`). Le serveur Render annonce
déjà les nouvelles fonctions :

```
GET /api/health → {"ok":true, "features":["password-auth","photos"]}
```

Mais l'inscription renvoie une erreur 500, parce que **la base n'a pas encore
la nouvelle colonne**. Le site ne casse pas pour autant : il bascule tout seul
en mode « sur l'appareil ».

Il manque **une seule action**, et c'est du SQL, pas des logs.

---

## Écran par écran

1. Va sur **https://console.neon.tech**
2. Clique sur ton projet (celui qui contient `neondb`)
3. Dans le menu de gauche, clique sur **SQL Editor**
4. Ouvre ce fichier du dépôt et copie **tout** son contenu :
   `database/migration-v3.1-comptes-photos.sql`
   → sur GitHub : **Code** → `database` → `migration-v3.1-comptes-photos.sql`
   → bouton **Copy raw file** (les deux carrés en haut à droite)
5. Colle dans la zone de texte du SQL Editor
6. Clique sur **Run** (ou `Ctrl` + `Entrée`)

### Ce que tu dois voir ensuite

En bas, un message du type :

```
Query executed successfully
```

Un avertissement jaune peut apparaître : c'est normal, il ne bloque rien.

### Comment vérifier que c'est bon

Reviens ici et dis-moi simplement **« migration faite »**. Je lance la
vérification depuis mon côté et je te confirme en une ligne.

Si tu préfères vérifier toi-même : ouvre l'onglet **Tables** dans Neon, tu dois
voir une nouvelle table **`photos`**.

---

## Ce que cette migration fait

| Action | Effet |
|---|---|
| Ajoute `password_hash` | permet les comptes par mot de passe |
| Crée la table `photos` | stocke les photos de profil |
| Crée le trigger `photos_replace` | une photo par emplacement |
| Note la version dans `schema_migrations` | traçabilité |

**Rien n'est supprimé.** Tous les `if not exists` sont là pour ça. Tu peux la
relancer sans risque.

---

## Après la migration

Dans l'ordre, sans que tu aies à intervenir :

1. Le site bascule **automatiquement** en mode serveur.
2. L'inscription crée un compte réel dans Neon.
3. Les photos sont visibles entre comptes, y compris depuis un autre téléphone.
4. Je vérifie tout depuis mon côté et je te le confirme.

Puis j'enchaîne sur la suite : **likes et matchs réels**.
