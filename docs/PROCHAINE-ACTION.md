# Ta prochaine action, précisément

> État vérifié le 28 octobre 2026 en interrogeant ta propre API de production.

---

## ✅ Le backend est terminé

```json
{
  "ok": true,
  "etapes": {
    "chaine_pooled": true,
    "connexion": "OK (243 ms)",
    "tables": { "users": true, "otp_codes": true, "likes": true,
                "matches": true, "messages": true, "sessions": true },
    "triggers_regles": "7 / 7",
    "fonctions": "OK",
    "comptes": 0
  },
  "conseils": []
}
```

Et l'envoi d'un code a été testé pour de vrai :

```
POST /api/auth/otp  →  {"ok":true,"expires_in":300}
```

Le code a été généré, haché et enregistré dans ta base PostgreSQL.

| Élément | État |
|---|---|
| Site statique (10 pages) | ✅ |
| API déployée sur Render | ✅ `https://viens-chop-api.onrender.com` |
| Base Neon reliée | ✅ 243 ms |
| 6 tables + 7 triggers | ✅ |
| Envoi de code SMS | ✅ (affiché dans les logs) |

---

## 👉 Ce qu'il te reste : créer ton premier compte — 3 minutes

### 1. Récupérer le code dans les logs Render

1. Va sur **https://dashboard.render.com**
2. Clique sur le service **viens-chop-api**
3. Menu de gauche → **Logs**
4. Cherche une ligne de cette forme :

```
📱 [SMS simulé] +2250701020304 : Viens chop : ton code est 482913. Il expire dans 5 min.
```

Les 6 chiffres sont ton code. ⚠️ Il expire en **5 minutes**.

> Si la ligne n'apparaît pas (le service était endormi), renvoie un code depuis
> l'outil de test à l'étape suivante : elle réapparaîtra immédiatement.

### 2. Ouvrir l'outil de test

1. Dans ton dépôt GitHub, ouvre **`outil-test.html`**
2. Bouton **Download raw file** (flèche vers le bas, en haut à droite)
3. **Double-clique** sur le fichier téléchargé : il s'ouvre dans ton navigateur

   ⚠️ Il doit être ouvert comme un fichier local, pas dans l'aperçu Arena
   (cadre isolé, sans accès réseau).

### 3. Créer le compte

1. **Adresse de l'API** : `https://viens-chop-api.onrender.com`
2. Numéro : `0701020304` → **Envoyer le code** (ou attends et utilise le code
   déjà dans les logs)
3. Reporte les 6 chiffres → **Valider**
4. Clique sur **Voir mon profil**

Attendu :

```json
{ "ok": true, "user": { "pseudo": "membreXXXX", "likes_left": 3, "plan": "coupe" } }
```

**Tu viens de créer un compte dans une vraie base PostgreSQL, via une vraie API
déployée.** C'est la fin de la phase backend.

### 4. Vérifier que la ligne existe

Retourne sur `/api/health/db` : le champ `"comptes"` doit maintenant afficher
`1` au lieu de `0`.

---

## Ce qu'on fait juste après

| Ordre | Chantier | Prérequis |
|---|---|---|
| **1** | Brancher `inscription.html` sur l'API (l'écran d'inscription du site devient réel) | rien |
| **2** | Brancher `app.html` : fil de découverte, likes, chat | rien |
| **3** | Stockage des photos | compte Cloudflare (gratuit) |
| **4** | Vrais SMS (Termii ou Twilio) | compte + budget par SMS |
| **5** | Paiement Wave / Orange Money | compte marchand |

Dis-moi simplement « c'est fait, le profil s'affiche » et j'enchaîne sur le
point 1.

---

## Si un problème survient

| Symptôme | Cause probable | Correction |
|---|---|---|
| « Trop de demandes de code » | 5 codes max/heure/numéro | attends, ou change de numéro de test |
| Le code est refusé | il a expiré (5 min) | renvoie-en un |
| « Authentification requise » | le jeton n'a pas été gardé | refais Valider, sans recharger la page |
| Le service met 50 s à répondre | offre gratuite Render endormie | normal, le service se réveille |
