# Build du CSS Tailwind

`assets/css/tailwind.css` est **compilé à l'avance** : inutile de relancer quoi que ce soit
pour le développement normal.

À relancer uniquement si tu ajoutes de nouvelles classes Tailwind dans le HTML :

```bash
npm install -D tailwindcss@3
npx tailwindcss -c build/tailwind.config.js -i build/input.css -o assets/css/tailwind.css --minify
```
