# Payer le Mode Debout — comment ça marche

Mis à jour le 31/10/2026.

Le paiement est **réel** : ce n'est plus un bouton qui affiche « Paiement
confirmé » sans rien encaisser. Il fonctionne aujourd'hui **sans compte
marchand**, en deux temps : la personne paie sur ton numéro Wave, puis tu
valides dans la console.

Avec ton **Wave Business**, le même circuit peut se faire tout seul (section 4).
Le code est en place et attend seulement ses deux clés.

---

## 1. Ce que voit la personne qui paie

1. Elle utilise ses 3 likes gratuits du jour.
2. Une fenêtre s'ouvre : **« Passe en Mode Debout »**, avec le prix (700 FCFA),
   la durée (30 jours) et le **numéro Wave** que tu as renseigné.
3. Elle envoie 700 FCFA par Wave à ce numéro (bouton **Copier le numéro**).
4. Elle colle **l'identifiant de la transaction** reçu dans son message Wave,
   puis appuie sur **« J'ai payé — envoyer la preuve »**.
5. La fenêtre affiche **« ⏳ Demande en attente »**. Dans **Mon profil →
   Mon abonnement**, la même mention apparaît.
6. Quand tu valides, son compte passe en **Mode Debout** : le compteur de likes
   affiche **∞**, et la carte du profil indique **« Mode Debout actif »** avec la
   date de fin. Elle n'a rien à faire de plus : l'application le voit toute
   seule au prochain affichage.

Le montant n'est **jamais** envoyé par le navigateur : c'est le serveur qui
applique le prix réglé. Impossible de payer 1 FCFA pour un mois.

---

## 2. Ce que tu fais, écran par écran

### A. Activer le paiement (une seule fois)

1. Ouvre **Neon** → ton projet → **SQL Editor**.
2. Colle le contenu de `database/MIGRATION-PAIEMENTS.sql` → **Run**.
3. La dernière requête doit répondre `t | t | t`.

### B. Renseigner le numéro qui reçoit l'argent

1. Va sur `https://kaurel277-cmd.github.io/Viens-chop-/admin.html`.
2. Entre ton **ADMIN_TOKEN** → **Entrer**.
3. Onglet **Réglages**.
4. Remplis :
   - **Numéro Wave qui reçoit les paiements** : `07 XX XX XX XX` (10 chiffres) ;
   - **Nom affiché** : le nom que verront les payeurs (« au nom de … ») ;
   - **Prix** : `700` ;
   - **Durée** : `30` ;
   - **Paiement ouvert** : `Oui`.
5. **Enregistrer**. La ligne du bas doit afficher
   « ouvert — la fenêtre affiche 700 FCFA au 07 XX XX XX XX ».
6. Dans l'application, ouvre n'importe quel profil → la fenêtre Mode Debout
   affiche maintenant ton numéro.

Tant que le numéro est vide, la fenêtre dit « le paiement ouvre très bientôt »
— aucune erreur, personne ne peut envoyer d'argent au mauvais endroit.

### C. Valider un paiement

1. La personne t'envoie sa preuve depuis l'application.
2. Sur **admin.html**, onglet **Paiements** : la demande apparaît avec le
   pseudo, le téléphone, **l'identifiant** et le montant.
3. Vérifie dans **ton application Wave** que la transaction existe bien, du bon
   montant, venant de ce numéro.
4. **Valider (30 jours)** → le compte passe Debout immédiatement.
   Si le paiement est introuvable : **Refuser** et écris le motif — la personne
   le verra dans son profil.

Le compteur **« paiements à valider »** en haut de la console te dit combien de
demandes attendent.

---

## 3. Ce que la base fait toute seule

- Un paiement passé en `paid` déclenche `app.activate_plan_on_payment()` :
  `users.plan = 'debout'` et `plan_expires_at = aujourd'hui + 30 jours`.
- Un **renouvellement s'ajoute** à la date de fin existante : payer deux fois
  donne 60 jours, jamais moins.
- Une **référence Wave ne peut servir qu'une fois** (contrainte d'unicité).
- **Une seule demande en attente par personne** : pas d'empilement de preuves.
- 6 déclarations maximum par quart d'heure et par adresse IP.

---

## 4. Le paiement automatique (Wave Business) — quand tu voudras

Le circuit automatique est **écrit, testé et en veille**. Tant que les trois
valeurs ci-dessous ne sont pas posées sur Render, l'écran affiche simplement le
numéro Wave et la validation reste manuelle. Rien ne casse, rien ne change.

Dès qu'elles sont posées, la fenêtre affiche **« 🐧 Payer avec Wave »** : la
personne paie dans l'application Wave, revient sur le site, et son Mode Debout
s'active **tout seul**. Tu n'as plus rien à valider (l'onglet Paiements sert
alors d'historique).

### A. Prendre les deux valeurs dans Wave Business

1. Ouvre **business.wave.com** → ton compte marchand.
2. **Développeurs** (ou **API**) → **Créer une clé API**.
3. Copie la clé : elle commence par `wave_sn_…` et **ne s'affiche qu'une fois**.
   Si tu as coché « signature de requête », copie aussi le secret `wave_sn_AKS_…`.
4. Ouvre l'onglet **Webhooks** → **Ajouter un webhook**.
5. URL à déclarer : `https://viens-chop-api.onrender.com/api/paiement/webhook/wave`
6. Événements à cocher : `checkout.session.completed` et
   `checkout.session.payment_failed`.
7. Copie le **secret de signature** : `wave_sn_WHS_…`

### B. Poser les valeurs sur Render

1. Ouvre **dashboard.render.com** → ton service `viens-chop-api`.
2. Onglet **Environment** → **Add Environment Variable**, trois fois :

| Key | Value |
|---|---|
| `WAVE_API_KEY` | la clé `wave_sn_…` |
| `WAVE_WEBHOOK_SECRET` | le secret `wave_sn_WHS_…` |
| `SITE_URL` | `https://kaurel277-cmd.github.io/Viens-chop-` |

3. (Seulement si tu as coché la signature de requête) une quatrième :
   `WAVE_SIGNING_SECRET` = le secret `wave_sn_AKS_…`.
4. **Save Changes** → Render redéploie seul (2 minutes).

### C. Vérifier

`https://viens-chop-api.onrender.com/api/health` doit afficher deux voyants de
plus : **`paiement-auto`** et **`paiement-webhook`**.
`/api/paiement/offre` répond alors `"auto": true`.

### D. Faire un vrai test à 100 FCFA

1. **admin.html → Réglages** → **Prix** = `100` → **Enregistrer**.
2. Sur ton téléphone : **Mon profil → Mon abonnement → Payer avec Wave**,
   paie réellement 100 FCFA (tu récupères l'argent : c'est ton compte).
3. Tu dois revenir sur le site et voir **« 👑 Bienvenue en Mode Debout »**,
   sans avoir touché à la console.
4. **Réglages** → remets **Prix** = `700` → **Enregistrer**.

### Ce qui reste vrai dans les deux cas

- Le montant vient **toujours** du serveur, jamais du navigateur.
- Un webhook avec une signature inventée est refusé (401).
- Un webhook rejoué ne rajoute pas 30 jours : la durée ne s'ajoute qu'une fois.
- Le webhook **relit la session chez Wave** avant d'activer quoi que ce soit :
  même un appel parfaitement signé ne suffit pas.
- Si Render est endormi et manque le webhook, la personne est activée à son
  retour sur le site (`/api/paiement/verifier` redemande l'état à Wave).

---

## 5. Les voyants

`GET /api/health` :

| Repère | Ce qu'il prouve |
|---|---|
| `paiement` | la migration « paiements » est passée (tables `payments` + `reglages`) |
| `paiement-auto` | `WAVE_API_KEY` est posé : la fenêtre propose « Payer avec Wave » |
| `paiement-webhook` | `WAVE_WEBHOOK_SECRET` est posé : Wave peut confirmer tout seul |

`GET /api/paiement/offre` (public) répond `disponible: true` dès que le
paiement est ouvert **et** qu'il y a un moyen de payer : la clé Wave, ou le
numéro à créditer. Sans l'un des deux, les pages disent « bientôt » plutôt que
d'inviter à payer dans le vide.
