/* ---------------------------------------------------------------------------
   Viens chop — installation sur l'écran d'accueil.

   Trois choses, et c'est tout :
     1. on déclare le service worker (ouverture hors ligne, mise en cache) ;
     2. sur Android, on attrape la proposition d'installation du navigateur et
        on l'affiche quand la personne touche « Installer » ;
     3. sur iPhone, l'installation n'est pas automatique : on explique les
        trois gestes (Partager → Sur l'écran d'accueil → Ajouter).
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    // ---------- 1. Service worker ----------
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* pas bloquant */ });
        });
    }

    // ---------- 2. Bouton Android / Chrome ----------
    var invite = null;
    var bouton = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        invite = e;
        if (bouton) bouton.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', function () {
        invite = null;
        if (bouton) bouton.classList.add('hidden');
        bandeau('✅ Application installée. Elle est sur ton écran d\'accueil.');
    });

    function bandeau(texte) {
        var d = document.createElement('div');
        d.setAttribute('role', 'status');
        d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;z-index:9999;padding:14px;border-radius:14px;' +
            'background:#16202a;color:#fff;font-size:14px;font-weight:600;text-align:center;' +
            'box-shadow:0 10px 30px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.12);';
        d.textContent = texte;
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, 4200);
    }

    function aideIOS() {
        var ancien = document.getElementById('pwa-aide');
        if (ancien) { ancien.remove(); return; }
        var d = document.createElement('div');
        d.id = 'pwa-aide';
        d.setAttribute('role', 'dialog');
        d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;' +
            'align-items:flex-end;justify-content:center;padding:0;';
        d.innerHTML =
            '<div style="background:#16202a;color:#fff;width:100%;max-width:460px;border-radius:20px 20px 0 0;' +
                'padding:22px 20px calc(22px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.12);">' +
                '<p style="font-size:17px;font-weight:800;margin-bottom:10px;">Installer sur iPhone</p>' +
                '<ol style="font-size:14px;line-height:1.9;color:rgba(255,255,255,.75);padding-left:18px;">' +
                    '<li>Touche le bouton <strong>Partager</strong> (le carré avec une flèche), en bas de Safari.</li>' +
                    '<li>Fais défiler et touche <strong>Sur l\'écran d\'accueil</strong>.</li>' +
                    '<li>Touche <strong>Ajouter</strong> en haut à droite.</li>' +
                '</ol>' +
                '<p style="font-size:12px;color:rgba(255,255,255,.45);margin-top:12px;">Sur Android : menu ⋮ du navigateur → « Installer l\'application ».</p>' +
                '<button type="button" id="pwa-fermer" style="width:100%;margin-top:16px;padding:14px;border-radius:14px;' +
                    'border:none;background:linear-gradient(135deg,#FF6B00,#FF1E56);color:#fff;font-size:15px;font-weight:800;">J\'ai compris</button>' +
            '</div>';
        document.body.appendChild(d);
        d.addEventListener('click', function (e) {
            if (e.target === d || e.target.id === 'pwa-fermer') d.remove();
        });
    }

    function brancher() {
        bouton = document.getElementById('btn-installer');
        var aide = document.getElementById('btn-installer-aide');
        if (aide) aide.addEventListener('click', aideIOS);

        // Sur iPhone / iPad, il n'y a pas de proposition automatique :
        // on montre directement « Comment faire ? ».
        var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        var dejaInstalle = window.matchMedia('(display-mode: standalone)').matches ||
                           navigator.standalone === true;
        if (dejaInstalle) {
            if (bouton) bouton.classList.add('hidden');
            if (aide) aide.classList.add('hidden');
            return;
        }

        if (bouton) {
            if (iOS) {
                bouton.classList.add('hidden');
            } else {
                bouton.addEventListener('click', async function () {
                    if (!invite) { aideIOS(); return; }
                    invite.prompt();
                    var choix = await invite.userChoice;
                    invite = null;
                    if (choix && choix.outcome === 'accepted') {
                        bandeau('✅ Installation lancée.');
                    }
                    bouton.classList.add('hidden');
                });
                // Sur certains navigateurs, la proposition arrive après le chargement.
                setTimeout(function () { if (invite) bouton.classList.remove('hidden'); }, 1200);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', brancher);
    } else {
        brancher();
    }
})();
