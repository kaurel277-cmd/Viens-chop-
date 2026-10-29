# Profils réels + photos : c'est en ligne

> 29 octobre 2026 — vérifié contre la production, pas en local

## Ce qui fonctionne maintenant, pour de vrai

| Fonction | Preuve |
|---|---|
| Inscription numéro + mot de passe | compte créé dans Neon ✅ |
| Photo de profil stockée en base | relue depuis la production ✅ |
| Un autre inscrit voit le profil **et sa photo** | ✅ |
| Reconnexion sur un autre téléphone | nom **et** photos retrouvés ✅ |
| Entrée automatique dans l'app | ✅ |
| Repli si le serveur ne répond pas | le site continue en local ✅ |

Vérifications : **13/13 en production**, 14/14 serveur local, 31/31 hors
ligne, 22/22 médias, 39/39 régression.

## Où sont les photos

Dans **Neon**, table `photos`. Pas sur Render : son disque est effacé à chaque
déploiement. Une photo pèse 20–90 Ko après compression dans le navigateur, et
3 photos maximum par personne.

## Le choix « hors ligne »

Ajoute `?offline=1` à l'adresse pour forcer l'enregistrement sur l'appareil
(utile pour une démo sans réseau). `?offline=0` remet le serveur.

## Les deux bugs trouvés et corrigés pendant les tests

1. **Photos invisibles** : `helmet` envoyait `Cross-Origin-Resource-Policy:
   same-origin`, le navigateur bloquait l'image entre le site et l'API.
   Corrigé en `cross-origin`.
2. **App bloquée sur l'écran d'accueil** : l'entrée automatique se décidait
   avant que le serveur ait répondu. Elle se décide maintenant après.

## Réglages ajoutés côté serveur

| Variable Render | Défaut | Rôle |
|---|---|---|
| `REGISTER_RATE_LIMIT_MAX` | 40 | inscriptions par heure et par IP |
| `LOGIN_RATE_LIMIT_MAX` | 40 | connexions par 15 min et par IP |

Les connexions **réussies** ne sont plus comptées : seules les erreurs
comptent, contre les essais en boucle.

## Limites connues

- 3 photos maximum, 110 Ko chacune (choix assumé pour économiser Neon).
- Neon gratuit ≈ 0,5 Go, soit environ 5 000 photos.
- Les médias « vue unique » du chat ne sont jamais envoyés au serveur : ils
  restent sur l'appareil et disparaissent après lecture.
- Un profil sans genre renseigné n'apparaît pas dans le fil.
