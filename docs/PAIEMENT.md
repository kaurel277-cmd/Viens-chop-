# Payer le Mode Debout — comment ça marche

Mis à jour le 30/10/2026.

Le paiement est **réel** : ce n'est plus un bouton qui affiche « Paiement
confirmé » sans rien encaisser. Il fonctionne aujourd'hui **sans compte
marchand**, en deux temps : la personne paie sur ton numéro Wave, puis tu
valides dans la console.

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

## 4. Le jour où tu auras un compte marchand

Rien à refaire côté base : le circuit automatique utilise **la même table**.

1. Ouvre un compte Wave Business (ou CinetPay).
2. Sur Render → *Environment* → ajoute `PAIEMENT_WEBHOOK_SECRET` (une longue
   chaîne aléatoire).
3. Donne au fournisseur l'adresse à appeler :
   `https://viens-chop-api.onrender.com/api/paiement/webhook/wave`.
4. Il doit envoyer, en `POST` JSON :

   ```json
   { "reference": "TX1234567890", "montant": 700, "statut": "paid" }
   ```

   avec l'en-tête `x-signature` =
   `HMAC-SHA256("reference|montant|statut", PAIEMENT_WEBHOOK_SECRET)` en hexadécimal.

Dès que la variable est posée, `/api/health` affiche `paiement-auto` et les
paiements se valident sans toi. Le circuit manuel continue de fonctionner.

---

## 5. Les voyants

`GET /api/health` :

| Repère | Ce qu'il prouve |
|---|---|
| `paiement` | la migration « paiements » est passée (tables `payments` + `reglages`) |
| `paiement-auto` | `PAIEMENT_WEBHOOK_SECRET` est posé |

`GET /api/paiement/offre` (public) répond `disponible: true` quand le numéro
Wave est renseigné **et** que l'interrupteur est sur « ouvert ».
