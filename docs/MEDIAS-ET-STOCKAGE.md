# Photos, vidéos et vue unique — et la question des 500 Mo

> 29 octobre 2026

## 1. D'abord, une correction utile

Les 500 Mo dont tu parles, ce ne sont pas du stockage. Le service web gratuit
de Render, c'est **512 Mo de RAM** et **aucun disque persistant** : tout ce que
l'application écrit sur son disque est effacé à chaque redéploiement ou mise en
veille. Autrement dit, **on ne peut pas y stocker des photos, même en payant peu** —
il faudrait un disque payant, et il serait perdu à chaque redémarrage.

> Règle retenue : **aucun média ne passe par Render.** Jamais.

## 2. Ce qui est en place aujourd'hui

| Élément | État |
|---|---|
| Photos de profil (jusqu'à 3) | ✅ fonctionne, sans serveur |
| Compression automatique | ✅ 58 Ko → **21 Ko**, max 1280 px, WebP |
| Photo de profil affichée dans le fil | ✅ réellement, pas un dégradé |
| Profils réels de l'appareil visibles entre comptes | ✅ |
| Photo / vidéo **en vue unique** dans le chat | ✅ |
| Suppression réelle après visionnage | ✅ vérifié : l'octet disparaît du stockage |
| Vidéo limitée | ✅ 15 s / 6 Mo |
| Quota par appareil | ✅ 60 Mo, nettoyage automatique des plus anciens |
| Vérifications | **22/22** + régression **39/39** |

### Comment la vue unique marche

1. On choisit une photo ou une vidéo, le message apparaît sous la forme
   « 👁️ Photo en vue unique — Appuie pour ouvrir · une seule fois ».
2. À l'ouverture : plein écran, **compte à rebours de 8 s**, fermeture possible
   avec la croix ou Échap.
3. À la fermeture, le fichier est **effacé du stockage** (`markViewed`), le
   message devient « Vue · média supprimé ».
4. Filet de sécurité : tout média non ouvert expire au bout de 24 h.

## 3. Où vivent les fichiers (et pourquoi ça ne coûte rien)

**Aujourd'hui : sur l'appareil**, dans une base IndexedDB (`vc_media_v1`).
- 60 Mo de budget par téléphone, avec une barre de remplissage dans « Mon profil ».
- Une photo pesant ~120 Ko, cela fait **environ 500 photos** par appareil.
- Le stockage de l'appareil n'a **aucun rapport** avec Render.

**Demain : Cloudflare R2**, sans rien changer à l'interface.
- **10 Go gratuits**, trafic sortant **gratuit** (c'est le gros avantage face à S3).
- Au-delà : 0,015 $/Go/mois, soit **1,50 $ pour 100 Go**.
- Il suffit d'ajouter les clés et de brancher `VCMedia.setUploader(...)` :
  le reste du code est déjà écrit pour basculer.

## 4. La vraie solution pour les vidéos lourdes

Une vidéo de 15 s pèse facilement 5 à 20 Mo. Même sur R2, 10 Go se remplissent
vite. Trois leviers, appliqués ensemble :

| Levier | Effet |
|---|---|
| **Vue unique + suppression immédiate** | le fichier vit quelques secondes, pas des mois |
| **Limites serrées** (15 s, 6 Mo) | plafonne le coût par envoi |
| **Compression à l'envoi** | ~120 Ko par photo au lieu de 2 Mo |

À 120 Ko par média, **10 Go de R2 = plus de 80 000 photos**. En vidéo à 6 Mo,
c'est ~1 700 vidéos **en même temps** — mais comme elles sont supprimées après
visionnage, la capacité réelle est bien plus grande.

## 5. Ce qu'il te restera à faire (plus tard, 10 minutes)

1. Créer un compte Cloudflare → **R2** → créer un bucket `viens-chop-media`.
2. Générer une clé API (Access Key + Secret).
3. Me donner ces 3 valeurs : **compte**, **clé**, **secret** ; je branche.

Rien à faire avant : tout ce qui précède fonctionne déjà sans ça.

## 6. Limite à connaître

En mode actuel (sans serveur), les photos restent **sur l'appareil** : une
personne inscrite sur un autre téléphone ne voit pas les photos des autres.
C'est la même limite que pour les comptes — elle disparaît avec le branchement
serveur + R2, qui est la prochaine étape naturelle.
