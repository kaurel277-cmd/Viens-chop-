# Likes, matchs et messages réels

> 29 octobre 2026 — branchés sur la base, règles appliquées côté serveur

## Ce qui est branché

| Écran | Avant | Maintenant |
|---|---|---|
| Liker un profil | hasard simulé à 40 % | vrai like enregistré en base |
| Deux likes réciproques | jamais détecté | **match créé automatiquement** |
| Compteur de likes | décrémenté dans le navigateur | **vrai quota de 3/jour, imposé par la base** |
| Discussions | conversations inventées | **vrais matchs, vrais messages** |
| Photo du profil | pas affichée sur la carte | **visible dès le fil : on voit qui on like** |
| Nouveaux arrivants | jamais visibles | fil rafraîchi en revenant sur « Découvrir » |
| Profil passé (swipe à gauche) | revenait après rechargement | **enregistré en base**, ne revient plus |
| « Qui m'a aimé » | grille de démonstration inventée | **vraie liste** servie par l'API |
| Photo dans « Qui m'a aimé » | floutée pour les comptes gratuits | **absente** en gratuit, **nette** en Mode Debout (jamais de flou) |

## Les règles vivent dans PostgreSQL, pas dans le navigateur

Un utilisateur qui bricole le code de la page ne peut pas contourner :

- `app.enforce_daily_like_quota` → 4ᵉ like refusé (`QUOTA_LIKES`)
- `app.maybe_create_match` → match seulement si les deux se likent
- `app.unlock_photos_after_five` → **hérité**, conservé en base pour compatibilité ;
  l'interface n'attend plus rien pour afficher la photo (décision du 29/10/2026)
- `app.check_message_sender` → impossible d'écrire dans un match des autres

## Comment ça se passe, concrètement

1. Kevin like Aïcha → rien ne s'ouvre, le compteur passe à 2/3.
2. Aïcha like Kevin → **le chat s'ouvre tout seul** des deux côtés.
3. Ils échangent. La photo reste visible du début à la fin : plus aucun flou,
   aucun bandeau à attendre, aucun palier de messages.

## Bugs trouvés et corrigés pendant les tests

1. **Messages en double** : le suivi comptait les messages au lieu de retenir
   leurs identifiants. Un message envoyé réapparaissait au tour suivant.
2. **Sous-titre cassé** : mon code remplaçait tout le texte de l'en-tête,
   ce qui détruisait `#msg-countdown` utilisé ensuite. Chaque message suivant
   échouait. Le sous-titre est maintenant reconstruit proprement.
3. **Fil jamais rafraîchi** : une personne qui s'inscrit après toi n'apparaissait
   jamais. Rechargé automatiquement après une minute.
4. **Erreurs illisibles** : quand le serveur répondait en texte brut (plafond
   de requêtes), l'interface affichait « problème de réseau ». Elle donne
   maintenant la vraie raison.

## Vérifications

| Test | Résultat |
|---|---|
| Likes, match, messages, déblocage, quota | **16/16** |
| Serveur (photos + comptes) | 14/14 |
| Appareil (hors ligne) | 31/31 |
| Médias et vue unique | 22/22 |
| Entrée dans l'app | 4/4 |
| Régression du site | 39/39 |

## Limite connue

La conversation se met à jour **toutes les 3 secondes** (interrogation).
C'est simple et suffisant pour la bêta ; le passage en temps réel (SSE)
viendra si le nombre d'utilisateurs le demande.
