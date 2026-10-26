# Viens chop — Mise en conformité cahier des charges v2.0

**Date** : 26 octobre 2026 · **Base** : `main` (après l'audit de correction)

Ce document liste **uniquement les ajouts** demandés par le cahier des charges.
Tout ce qui existait et fonctionnait n'a pas été retouché (41 tests de non-régression toujours verts).

---

## 1. Image d'arrière-plan

| Fichier | Usage | Poids |
|---|---|---|
| `assets/img/bg-hero.jpg` | bandeaux héro + appels à l'action (desktop ≥ 768 px) | 58 Ko |
| `assets/img/bg-hero-sm.jpg` | même image en 900 px pour mobile | 21 Ko |
| `assets/img/bg-chat.jpg` / `.webp` | fond du fil de discussion (motif wax sombre type WhatsApp) | 48 / 22 Ko |

**Traitement** : l'image est posée sous le dégradé de marque avec un voile sombre à 26 %.
Résultat mesuré : contraste des textes blancs **3,50:1** contre 3,00:1 avant (meilleur qu'à l'origine),
et la texture reste visible. Le PNG d'origine (1,5 Mo) a été converti : **−89 % de poids**.

---

## 2. Paradigme WhatsApp (CDC §1)

- **Palette appliquée** : fond `#0B141A`, panneaux `#111B21` / `#202C33`, bulles envoyées `#005C4B`,
  bulles reçues `#202C33`, accents `#FF6B00` conservés.
- **Barre d'onglets basse** renommée `Découvrir · Discussions · Mode Flirt · Soutra`.
- **Bulles de chat** aux couleurs WhatsApp, avec heure et coches de lecture.

## 3. Onglet Discussions (CDC §3.B) — *nouveau*

- Liste de conversations triée par récence, avatar, **point vert « En ligne »**, aperçu du dernier message.
- **Coches de lecture** `✓` / `✓✓` bleues, **compteur de messages non lus**.
- Horodatage façon WhatsApp : `20:21` aujourd'hui, `Hier`, `Ven.`, puis `jj/mm`.
- Ouverture d'une conversation → fil complet avec fond texturé, statut du contact en en-tête.
- Les conversations sont **persistées** (`localStorage`) : elles survivent au rechargement.

## 4. Grille Freemium / VIP (CDC §4) — *corrigée*

| Fonctionnalité | Avant | Maintenant (conforme CDC) |
|---|---|---|
| Likes / jour | 10 pour tous | 10 en gratuit, **illimités en VIP** ✅ |
| **Faux Appel** | bloqué à 100 % en gratuit | **1 essai / semaine** en gratuit, **illimité 24/7** en VIP ✅ |
| **Qui m'a aimé** | inexistant | **photos floutées** en gratuit, **en clair** en VIP ✅ |

Le quota est réel : après un essai, le prochain est bloqué 7 jours et le message indique
le temps restant (« Prochain essai gratuit dans 7 jours »). L'état survit au rechargement.

## 5. Certification IA du profil (CDC §2) — *nouveau*

Parcours voix + selfie avec **barre de progression** et 4 étapes affichées
(*Analyse de la note vocale → Comparaison avec le selfie → Détection de visage → Attribution du badge*).
Durée : **3,75 s**, sous la limite de 5 s imposée par le CDC.

## 6. Détection opérateur +225 (CDC §2) — *nouveau*

Saisie du numéro → badge d'opérateur affiché en temps réel :

| Préfixe | Opérateur |
|---|---|
| 07 | Orange CI |
| 05 | MTN CI |
| 01 | Moov Africa |

Présent sur `inscription.html` **et** dans `app.html`.

## 7. Calcul automatique de la majorité (CDC §2) — *corrigé*

L'âge saisi à la main (`<input type="number">`, contournable) est remplacé par une
**date de naissance** :
- bornes du sélecteur calculées dynamiquement (max = aujourd'hui − 18 ans) ;
- message immédiat : `⛔ 16 ans : réservé aux +18 ans` ou `✅ 23 ans — âge validé automatiquement` ;
- blocage effectif de la création du compte ;
- **triple sécurité** : client → contrainte SQL `adult_only` → trigger `reject_minor()`.

## 8. Base de données Supabase / PostgreSQL (CDC §5) — *nouveau*

`database/schema.sql` (prêt à exécuter dans Supabase → SQL Editor) :

- `users` avec `age` et `is_adult` **colonnes générées** exactement comme au CDC ;
- `likes`, `matches`, `messages` (texte / vocal / quiz / système), `quiz_sessions`, `payments` ;
- **8 triggers métier** : majorité, création automatique du match sur like réciproque,
  **quota 10 likes/jour**, **quota faux appel 7 jours**, `updated_at` ;
- **RLS activée** sur les 6 tables + vue `who_liked_me` qui **ne renvoie l'URL de la photo
  que si l'appelant est VIP** (le floutage n'est donc pas qu'une illusion côté client).

---

## 9. Fluidité — ce qui a été fait et ce que ça donne

### Levier principal : sortie du CDN Tailwind
Le CDN chargeait **~120 Ko de JavaScript** et compilait le CSS **à chaque visite**.

Remplacé par une feuille compilée à l'avance : `assets/css/tailwind.css` → **31 Ko** (≈ 7 Ko gzip).
Fichiers de build conservés dans `build/` (`tailwind.config.js`, `input.css`, `build.sh`).

### Mesure réelle (Chromium, réseau bridé à 400 kbps / 300 ms de latence, 3 passes, médiane)

| | Avant | Après | Gain |
|---|---|---|---|
| **Premier affichage (FCP)** | 4 440 ms | **2 924 ms** | **−34 %** |
| **DOM prêt (DCL)** | 4 436 ms | **2 919 ms** | **−34 %** |

### Autres optimisations
- **Google Fonts et Font Awesome non bloquants** (`media="print"` + `onload`) :
  le texte s'affiche sans attendre les CDN.
- **`preload` de l'image de fond** avec `imagesrcset` : l'image du héro est déjà téléchargée
  au moment du premier rendu (améliore le LCP).
- **Dégradé de secours** : si l'image n'arrive pas, le bandeau reste orange (aucun trou visuel).
- `scroll-padding-top` : les liens d'ancre ne passent plus **sous** la barre fixe.
- `-webkit-tap-highlight-color: transparent` : plus de rectangle bleu au tap sur mobile.
- `prefers-reduced-motion` : les animations se coupent pour qui le demande.
- Feuille d'impression : le site s'imprime proprement.

---

## Ce qui reste à brancher (hors périmètre front)

| # | Point | Où |
|---|---|---|
| 1 | Passer `DEMO_MODE: false` et brancher l'API SMS / OTP | `inscription.html` |
| 2 | Exécuter `database/schema.sql` puis connecter l'app à Supabase | Supabase |
| 3 | Renseigner les numéros WhatsApp Business | `faq.html`, `maquis.html` |
| 4 | Compléter les mentions légales (`[Ton Nom ou Société]`, hébergeur, téléphone) | `mentions-legales.html` |
| 5 | La certification IA est **simulée** (progression + badge) : à relier au vrai service de vérification | `app.html` |

---

## Fichiers ajoutés / modifiés

**Ajoutés**
```
assets/img/bg-hero.jpg, bg-hero-sm.jpg, bg-chat.jpg, bg-chat.webp
assets/css/tailwind.css        (compilé, 31 Ko)
assets/css/common.css          (fond, thème WhatsApp, fluidité, impression)
database/schema.sql            (schéma Supabase complet)
build/tailwind.config.js, input.css, build.sh
```

**Modifiés**
```
app.html               écran Discussions, Qui m'a aimé, quota faux appel,
                       certification IA, détection opérateur, date de naissance,
                       thème WhatsApp, badge « en ligne », coches de lecture
inscription.html       détection opérateur, communes complètes (73)
index, tarifs, faq,    image de fond, CSS local, chargement non bloquant
maquis, securite,
comment-ca-marche,
mentions-legales
```

---

## Vérifications

| Contrôle | Résultat |
|---|---|
| Tests de non-régression | **41 / 41 ✅** |
| Nouveaux tests cahier des charges | **12 / 12 ✅** |
| Erreurs de validation HTML | **0** |
| Erreurs JavaScript | **0** |
| Débordement horizontal (mobile 390 px) | **0 px** sur les 4 écrans de l'app |
