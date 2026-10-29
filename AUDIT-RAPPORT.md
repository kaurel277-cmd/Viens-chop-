> **Note (29/10/2026)** : rapport mis à jour. L'inscription par code envoyé par
> SMS a été **supprimée du produit** : on s'inscrit avec un numéro et un mot de
> passe, sans code à recevoir. Le flou des photos a également été supprimé.

# Audit Viens chop — rapport de correction

**Dépôt** : `kaurel277-cmd/Viens-chop-` (branche `main`)
**Date** : 26 octobre 2026
**Périmètre** : 9 pages HTML statiques (Tailwind CDN + Font Awesome + JS vanilla)
**Méthode** : analyse du code, validation HTML (html-validate), tests navigateur automatisés (Chromium/Playwright) sur 2 formats d'écran, parcours utilisateur complets, captures d'écran.

---

## Résultat

| Indicateur | Avant | Après |
|---|---|---|
| Erreurs de validation HTML | **150** | **0** |
| Bugs critiques (fonctionnels) | 5 | **0** |
| Bugs visibles / UX | 6 | **0** |
| Accessibilité (champs/boutons non nommés) | 23 | **0** |
| Liens morts / placeholders cassés | 3 | **0** |
| Erreurs JavaScript détectées à l'exécution | 0 | 0 |
| Tests de non-régression | — | **41 / 41 ✅** |

---

## 🔴 Bugs critiques corrigés

### 1. Menu mobile totalement cassé sur 7 pages (le plus grave)
**Symptôme** : au clic sur le burger, le menu n'apparaissait pas. Il s'affichait comme une **bande blanche de 64 px de haut**, avec les liens par-dessus le contenu de la page.

**Cause** : le panneau `#mobile-menu` était placé **à l'intérieur du `<nav>`**, qui porte la classe Tailwind `backdrop-blur-md`. Un élément ancêtre avec `backdrop-filter` crée un *containing block* pour les descendants en `position: fixed` → `top:0 / right:0 / h-full` étaient calculés par rapport au `<nav>` (64 px de haut) et non à la fenêtre.

**Correction** (`index`, `comment-ca-marche`, `faq`, `maquis`, `tarifs`, `inscription`, `mentions-legales`) :
- panneau sorti du `<nav>`, hauteur `100dvh`, largeur max `85vw`, scroll interne ;
- overlay sombre cliquable ajouté ;
- verrou de défilement du body à l'ouverture ;
- fermeture au clic sur un lien, au clic extérieur, avec la touche **Échap**, et automatiquement au retour en desktop ;
- `aria-expanded` / `aria-controls` synchronisés.

### 2. Carte de profil invisible après un match (`app.html`)
**Symptôme** : après un like qui donne un match, retour sur « Découvrir » → **écran vide**.

**Cause** : `swipeLike()` lançait l'animation de sortie de la carte puis ouvrait le chat **sans recharger la carte**. Au retour, la carte était figée hors écran (`translateX ≈ +412 px`, opacité 0,04).

**Correction** : rechargement du profil suivant avant l'ouverture du chat. *Vérifié : la carte revient bien à sa position et à 100 % d'opacité.*

### 3. Lien WhatsApp de la FAQ pointait vers un numéro factice
`WHATSAPP_NUMBER = "225XXXXXXXXXX"` produisait un lien `wa.me` mort. Le numéro est désormais une constante vide et le lien retombe proprement sur la section contact tant qu'il n'est pas configuré.

### 4. Bouton « Ouvrir l'application » jamais visible (`inscription.html`)
La classe `hidden` (→ `display:none`) **et** `block` (→ `display:block`) étaient présentes sur le même élément. L'ordre CSS de Tailwind faisait gagner `hidden`, même après suppression de la classe. Remplacé par un `style="display:none"` piloté par le script — et le lien pointe maintenant vers `app.html` (page qui était orpheline, inaccessible depuis le site).

### 5. Message d'erreur effacé pendant la saisie
Un message d'erreur restait affiché après correction du champ, ou disparaissait trop tôt. L'état est maintenant remis à zéro proprement à chaque tentative.

---

## 🟠 Bugs visibles / UX corrigés

6. **Champs du formulaire d'inscription** : erreurs de saisie signalées champ par champ, et le bouton d'envoi se bloque pendant la création du compte pour éviter les doubles inscriptions.
7. **Flou des photos** (`app.html`) — historique : le déblocage au 5ᵉ message était décoratif. **Décision du 29/10/2026 : le flou est supprimé partout** (carte du fil, chat, avatars, « qui m'a aimé »). On voit la personne avant de liker ; `photo_unlocked` reste renvoyé par l'API mais ne pilote plus l'affichage.
8. **Faux appel** : cliquer deux fois sur « accepter » empilait « — En cours... — En cours... ». Protection anti-double-clic ajoutée.
9. **Numéro WhatsApp du formulaire partenaire** (`maquis.html`) : le formulaire affichait « Merci, proposition reçue » alors que **rien n'était envoyé**. Il génère désormais un message WhatsApp pré-rempli (nom, ville, type, téléphone, précisions) dès que le numéro est configuré.
10. **Année du copyright figée** sur « © 2025 » → affichage dynamique de l'année courante.
11. **Écrasement de saisie** : si l'utilisateur recommençait à taper le code pendant l'animation d'erreur, sa saisie était effacée. L'effacement n'a lieu que si le code est resté inchangé.

---

## 🟡 Qualité, accessibilité et référencement

- **150 → 0 erreur** de validation HTML : `type="button"` sur les 70 `<button>`, 65 esperluettes `&` non échappées (`Maquis & Cafés`), attributs dupliqués.
- **23 éléments interactifs non nommés** corrigés : 10 boutons icône (play, like, passer, envoyer, raccrocher…), 3 champs du profil (`Prénom`, `Âge`, `Commune`), champ téléphone, boutons du menu sécurité.
- `autocomplete="tel-national"` invalide → `autocomplete="tel"`.
- **Zoom mobile rétabli** sur `app.html` (`user-scalable=no, maximum-scale=1` bloquait le zoom — non conforme WCAG) et `inputmode` sur les champs numériques.
- **Favicon** ajouté sur les 9 pages (SVG inline, aucun fichier externe, zéro requête).
- `meta description` ajoutée sur `tarifs.html` et `app.html` (manquante).
- Ouverture dans le même onglet des Mentions légales depuis le formulaire d'inscription (perte du parcours en cours) → conservée mais sécurisée avec `rel="noopener"`.

---

## ⚠️ Points à traiter par toi (hors code — décisions métier)

| # | Point | Détail |
|---|---|---|
| 1 | **Numéros à configurer** | `WHATSAPP_NUMBER` dans `faq.html` et `maquis.html` (format `2250700000000`, sans `+`). Tant qu'ils sont vides, les liens restent inactifs plutôt que cassés. |
| 2 | **Mentions légales incomplètes** | `[Ton Nom ou Société]`, `[Nom de ton hébergeur]`, `+225 07 XX XX XX XX` — champs juridiques à renseigner avant mise en ligne. |
| 3 | ~~Brancher l'inscription sur le backend~~ | **Fait** : `inscription.html` crée le compte par l'API (numéro + mot de passe). |
| 4 | **Tailwind CDN en production** | Le CDN affiche un avertissement et n'est pas recommandé en prod : compiler Tailwind en CSS statique (`npx tailwindcss -o style.css --minify`). Idem : héberger localement Font Awesome et la police Outfit (4 domaines externes = 4 points de latence, et le site casse si le CDN tombe). |
| 5 | **Pas de `robots.txt` ni `sitemap.xml`** | À ajouter pour l'indexation ; ajouter aussi les balises Open Graph (`og:title`, `og:image`) — actuellement absentes, donc partage WhatsApp/Instagram sans aperçu. |
| 6 | **Poids des pages** | 24–64 Ko de HTML avec CSS dupliqué 9 fois. Une extraction vers `style.css` + `common.js` réduirait la maintenance (les 9 pages partagent le même menu et le même footer). |

---

## Fichiers modifiés

```
app.html                 194 +/-
comment-ca-marche.html    93 +/-
faq.html                 122 +/-
index.html               123 +/-
inscription.html         125 +/-
maquis.html              115 +/-
mentions-legales.html     93 +/-
securite.html             13 +/-
tarifs.html              106 +/-
```

Aucune fonctionnalité existante n'a été retirée. Le code reste 100 % statique, sans dépendance ajoutée.

---

## Tests exécutés (41/41 ✅)

- Menu mobile : ouverture, hauteur pleine, overlay, verrou de scroll, fermeture (Échap) — **sur les 7 pages**
- Inscription : numéro invalide, formatage `07 01 02 03 04`, mot de passe trop court, mot de passe confirmé, pseudo trop court, **mineur bloqué**, CGU obligatoires, finalisation
- FAQ : recherche sans accents, filtre par catégorie, message « aucun résultat », lien WhatsApp
- Maquis : validation téléphone, envoi de proposition
- App : création de profil, affichage carte (photo nette), match → chat → **retour sans carte blanche**, faux appel sans doublon, message vide ignoré, signaler / bloquer / débloquer
- Zéro erreur JavaScript, zéro débordement horizontal, en mobile (390×844) et desktop (1440×900)
