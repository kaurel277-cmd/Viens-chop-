# Signaler et bloquer — comment ça marche

> Écrit le 29/10/2026. Tout est **branché sur la vraie API** (`server/src/routes/safety.js`)
> et testé : `audit/test-securite.js` → 31 vérifications, 0 échec.

Un app de rencontre sans bouton de secours se vide ou se fait fermer. Il y a
maintenant deux gestes possibles partout où une personne apparaît :
**signaler** (discret, anonyme) et **bloquer** (immédiat, réversible).

---

## 1. Où se trouve le bouton

| Endroit | Comment y accéder |
|---|---|
| Sur un profil du fil | les **trois points ⋯** en haut à droite de la carte |
| Dans une discussion | les **trois points ⋯** en haut à droite, à côté du combiné |
| Pour revenir sur un blocage | **Mon profil → Profils bloqués → Débloquer** |

---

## 2. Signaler — écran par écran

1. Dans **Découvrir**, touche le **⋯** en haut à droite de la carte.
   → une feuille s'ouvre en bas, avec le prénom de la personne et deux choix.
2. Touche **Signaler ce profil**.
   → la fenêtre « Signaler Awa » s'ouvre, avec six motifs :

   | Motif | Ce que ça couvre |
   |---|---|
   | 🙈 Faux profil ou usurpation | photos volées, identité inventée |
   | 😠 Harcèlement ou insultes | messages insistants, menaces |
   | 🔞 Photos ou propos déplacés | nudité, contenu sexuel non demandé |
   | 💸 Arnaque, demande d'argent | faux profils qui réclament de l'argent |
   | 🚸 Personne mineure | moins de 18 ans |
   | ❓ Autre chose | tout le reste |

3. Touche un motif : il s'entoure en orange et le bouton **Envoyer le
   signalement** s'active.
4. Si tu veux, écris une précision dans **Détails (facultatif)** (500 caractères
   maximum).
5. Touche **Envoyer le signalement**.
   → bandeau vert en haut : « Signalement envoyé. Merci, on le vérifie sous 24 h. »

La personne signalée **ne reçoit rien** et ne sait pas qui l'a signalée : le
signalement est enregistré côté serveur avec ton identifiant, jamais affiché.

---

## 3. Bloquer — écran par écran

1. Touche le **⋯** (sur la carte du fil ou dans la discussion).
2. Touche **Bloquer ce profil**.
   → la fenêtre « Bloquer Awa ? » explique ce qui va se passer.
3. Touche **Oui, bloquer**.
   → bandeau rouge : « Awa est bloqué(e). Tu ne le verras plus. »

À partir de là, immédiatement :

- la personne **disparaît du fil** de découverte ;
- la discussion **disparaît des Discussions** ;
- si elle essaie d'écrire, le serveur répond `403 CONVERSATION_BLOQUEE` ;
- elle **ne voit plus** ton profil dans son propre fil (le blocage vaut dans les
  deux sens, c'est ce que fait la requête du fil).

### Débloquer

1. **Mon profil** (touche ton avatar en haut à gauche du fil).
2. Section **Profils bloqués** → la ligne de la personne, avec **Débloquer**.
3. Touche **Débloquer**.
   → bandeau vert « Profil débloqué. », la ligne disparaît, la personne revient
   dans le fil **et** la discussion revient dans la liste.

---

## 4. Ce que le serveur enregistre

| Table | Contenu |
|---|---|
| `public.reports` | `reporter_id`, `target_id`, `reason`, `details`, `status` (`open` par défaut), `created_at` |
| `public.blocks` | `blocker_id`, `blocked_id`, `created_at` — clé primaire sur la paire, `no_self_block` |

Routes concernées :

| Méthode | Route | Effet |
|---|---|---|
| `POST` | `/api/safety/report` | crée un signalement (201) |
| `POST` | `/api/safety/block` | bloque (201), idempotent |
| `GET` | `/api/safety/blocks` | liste mes profils bloqués |
| `DELETE` | `/api/safety/block/:id` | débloque |

---

## 5. Voir les signalements reçus (toi, le propriétaire)

Aujourd'hui il n'y a pas encore d'écran d'administration : les signalements
s'accumulent dans la base avec `status = 'open'`. Pour les lire :

```sql
select r.created_at,
       r.reason,
       r.details,
       r.status,
       a.pseudo as signale_par,
       t.pseudo as personne_signalee
  from public.reports r
  join public.users a on a.id = r.reporter_id
  join public.users t on t.id = r.target_id
 order by r.created_at desc
 limit 50;
```

Un signalement traité se marque à la main :

```sql
update public.reports
   set status = 'closed', resolved_at = now()
 where id = '<identifiant du signalement>';
```

---

## 6. Ce qui reste à faire (étape 3 de la roadmap)

- Un **écran d'administration** pour traiter les signalements sans passer par SQL.
- La **vérification selfie réelle** (le badge « Vérifié » est encore décoratif).
- Un **filtre automatique** sur les photos envoyées.

---

## 7. Vérifier soi-même

```bash
cd audit && node test-securite.js
```

31 vérifications : ouverture du menu, les 6 motifs, l'envoi réellement écrit en
base, le profil qui quitte le fil, la discussion qui disparaît, la liste
« Profils bloqués », le déblocage, et le comportement en mode démo (aucune
erreur JavaScript).
