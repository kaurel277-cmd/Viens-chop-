# Mettre Viens chop en ligne — la partie que je ne peux pas faire à ta place

> 30/10/2026. Tout ce qui est **dans le dépôt** est prêt. Ce document liste
> uniquement ce qui demande **ton compte GitHub** ou le dépôt d'un nom de domaine.

---

## 1. Activer GitHub Pages (le site est déjà en ligne, mais il faut vérifier)

Le site répond déjà sur :
`https://kaurel277-cmd.github.io/Viens-chop-/`

Si un jour il ne répond plus, c'est ici que ça se règle :

1. Va sur **https://github.com/kaurel277-cmd/Viens-chop-** (connecté).
2. Onglet **Settings** (en haut, à droite).
3. Dans la colonne de gauche : **Pages**.
4. Section **Build and deployment** → **Source** : `Deploy from a branch`.
5. **Branch** : `main` — **Folder** : `/ (root)` → **Save**.
6. Attends 1 à 2 minutes, puis recharge la page : un bandeau vert affiche
   « Your site is live at https://kaurel277-cmd.github.io/Viens-chop-/ ».

Aucune action sur les fichiers : chaque `git push` met le site à jour tout seul.

---

## 2. Le nom de domaine (facultatif mais recommandé)

Un lien `kaurel277-cmd.github.io/Viens-chop-/` fait peur sur WhatsApp. Un
domaine court, oui.

1. Achète le domaine chez un registrar (Namecheap, OVH, ou **`.ci` chez
   nic.ci**). Compte 12 000 à 20 000 FCFA par an pour un `.ci`.
2. Dans GitHub : **Settings → Pages → Custom domain** → tape
   `vienschop.ci` (ou celui que tu as pris) → **Save**.
3. GitHub affiche alors une **adresse IP** et un **CNAME** à recopier chez ton
   registrar (section DNS) :
   - pour un domaine racine (`vienschop.ci`) : 4 enregistrements `A` vers les
     IP GitHub ;
   - pour `www.vienschop.ci` : un `CNAME` vers `kaurel277-cmd.github.io`.
4. Attends 1 à 24 h (propagation DNS), puis coche **Enforce HTTPS**.

⚠️ Quand le domaine change, il faut aussi mettre à jour `CORS_ORIGIN` sur
Render avec la nouvelle adresse, sinon l'application ne pourra plus joindre
l'API.

---

## 3. Les variables sur Render (à vérifier une fois)

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | la chaîne **Pooled** de Neon |
| `JWT_SECRET` | un secret long, jamais changé |
| `CORS_ORIGIN` | `*` aujourd'hui — l'adresse exacte du site après le domaine |
| `ADMIN_TOKEN` | le mot de passe de `admin.html` |
| `NODE_ENV` | `production` |

Après chaque changement : **Save Changes**, Render redéploie en ~2 min.

---

## 4. Le SQL à passer une fois dans Neon

`database/MIGRATION-SECURITE.sql` (vérifications, modération, journal).
Voir `docs/ADMINISTRATION.md` § 1 pour la procédure écran par écran.

---

## 5. Vérifier après la mise en ligne

1. Ouvre le site sur ton téléphone.
2. **Partage le lien dans une conversation WhatsApp avec toi-même** : tu dois
   voir l'image orange « Viens chop », le titre et la description. C'est le
   test le plus important : c'est comme ça que les gens découvriront le site.
3. Sur Android : menu du navigateur → **Installer l'application**. L'icône
   « VC » doit apparaître sur l'écran d'accueil et s'ouvrir en plein écran.
4. Sur iPhone : bouton **Partager** → **Sur l'écran d'accueil**.
5. Coupe les données mobiles, ouvre l'application : la page « Pas de connexion »
   doit s'afficher proprement, pas une page blanche.
