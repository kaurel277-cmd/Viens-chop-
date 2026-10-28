# Viens chop — Guide de démarrage, étape par étape

> À suivre dans l'ordre. Compte **45 à 60 minutes** la première fois.
> Aucune ligne de commande n'est nécessaire : tout se fait dans le navigateur.
>
> ⚠️ **Ne m'envoie jamais ton mot de passe de base de données.** Les secrets se
> collent directement chez Neon et chez Render, ils n'ont pas à passer par une
> conversation.

---

## Ce que tu vas obtenir à la fin

Une vraie base de données en ligne, une API qui tourne 24 h/24 avec une adresse
`https://...`, et la possibilité de créer un compte avec un numéro de téléphone.
Le site, lui, restera branché en mode démonstration jusqu'à l'étape suivante.

---

## Étape 1 — Créer le compte Neon · *5 min*

1. Va sur **https://neon.tech**
2. Clique sur **Sign up** en haut à droite.
3. Choisis **Continue with GitHub** (le plus rapide, tu as déjà un compte GitHub).
4. Autorise Neon à accéder à ton compte GitHub.

Tu arrives sur le tableau de bord. C'est vide, c'est normal.

---

## Étape 2 — Créer le projet · *2 min*

1. Clique sur **New Project**.
2. Renseigne :

   | Champ | Valeur à mettre |
   |---|---|
   | Project name | `viens-chop` |
   | Database name | `neondb` *(laisser par défaut)* |
   | Region | **AWS eu-central-1 (Frankfurt)** ou **eu-west-1 (Ireland)** |

   > Pourquoi l'Europe ? C'est le plus proche d'Abidjan parmi les régions
   > disponibles. Le Ghana et l'Afrique du Sud ne sont pas proposés par Neon
   > aujourd'hui.

3. Clique sur **Create project**.

Neon crée la base en quelques secondes et affiche une fenêtre
**« Connection Details »**.

---

## Étape 3 — Récupérer les deux chaînes de connexion · *3 min*

Dans cette fenêtre, en haut, il y a un menu déroulant
**Connection string** avec deux choix. Tu as besoin des deux.

**3.1 — La chaîne « Pooled connection »**

1. Sélectionne **Pooled connection**.
2. Clique sur l'icône **copier**.
3. Colle-la dans un fichier texte, note à côté : `POOLED`.

**3.2 — La chaîne « Direct connection »**

1. Sélectionne **Direct connection**.
2. Copie-la.
3. Colle-la à la suite, note à côté : `DIRECT`.

Tu obtiens deux lignes de la forme :

```
postgresql://neondb_owner:AbC123xyz@ep-cool-name-12345-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
postgresql://neondb_owner:AbC123xyz@ep-cool-name-12345.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

> **La différence, en une phrase :** celle avec `-pooler` dans l'adresse sert à
> l'application, celle sans `-pooler` sert à installer les tables. Si tu
> inverses, ça finit par tomber en panne de connexions.

Si tu as fermé la fenêtre : tableau de bord → **Connect** (en haut à droite).

---

## Étape 4 — Installer les tables · *5 min*

1. Dans le menu de gauche de Neon, clique sur **SQL Editor**.
2. Ouvre dans un autre onglet :
   **`https://github.com/kaurel277-cmd/Viens-chop-/blob/main/database/neon-schema.sql`**
3. Clique sur le bouton **« Raw »** (en haut à droite du fichier) pour avoir le
   texte brut.
4. Sélectionne tout (`Ctrl+A` / `Cmd+A`), copie (`Ctrl+C`).
5. Reviens dans le SQL Editor de Neon, colle dans la zone de texte.
6. Clique sur **Run**.

**Ce que tu dois voir :** une liste de messages `CREATE TABLE`, `CREATE FUNCTION`,
`CREATE TRIGGER`, et à la fin :

```
NOTICE: Rôle vienschop_api ignoré (création de rôle non autorisée) — l'API utilisera le rôle propriétaire de la base.
```

> ✅ **Ce message est normal et attendu.** Sur Neon, ton compte n'a pas le droit
> de créer d'autres rôles. Le schéma le détecte et continue. Rien à corriger.

Si tu vois `ERROR`, arrête-toi ici et note le message : c'est le seul cas où il
faut me le montrer.

---

## Étape 5 — Vérifier que les règles fonctionnent · *3 min*

Toujours dans le SQL Editor :

1. Ouvre **`https://github.com/kaurel277-cmd/Viens-chop-/blob/main/database/VERIFIER-NEON.sql`**
2. **Raw** → tout sélectionner → copier.
3. Colle dans le SQL Editor (remplace ce qu'il y avait) → **Run**.

**Ce que tu dois voir :** un tableau de 14 lignes, toutes en `OK` :

```
 #  | Règle vérifiée                     | Résultat
----+------------------------------------+----------------------
 1  | Âge calculé automatiquement        | OK (26 ans)
 2  | Mineur refusé                      | OK
 3  | Un like seul ne crée pas de match  | OK
 ...
14  | Vue « qui m'a liké »               | OK (photo masquée)
```

Le script efface ses propres données de test à la fin. Ta base reste vide.

> Si une ligne affiche `ÉCHEC`, c'est un vrai problème : copie-moi la ligne
> concernée.

---

## Étape 6 — Générer deux secrets · *2 min*

L'API a besoin de deux longues chaînes aléatoires. Elles protègent les sessions
et les codes SMS.

**Méthode simple, sans terminal :** tu n'as rien à inventer. Sur Render, le champ
de droite propose un bouton **⚙ Generate** qui produit une valeur aléatoire : tu
cliques, tu acceptes. À faire une fois pour `JWT_SECRET`, une fois pour
`OTP_PEPPER` (deux valeurs différentes). Voir
[`RENDER-PAS-A-PAS.md`](RENDER-PAS-A-PAS.md), écran B.

À titre indicatif, la forme d'un secret correct :

```
JWT_SECRET  → k7Qm2pXv9LrT4wZb8NcJ6yHd3FsA1gEu5RtY0oPi2WqX8vBn4MkJ7hGf6DsA9zC1
OTP_PEPPER  → tR5yU8iO2pA6sD9fG3hJ7kL1zX4cV0bN8mQ2wE5rT9yU3iO6pA1sD4fG7hJ0kL
```

Règles : **au moins 32 caractères**, les deux **différentes**, et tu ne les
changes plus jamais (sinon tout le monde est déconnecté).

Note-les dans ton fichier texte, à côté de `POOLED` et `DIRECT`.

---

## Étape 7 — Déployer l'API sur Render · *10 min*

> 📌 **Cette étape est détaillée écran par écran dans
> [`RENDER-PAS-A-PAS.md`](RENDER-PAS-A-PAS.md)** — avec les 6 variables à
> saisir, le bouton « Generate » pour les secrets, et le réglage
> **Root Directory = `server`** sans lequel le déploiement échoue.

1. Va sur **https://render.com** → **Get Started** → **GitHub** → autorise.
2. Clique sur **New +** en haut à droite → **Blueprint**.
3. Choisis le dépôt **`kaurel277-cmd/Viens-chop-`** → **Connect**.
4. Render lit le fichier `render.yaml` que j'ai ajouté et affiche un service
   nommé **viens-chop-api**.
5. Il demande les variables marquées comme secrètes. Renseigne :

   | Variable | Ce que tu colles |
   |---|---|
   | `DATABASE_URL` | la chaîne **POOLED** de l'étape 3 |
   | `JWT_SECRET` | ton premier secret de l'étape 6 |
   | `OTP_PEPPER` | ton second secret de l'étape 6 |
   | `CORS_ORIGIN` | `*` pour l'instant (on le restreindra plus tard) |

6. Clique sur **Apply** / **Create**.
7. Attends 2 à 4 minutes. Render affiche `Live` en vert.

**Ton adresse d'API** apparaît en haut, du type :
`https://viens-chop-api.onrender.com`

Note-la aussi.

---

## Étape 8 — Vérifier que l'API répond · *2 min*

Ouvre cette adresse dans ton navigateur (remplace par la tienne) :

```
https://viens-chop-api.onrender.com/api/health
```

**Ce que tu dois voir :**

```json
{"ok":true,"service":"viens-chop-api","time":"..."}
```

⚠️ Cette page prouve seulement que le **serveur** tourne : elle ne touche pas à
Neon. Pour vérifier la base, ouvre ensuite :

```
https://viens-chop-api.onrender.com/api/health/db
```

Tu dois y voir `"ok": true`, `"tables"` toutes à `true` et `"triggers_regles":
"7 / 7"`. Si ce n'est pas le cas, le tableau de correspondance est dans
[`RENDER-PAS-A-PAS.md`](RENDER-PAS-A-PAS.md#écran-g--le-diagnostic-de-la-base). Il contient aussi les sept erreurs
possibles et leur correction.

> ⚠️ Sur l'offre gratuite, Render endort le service après 15 minutes sans
> visite. La première requête peut donc mettre **30 à 60 secondes** à répondre.
> C'est normal : recharge la page.

---

## Étape 9 — Créer un compte pour de vrai · *5 min*

1. Ouvre `outil-test.html` (il est à la racine de ton dépôt, ajouté pour ça).
   Pour l'utiliser : ouvre **`https://kaurel277-cmd.github.io/...`** si tu as
   activé GitHub Pages, ou télécharge le fichier et ouvre-le dans ton navigateur.
2. Dans **Adresse de l'API**, colle ton adresse Render.
3. Laisse le numéro `0701020304` → clique sur **Envoyer le code**.
4. Le code n'arrive pas par SMS (aucun fournisseur n'est encore branché). Va le
   lire dans **Render → ton service → Logs** : tu y verras
   `📱 [SMS simulé] +2250701020304 : Viens chop : ton code est 4 8 2 9 1 3`.
5. Reporte le code dans l'outil → **Valider**.
6. Clique sur **Voir mon profil** : tu dois voir ton compte, avec
   `"likes_left": 3`.

✅ **À ce stade, le backend fonctionne pour de vrai.** Un compte a été créé dans
une vraie base PostgreSQL, avec une vraie session.

---

## Étape 10 — Ce qu'il te reste à décider

Trois choix, qu'on prendra ensemble :

1. **Le nom de domaine** — ex. `viens-chop.ci`. Nécessaire pour le partage
   WhatsApp et la crédibilité.
2. **Le fournisseur SMS** — sans lui, impossible d'inscrire qui que ce soit.
   Il faut ouvrir un compte (Termii, Twilio, ou Orange CI directement) et
   prévoir un budget par SMS. Compte environ 25 à 45 FCFA par code selon le
   fournisseur.
3. **Le stockage des photos** — je recommande Cloudflare R2 (10 Go gratuits,
   aucun frais de transfert).

---

## Si quelque chose bloque

| Message | Cause | Solution |
|---|---|---|
| `permission denied to create role` | c'est normal sur Neon | ignoré par le schéma, aucune action |
| `Relation "users" already exists` | tu as relancé le script | sans gravité, le schéma est ré-exécutable |
| Page blanche sur `/api/health` | service endormi | recharge après 60 s |
| `Application failed to respond` sur Render | mauvaises variables | vérifie que `DATABASE_URL` est bien la chaîne **pooled** |
| `CORS policy` dans la console du navigateur | origine non autorisée | mets `CORS_ORIGIN=*` le temps des tests |
| `password authentication failed` | chaîne tronquée au copier-coller | recopie-la entièrement depuis Neon |
| Le code SMS n'arrive pas | aucun fournisseur branché | lis-le dans les logs Render (étape 9) |

---

## Récapitulatif à me communiquer

Quand tu as terminé, dis-moi simplement :

- ✅ « l'API répond » (ou colle-moi la réponse de `/api/health`)
- l'adresse de ton API Render

**Ne me communique pas** : `DATABASE_URL`, `JWT_SECRET`, `OTP_PEPPER`.
