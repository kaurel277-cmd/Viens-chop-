# Ta prochaine action, précisément

> État constaté le 28 octobre 2026 à 09 h 00 (heure d'Abidjan), en interrogeant
> ta propre API.

---

## Ce qui marche déjà

| Élément | État | Preuve |
|---|---|---|
| Site statique | ✅ | 10 pages servies, CSS et images compris |
| API déployée sur Render | ✅ | `{"ok":true,"service":"viens-chop-api"}` |
| Adresse de connexion Neon | ✅ | la chaîne *pooled* est correcte |
| Connexion API → Neon | ✅ | `"connexion": "OK (285 ms)"` |

Tu as donc réussi les étapes 1 à 8. **Ton `DATABASE_URL` est bon**, la chaîne
`-pooler` est la bonne, le SSL est bon. C'est la partie la plus délicate, et
elle est derrière toi.

---

## Ce qui bloque, et pourquoi

Le diagnostic `/api/health/db` renvoie :

```json
"tables": { "users": true, "otp_codes": false, "likes": false,
            "matches": false, "messages": true, "sessions": false }
```

**Traduction :** le script SQL a été exécuté en deux morceaux, pas en entier.
Deux tables existent, quatre manquent. Sans `otp_codes`, personne ne peut
recevoir de code SMS — donc personne ne peut créer de compte.

Ce n'est pas une faute de ta part : c'est mon fichier qui est long, et un
copier-coller partiel ne se voit pas.

---

## Les deux copier-coller à faire — 3 minutes

### 1. Remettre la base à zéro

1. Ouvre **https://console.neon.tech** → ton projet `viens-chop`
2. Menu de gauche → **SQL Editor**
3. Dans GitHub, ouvre :
   `https://github.com/kaurel277-cmd/Viens-chop-/blob/main/database/REINITIALISER-NEON.sql`
4. Clique sur **Raw** (en haut à droite), puis **tout sélectionner** et copier
5. Colle dans le SQL Editor de Neon → **Run**

La dernière ligne doit afficher :

```
tables restantes : 0
```

### 2. Réinstaller proprement

1. **Efface tout** le contenu du SQL Editor (c'est important, sinon tu vas
   mélanger les deux scripts)
2. Ouvre :
   `https://github.com/kaurel277-cmd/Viens-chop-/blob/main/database/neon-schema.sql`
3. **Raw** → tout sélectionner → copier
4. Colle → **Run**

Tu dois voir défiler `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, et à
la fin :

```
NOTICE: Rôle vienschop_api ignoré (création de rôle non autorisée)
```

Ce message est normal. Si tu vois `ERROR` en rouge, arrête-toi et envoie-moi la
ligne.

> **Astuce pour être sûr de tout copier :** sur la page GitHub du fichier,
> utilise le bouton **« Copy raw file »** (l'icône de deux feuilles), pas une
> sélection à la souris. Il copie le fichier entier à coup sûr.

### 3. Vérifier

Ouvre :

```
https://viens-chop-api.onrender.com/api/health/db
```

Attendu :

```json
{
  "ok": true,
  "etapes": {
    "connexion": "OK",
    "tables": { "users": true, "otp_codes": true, "likes": true,
                "matches": true, "messages": true, "sessions": true },
    "triggers_regles": "7 / 7",
    "fonctions": "OK",
    "comptes": 0
  },
  "conseils": []
}
```

Si tu vois ça, **le backend est terminé et fonctionnel.**

---

## Ensuite — 5 minutes : ton premier vrai compte

1. Télécharge `outil-test.html` depuis ton dépôt (bouton **Download raw file**)
   et **ouvre-le en double-cliquant** sur ton ordinateur.

   ⚠️ Ne l'utilise pas dans l'aperçu Arena : cet aperçu fonctionne dans un
   cadre isolé sans accès réseau, les appels vers Render y échouent. Il faut
   le fichier ouvert dans un onglet normal.

2. Dans **Adresse de l'API**, mets :
   `https://viens-chop-api.onrender.com`
3. Numéro : `0701020304` → **Envoyer le code**
4. Le code n'arrive pas par SMS (aucun opérateur n'est encore branché). Va le
   lire dans **Render → ton service → Logs**. Tu y verras :
   ```
   📱 [SMS simulé] +2250701020304 : Viens chop : ton code est 482913. Il expire dans 5 min.
   ```
5. Reporte ce code → **Valider**
6. Clique sur **Voir mon profil** → tu dois voir `"likes_left": 3`

Tu viens de créer un compte dans une vraie base PostgreSQL, via une vraie API.

---

## Ce qu'on fera après

| Ordre | Chantier | Ce qu'il te faudra |
|---|---|---|
| 1 | Brancher `inscription.html` sur l'API | rien |
| 2 | Brancher `app.html` (fil, likes, chat) | rien |
| 3 | Stockage des photos | un compte Cloudflare (gratuit) |
| 4 | Vrai SMS | un compte Termii ou Twilio, budget par SMS |
| 5 | Paiement Wave / Orange Money | un compte marchand |

---

## Si `/api/health/db` ne passe pas au vert

Envoie-moi **uniquement** le bloc JSON renvoyé par cette adresse. Il ne contient
aucun secret : ni mot de passe, ni jeton. Le champ `erreur` suffit à savoir quoi
corriger.
