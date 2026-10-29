# Viens-chop-
Viens chop est la première application de rencontre et de flirt 100 % pour la jeunesse ivoirienne (18-30 ans). Pensée pour pallier la cherté des applications internationales (Tinder, Bumble) et l'insécurité des rencontres en ligne, elle propose une expérience locale, amusante et ultra-sécurisée.

## Structure

```
*.html              Site vitrine + aperçu de l'app (statique)
assets/             CSS compilé, images, icônes
database/           neon-schema.sql (tables + règles) et test-schema.sql
server/             API Node : comptes, feed, likes, chat, sécurité
docs/BACKEND.md     Architecture Neon, endpoints, déploiement
ROADMAP.md          Où en est le projet et ce qu'il reste à faire
```

## Démarrage rapide

**Pas à pas, sans ligne de commande : [docs/GUIDE-DEMARRAGE.md](docs/GUIDE-DEMARRAGE.md)**
Détail du déploiement Render, écran par écran : [docs/RENDER-PAS-A-PAS.md](docs/RENDER-PAS-A-PAS.md)

```bash
# Site statique
python3 -m http.server 8080

# API (nécessite un projet Neon, voir docs/BACKEND.md)
cd server && cp .env.example .env && npm install && npm run dev
```

## Prochaines étapes

Voir [ROADMAP.md](ROADMAP.md).
