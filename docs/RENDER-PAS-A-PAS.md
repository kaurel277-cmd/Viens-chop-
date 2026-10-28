# Render — pas à pas, écran par écran

> Ce fichier complète `GUIDE-DEMARRAGE.md` pour l'étape 7, qui était trop vague.
> Suis les écrans dans l'ordre. Chaque champ est donné **tel qu'il faut le taper**.

---

## D'abord : où es-tu exactement ?

Ta capture montre une liste de variables **vide**, avec `NAME_OF_VARIABLE` en
gris. Cela veut dire une seule chose :

> Tu es en train de créer le service **manuellement**, et non via le Blueprint
> (`render.yaml`). Les variables ne sont donc pas pré-remplies.

Ce n'est pas grave — mais deux réglages deviennent obligatoires et n'étaient pas
dans mes premières instructions :

- **Root Directory = `server`** ← sans ça, Render ne trouve pas le `package.json`
  (il est dans `server/`, pas à la racine du dépôt) et le déploiement échoue.
- **Build Command = `npm install`** (et non `npm ci --omit=dev`, qui n'est
  valable que dans le Blueprint).

---

## Écran A — Le service Render

| Champ de l'écran | Ce qu'il faut mettre | Pourquoi |
|---|---|---|
| **Name** | `viens-chop-api` | deviendra l'adresse `viens-chop-api.onrender.com` |
| **Region** | `Frankfurt (EU Central)` | la région la plus proche d'Abidjan |
| **Branch** | `main` | ta branche par défaut |
| **Root Directory** | **`server`** | ⚠️ **le champ le plus important** : tout le code de l'API est là |
| **Runtime** | `Node` | |
| **Build Command** | `npm install` | |
| **Start Command** | `npm start` | correspond au script du `package.json` |
| **Instance Type** | `Free` | gratuit, l'app s'endort après 15 min |

> Si le champ **Root Directory** n'est pas visible, clique sur
> **Advanced** / **Advanced settings** juste sous Build Command.

---

## Écran B — Les variables d'environnement (ta capture)

C'est l'écran que tu as en ce moment. Il y a **6 variables** à saisir.

### Comment remplir une ligne

1. Clique dans la case de gauche (celle avec `NAME_OF_VARIABLE`).
2. Tape **exactement** le nom de la clé (respecte les majuscules et les `_`).
3. Clique dans la case de droite (celle avec `value`).
4. Renseigne la valeur selon le tableau ci-dessous.

Les lignes sont ajoutées avec **+ Add Environment Variable**.

### Les 6 variables, dans l'ordre

| # | Case de gauche (KEY) | Case de droite (VALUE) | Comment l'obtenir |
|---|---|---|---|
| 1 | `DATABASE_URL` | la chaîne **Pooled** de Neon | voir « Écran C » ci-dessous |
| 2 | `JWT_SECRET` | une valeur générée | taper la clé, **puis cliquer sur « Generate »** |
| 3 | `OTP_PEPPER` | une **autre** valeur générée | taper la clé, **puis cliquer sur « Generate »** |
| 4 | `CORS_ORIGIN` | `*` | à taper : une étoile |
| 5 | `SMS_PROVIDER` | `console` | à taper tel quel |
| 6 | `NODE_ENV` | `production` | à taper tel quel |

### ⚠️ Le bouton « Generate » — c'est la réponse à ta question sur les secrets

Dans mes premières instructions je te disais « invente deux longues phrases
aléatoires ». C'était imprécis : **tu n'as rien à inventer**, il y a un bouton
exprès pour ça dans l'écran que tu as sous les yeux.

1. Pour `JWT_SECRET` : tape la clé à gauche, clique dans la case de droite,
   clique sur **⚙ Generate**.
2. Une valeur aléatoire apparaît. **Accepte-la telle quelle.**
3. Recommence à l'identique pour `OTP_PEPPER` (la valeur sera différente,
   c'est le but).

Ne recopie pas la même valeur dans les deux : `JWT_SECRET` signe les sessions,
`OTP_PEPPER` protège les codes SMS. Deux rôles différents, deux secrets
différents.

---

## Écran C — Où récupérer `DATABASE_URL` dans Neon

1. Va sur **https://console.neon.tech**
2. Clique sur ton projet **viens-chop**.
3. En haut à droite du tableau de bord, clique sur **Connect**.
4. Une fenêtre s'ouvre avec un menu déroulant **Connection string**.
5. Choisis **Pooled connection** (l'option la plus haute, c'est la bonne).
6. Clique sur l'icône **copier** à droite de la chaîne.

Tu obtiens une ligne de cette forme :

```
postgresql://neondb_owner:AbC123xyz@ep-cool-name-12345-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**Vérifie deux choses avant de coller :**

- ✅ l'adresse contient bien **`-pooler`** juste avant `.eu-central-1`
- ✅ le `?sslmode=require` est bien à la fin (Neon l'exige)

Colle-la entièrement dans la case de droite de `DATABASE_URL`. Attention à ne
pas perdre la fin en copiant.

---

## Écran D — Lancer le déploiement

1. Vérifie que les 6 variables sont présentes (une ligne avec une faute de
   frappe dans le nom = variable ignorée silencieusement).
2. Clique sur **Create Web Service** (ou **Save Changes** si le service existe
   déjà).
3. Un écran de logs défile. Compte **3 à 5 minutes**.

### Ce que tu dois voir à la fin

```
==> Your service is live 🎉
```

et une adresse en haut du type :

```
https://viens-chop-api.onrender.com
```

**Note cette adresse**, c'est celle que tu colleras dans `outil-test.html`.

### Ce que tu ne dois PAS voir

```
Error: Cannot find module '/opt/render/project/src/src/index.js'
```

→ le **Root Directory** n'est pas `server`. Retourne dans **Settings** →
**Root Directory** → mets `server` → **Save** → **Manual Deploy**.

---

## Écran E — Vérifier que ça répond

Ouvre dans ton navigateur :

```
https://viens-chop-api.onrender.com/api/health
```

Réponse attendue :

```json
{"ok":true,"service":"viens-chop-api","time":"2026-10-26T..."}
```

### Les deux réponses « pas encore bonnes »

| Ce que tu vois | Ce que ça veut dire | Quoi faire |
|---|---|---|
| la page tourne 30 à 60 s puis répond | service endormi (offre gratuite) | **normal**, recharge |
| `{"error":{"code":"ERREUR_SERVEUR"}}` | `DATABASE_URL` incorrecte | recopie la chaîne Pooled |
| `Application failed to respond` | le service démarre mal | va dans **Logs** et lis les 5 dernières lignes |
| une page Render « Not Found » | le service n'est pas encore déployé | attends la fin du build |

---

## Écran F — Le premier vrai compte

1. Ouvre `outil-test.html` (à la racine du dépôt).
2. Dans **Adresse de l'API**, colle `https://viens-chop-api.onrender.com`.
3. Numéro : `0701020304` → **Envoyer le code**.
4. Le code n'arrive pas par SMS : il s'affiche dans **Render → ton service →
   Logs**, sous la forme :
   ```
   📱 [SMS simulé] +2250701020304 : Viens chop : ton code est 482913. Il expire dans 5 min.
   ```
5. Reporte ce code dans l'outil → **Valider**.
6. Clique sur **Voir mon profil** → tu dois voir `"likes_left": 3`.

C'est bon : un compte existe réellement dans ta base PostgreSQL.

---

## Récapitulatif visuel

```
Neon                          Render                      Ton navigateur
─────────────────────────     ──────────────────────     ─────────────────────
Base "viens-chop"      ──────► DATABASE_URL
  ↗ chaîne Pooled              JWT_SECRET (Generate)
  ↘ chaîne Direct              OTP_PEPPER (Generate)
    (pour le SQL Editor)       CORS_ORIGIN = *
                               SMS_PROVIDER = console
                               NODE_ENV = production
                                     │
                                     ▼
                               /api/health  ──────────►  {"ok":true}
```

---

## Ce qu'il ne faut jamais faire

- ❌ mettre `DEV_OTP_BYPASS` en production : n'importe qui entrerait avec
  le code `123456`.
- ❌ coller `DATABASE_URL_DIRECT` dans Render : utilise la chaîne **Pooled**.
- ❌ laisser `CORS_ORIGIN=*` après la mise en ligne du site : remplace-le par
  l'adresse exacte du site.
- ❌ m'envoyer ces valeurs. Elles restent entre Neon, Render et toi.

---

## Écran G — Le diagnostic de la base

`/api/health` dit seulement que le **processus** tourne. Il ne touche pas à
Neon : il peut répondre `{"ok":true}` alors que la base est injoignable.

Pour tester la vraie chaîne jusqu'à PostgreSQL, ouvre :

```
https://viens-chop-api.onrender.com/api/health/db
```

### Si tout va bien

```json
{
  "ok": true,
  "etapes": {
    "variable_presente": true,
    "chaine_pooled": true,
    "ssl_demande": true,
    "hote": "ep-xxx-pooler.eu-central-1.aws.neon.tech",
    "connexion": "OK (38 ms)",
    "tables": { "users": true, "otp_codes": true, "likes": true,
                "matches": true, "messages": true, "sessions": true },
    "triggers_regles": "7 / 7",
    "fonctions": "OK",
    "comptes": 0
  },
  "conseils": []
}
```

`chaine_pooled` doit être **true**. S'il est à `false`, tu as collé la chaîne
« Direct » au lieu de « Pooled » : ça fonctionne, mais ça finira par saturer.

### Si ça renvoie une erreur

| `erreur` | Signification | Correction |
|---|---|---|
| `SCHEMA_ABSENT` | connexion OK, mais aucune table | exécute `database/neon-schema.sql` dans Neon → SQL Editor |
| `SCHEMA_INCOMPLET` | tables présentes, triggers manquants | réexécute le script **en entier** |
| `FONCTIONS_ABSENTES` | schéma `app` manquant | idem |
| `MOT_DE_PASSE_REFUSE` | chaîne tronquée, ou projet Neon en pause | recopie la chaîne ; vérifie que le projet est « Active » |
| `BASE_INTROUVABLE` | nom de base faux | sur Neon : `neondb` |
| `SERVEUR_INJOIGNABLE` | adresse fausse | recopie depuis Neon → Connect |
| `DELAI_DEPASSE` | base endormie | recharge après quelques secondes |

Ce diagnostic ne divulgue aucun secret : il n'affiche que la classification de
l'erreur et le nom d'hôte, jamais le mot de passe.
