# Une seule action, puis on avance

> État au 28 octobre 2026, 11 h 45 (Abidjan)

---

## Ce que j'ai fait pendant ce temps

Le site n'est plus une démonstration : **la page d'inscription crée de vrais
comptes dans ta base Neon.**

| Vérification | Résultat |
|---|---|
| Parcours complet dans un vrai navigateur, contre PostgreSQL | ✅ 12/12 |
| Compte réellement créé (`Testeur`, 26 ans) | ✅ |
| Âge recalculé par le serveur, pas par le navigateur | ✅ |
| `seeking` déduit côté serveur | ✅ `F` |
| Likes gratuits à 3 | ✅ |
| Message d'erreur clair sur un mauvais code | ✅ « Ce code n'est pas le bon. » |
| Régression du site (9 pages, mode démo) | ✅ 42/42 |
| Appel du site vers ton API Render (CORS) | ✅ 200, aucune erreur |

Deux bugs réels ont été trouvés et corrigés au passage :

- après un code refusé, les cases restaient remplies et le formulaire
  relançait la vérification tout seul, brûlant les 5 essais autorisés ;
- le message d'erreur s'affichait puis disparaissait aussitôt.

---

## 👉 La seule chose qu'il te reste : 1 champ sur Render

Aujourd'hui, sans opérateur SMS, le code n'existe que dans les logs — c'est
pénible, et tu as raison de ne pas vouloir passer par là.

J'ai ajouté un **mode bêta** : un code fixe, sans SMS, sans logs.

1. Va sur **https://dashboard.render.com** → service **viens-chop-api**
2. Menu de gauche → **Environment**
3. **Add Environment Variable** :
   - Key : `BETA_OTP`
   - Value : `123456` (ou les 6 chiffres que tu veux)
4. **Save Changes** → Render redéploie seul en 2 minutes

Ensuite, sur le site, **le code sera toujours celui que tu as choisi**. Plus de
logs, plus d'attente, plus de code qui expire.

> ⚠️ **À retirer avant l'ouverture au public.** Tant que `BETA_OTP` est défini,
> n'importe qui connaissant cette valeur peut entrer. Supprime la variable dès
> que tu branches un vrai fournisseur SMS.

---

## Comment tester, si tu veux

Le formulaire d'inscription du site est branché sur ton API.
Ouvre `inscription.html`, mets un numéro, puis le code `BETA_OTP`.

À la fin, la page affiche « Bienvenue, *ton pseudo* » et le compte existe
réellement. Tu peux le vérifier de mon côté via `/api/health/db` : le champ
`comptes` augmente.

---

## Une limite à connaître sur l'aperçu Arena

L'aperçu intégré affiche le site dans un cadre isolé **sans accès réseau**.
Sur cet aperçu, l'inscription affichera « Impossible de joindre le serveur ».
C'est normal et attendu : le site réel (GitHub Pages, ou le fichier ouvert
directement dans ton navigateur) fonctionne, lui.

---

## Ce que je fais ensuite

| Ordre | Chantier | État |
|---|---|---|
| 1 | Inscription branchée sur l'API | ✅ **fait** |
| 2 | `app.html` branché : fil de découverte, likes, matchs, chat | ⏳ à faire |
| 3 | Stockage des photos (Cloudflare R2) | ⏳ |
| 4 | Vrais SMS (Termii ou Twilio) | ⏳ |
| 5 | Paiement Wave / Orange Money | ⏳ |

Dis-moi « c'est fait » et j'attaque le point 2 sans te déranger.
