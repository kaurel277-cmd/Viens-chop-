# Une seule chose à faire : passer la migration « paiements »

> 30 octobre 2026

## Où on en est

Les trois premières étapes sont faites : sécurité (vue unique, selfie,
modération), mot de passe oublié, et `ADMIN_TOKEN` sur Render. Le serveur le
confirme :

```
GET /api/health
→ {"ok":true,"features":["password-auth","photos","recuperation","chat-media",
   "verifications","moderation","admin"]}
```

Il reste **une** chose pour que le Mode Debout puisse être payé : la migration
des paiements.

## Écran par écran

1. Ouvre **https://console.neon.tech** et connecte-toi.
2. Clique sur ton projet **Viens chop**, puis sur **SQL Editor** (menu de
   gauche).
3. Ouvre le fichier `database/MIGRATION-PAIEMENTS.sql` du dépôt, **sélectionne
   tout** et copie.
4. Colle dans la zone de Neon.
5. Clique sur **Run** (ou `Ctrl` + `Entrée`).

### Ce que tu dois voir ensuite

Un tableau de contrôle à trois colonnes :

```
 reglages | colonne_note | declencheur
----------+--------------+-------------
 t        | t            | t
```

Les trois `t` = c'est passé.

### Comment vérifier que c'est bon

Ouvre dans un navigateur :

```
https://viens-chop-api.onrender.com/api/health
```

`features` doit contenir **`paiement`** (en plus des 7 autres).

## Ce que cette migration fait

- crée la table **`public.reglages`** : prix, durée, numéro Wave, nom affiché,
  interrupteur « paiement ouvert », avec des valeurs par défaut ;
- ajoute deux colonnes à **`public.payments`** : `note` (motif de refus) et
  `decided_at` (date de décision) ;
- autorise le statut **`rejected`** (demande refusée) ;
- interdit **plus d'une demande en attente** par personne ;
- met à jour le déclencheur **`app.activate_plan_on_payment()`** : un paiement
  passé en `paid` active 30 jours (durée réglable), et un renouvellement
  s'ajoute à la date de fin au lieu de la remplacer.

Elle ne supprime aucune donnée et peut être relancée sans risque.

## Après la migration

1. Ouvre `https://kaurel277-cmd.github.io/Viens-chop-/admin.html`.
2. Entre ton **ADMIN_TOKEN**, puis va dans l'onglet **Réglages**.
3. Saisis le **numéro Wave** qui doit recevoir les 700 FCFA, ton nom, et vérifie
   que « Paiement ouvert » est sur **Oui**.
4. **Enregistrer**.

La procédure complète du paiement est dans `PAIEMENT.md`.
