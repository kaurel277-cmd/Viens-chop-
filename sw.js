/* ---------------------------------------------------------------------------
   Viens chop — service worker.

   Objectif : l'application s'ouvre même quand le réseau est mauvais (ce qui
   arrive souvent), et elle s'installe sur l'écran d'accueil.

   Règles simples et volontairement prudentes :
     - les pages HTML et le code (JS, CSS) : réseau d'abord, copie de secours
       quand on est hors ligne. Le code doit suivre les pages : servir un
       ancien script avec une page neuve casse l'application ;
     - les images et les polices : copie locale d'abord (elles ne changent pas) ;
     - l'API : jamais de copie. Un like, un message ou un match ne doit
       JAMAIS être servi depuis un cache : on veut la vérité, ou une erreur.
   --------------------------------------------------------------------------- */

const VERSION = 'vienschop-v11';
const COQUILLE = [
  './',
  './index.html',
  './app.html',
  './inscription.html',
  './mot-de-passe-oublie.html',
  './comment-ca-marche.html',
  './securite.html',
  './tarifs.html',
  './maquis.html',
  './promoteur.html',
  './arrivee.html',
  './faq.html',
  './mentions-legales.html',
  './assets/css/common.css',
  './assets/css/tailwind.css',
  './assets/css/icons.css',
  './assets/js/api.js',
  './assets/js/compte.js',
  './assets/js/media.js',
  './assets/js/social.js',
  './assets/img/logo.svg',
  './assets/img/icon-192.png',
  './assets/img/og-card.jpg',
  './manifest.webmanifest',
  './hors-ligne.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll échoue en bloc si un seul fichier manque : on ajoute un par un.
    await Promise.all(COQUILLE.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jamais de cache pour l'API, même si elle est sur le même domaine.
  if (url.pathname.startsWith('/api/')) return;

  // Uniquement notre propre origine : les polices et icônes viennent de CDN.
  if (url.origin !== self.location.origin) return;

  const chemin = url.pathname;
  const estCode = /\.(?:js|css)$/i.test(chemin);
  const estPage = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (estPage || estCode) {
    e.respondWith((async () => {
      try {
        // no-store : sans ça, le cache HTTP du navigateur peut resservir une
        // page vieille de dix minutes alors que le site vient d'être mis à
        // jour. Une page fraîche coûte quelques kilo-octets.
        const frais = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(VERSION);
        cache.put(req, frais.clone());
        return frais;
      } catch (err) {
        const cache = await caches.open(VERSION);
        const garde = await cache.match(req);
        if (garde) return garde;
        if (estCode) return new Response('', { status: 504 });
        const secours = await cache.match('./hors-ligne.html');
        if (secours) return secours;
        return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const garde = await cache.match(req);
    if (garde) {
      // Rafraîchit en arrière-plan pour la prochaine visite.
      fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
      return garde;
    }
    try {
      const frais = await fetch(req);
      if (frais && frais.ok) cache.put(req, frais.clone());
      return frais;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
