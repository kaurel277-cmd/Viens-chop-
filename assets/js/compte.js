/* ==========================================================================
   VIENS CHOP — comptes

   Deux modes, choisis automatiquement au démarrage :

   SERVEUR (dès que l'API répond)
     Le compte vit dans Neon : il suit la personne d'un téléphone à l'autre,
     et les profils sont réellement visibles entre inscrits.
     L'API est https://viens-chop-api.onrender.com (voir assets/js/api.js).

   LOCAL (l'API ne répond pas : hors ligne, aperçu intégré, réseau coupé)
     Le compte est enregistré sur l'appareil avec une empreinte PBKDF2.
     Le site continue de fonctionner, sans partage entre appareils.

   L'interface est identique dans les deux cas :
     await VCCompte.create({ phone, password, birth, invitation })
     await VCCompte.login(phone, password)
     VCCompte.current() / isLoggedIn() / logout() / update(patch)
     VCCompte.photos.add(file) / remove(id)
   ========================================================================== */
window.VCCompte = (function () {
    'use strict';

    const KEY_ACCOUNTS = 'vc_comptes_v1';
    const KEY_SESSION = 'vc_session_v1';
    const KEY_PROFIL = 'vc_profil_v1';
    const KEY_OFFLINE = 'vc_offline';
    const ITERATIONS = 120000;
    const MIN_PASSWORD = 6;

    let API_BASE = '';          // renseigné par configure()
    let mode = 'local';         // 'local' | 'api'

    /* ------------------------------------------------------------------ */
    /* Stockage tolérant aux pannes (navigation privée, quota saturé…)     */
    /* ------------------------------------------------------------------ */
    const memory = {};
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return memory[k] || null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memory[k] = v; } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { delete memory[k]; } },
        persistant() {
            try { localStorage.setItem('vc_test', '1'); localStorage.removeItem('vc_test'); return true; }
            catch (e) { return false; }
        }
    };

    /* ------------------------------------------------------------------ */
    /* Outils                                                             */
    /* ------------------------------------------------------------------ */
    function normalizePhone(raw) {
        let d = String(raw || '').replace(/\D/g, '');
        if (d.startsWith('225') && d.length > 10) d = d.slice(3);
        return d.slice(0, 10);
    }
    const isValidPhone = raw => /^0[1-9]\d{8}$/.test(normalizePhone(raw));
    const formatPhone = raw => normalizePhone(raw).replace(/(\d{2})(?=\d)/g, '$1 ');

    const OPERATORS = {
        '07': { name: 'Orange CI', color: '#FF7900' },
        '05': { name: 'MTN CI', color: '#FFCC00' },
        '01': { name: 'Moov Africa', color: '#009CDE' }
    };
    const operatorOf = raw => OPERATORS[normalizePhone(raw).slice(0, 2)] || null;

    function ageFrom(birth) {
        if (!birth) return null;
        const p = String(birth).split('-').map(Number);
        if (p.length !== 3 || p.some(isNaN)) return null;
        const [y, m, d] = p;
        const test = new Date(y, m - 1, d);
        if (test.getFullYear() !== y || test.getMonth() !== m - 1 || test.getDate() !== d) return null;
        const t = new Date();
        let age = t.getFullYear() - y;
        if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age--;
        return age;
    }

    const lastBirthDate = () => {
        const t = new Date();
        return new Date(t.getFullYear() - 18, t.getMonth(), t.getDate());
    };
    const toISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    const hex = buf => Array.prototype.map.call(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    function randomHex(bytes) {
        const a = new Uint8Array(bytes);
        (window.crypto || window.msCrypto).getRandomValues(a);
        return hex(a);
    }

    async function derive(password, saltHex) {
        const enc = new TextEncoder();
        const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
        if (window.crypto && window.crypto.subtle) {
            const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
            return hex(bits);
        }
        let h1 = 0x811c9dc5, h2 = 0x1000193;
        const s = saltHex + '|' + password;
        for (let i = 0; i < s.length; i++) {
            h1 = (h1 ^ s.charCodeAt(i)) * 16777619 >>> 0;
            h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0;
        }
        return 'faible-' + h1.toString(16) + h2.toString(16);
    }

    function fail(code, message) {
        const e = new Error(message || code);
        e.code = code;
        throw e;
    }

    /* ------------------------------------------------------------------ */
    /* Mode LOCAL                                                         */
    /* ------------------------------------------------------------------ */
    const readAll = () => { try { return JSON.parse(store.get(KEY_ACCOUNTS) || '[]') || []; } catch (e) { return []; } };
    const writeAll = list => store.set(KEY_ACCOUNTS, JSON.stringify(list));

    function publicView(a) {
        if (!a) return null;
        const copy = Object.assign({}, a);
        delete copy.salt; delete copy.hash; delete copy.iterations;
        return copy;
    }
    const find = phone => {
        const p = normalizePhone(phone);
        return readAll().find(a => a.phone === p) || null;
    };

    async function createLocal({ phone, password, birth, invitation }) {
        const p = normalizePhone(phone);
        if (!isValidPhone(p)) fail('TELEPHONE_INVALIDE', 'Numéro invalide.');
        if (!password || String(password).length < MIN_PASSWORD) fail('MOT_DE_PASSE_COURT', 'Mot de passe trop court.');

        const age = ageFrom(birth);
        if (age === null) fail('DATE_INVALIDE', 'Date de naissance invalide.');
        if (age < 18) fail('MINEUR_INTERDIT', 'Inscription réservée aux 18 ans et plus.');

        const list = readAll();
        if (list.some(a => a.phone === p)) fail('TELEPHONE_DEJA_UTILISE', 'Ce numéro a déjà un compte.');

        const salt = randomHex(16);
        const account = {
            id: 'u_' + Date.now().toString(36) + randomHex(3),
            phone: p, salt, hash: await derive(String(password), salt), iterations: ITERATIONS,
            birth, age, name: '', gender: '', seeking: '', commune: '', artists: [], photos: [],
            invitation: String(invitation || '').trim().toUpperCase().slice(0, 12),
            plan: 'coude', likes_left: 3, verified: false,
            mode: 'local',
            createdAt: new Date().toISOString()
        };
        list.push(account);
        writeAll(list);
        store.set(KEY_SESSION, account.id);
        return publicView(account);
    }

    async function loginLocal(phone, password) {
        const a = find(phone);
        if (!a) fail('COMPTE_INTROUVABLE', 'Aucun compte avec ce numéro.');
        const attempt = await derive(String(password || ''), a.salt);
        if (attempt !== a.hash) fail('MOT_DE_PASSE_INCORRECT', 'Mot de passe incorrect.');
        store.set(KEY_SESSION, a.id);
        return publicView(a);
    }

    /* ------------------------------------------------------------------ */
    /* Mode SERVEUR                                                       */
    /* ------------------------------------------------------------------ */
    function cacheProfil(user) {
        store.set(KEY_PROFIL, JSON.stringify(user));
    }
    function profilEnCache() {
        try { return JSON.parse(store.get(KEY_PROFIL) || 'null'); } catch (e) { return null; }
    }

    function versProfil(u, extra) {
        const photoUrls = (u.photos || []).map(p => (typeof p === 'string' ? p : p.url));
        return {
            id: u.id,
            phone: normalizePhone(u.phone || ''),
            name: u.pseudo && !/^membre\d+$/i.test(u.pseudo) ? u.pseudo : '',
            pseudo: u.pseudo,
            birth: u.birth_date || '',
            age: u.age || null,
            gender: u.gender || '',
            seeking: u.seeking || '',
            commune: u.commune && u.commune !== 'Abidjan' ? u.commune : '',
            artists: u.artists || [],
            photos: photoUrls,
            plan: u.plan || 'coude',
            likes_left: 3,
            mode: 'api',
            ...(extra || {})
        };
    }

    async function createServeur({ phone, password, birth }) {
        const res = await window.VCAPI.auth.register(normalizePhone(phone), password, birth);
        const profil = versProfil(res.user);
        cacheProfil(profil);
        return profil;
    }

    async function loginServeur(phone, password) {
        const res = await window.VCAPI.auth.login(normalizePhone(phone), password);

        // Le profil complet est rechargé dans la foulée : sans ça, on
        // retrouverait son compte sur un autre téléphone sans ses photos.
        let complet = res.user;
        try {
            const me = await window.VCAPI.auth.me();
            if (me && me.user) complet = me.user;
        } catch (e) { /* on garde ce qu'on a */ }

        let photos = [];
        try {
            const liste = await window.VCAPI.photos.list();
            photos = (liste.photos || []).map(ph => ph.url);
        } catch (e) { /* pas bloquant */ }

        const profil = versProfil(Object.assign({}, complet, { photos }));
        cacheProfil(profil);
        return profil;
    }

    /* ------------------------------------------------------------------ */
    /* Détection du mode                                                  */
    /* ------------------------------------------------------------------ */
    async function detecter() {
        if (!API_BASE || !window.VCAPI) return 'local';
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3500);
            const r = await fetch(API_BASE + '/api/health', { signal: ctrl.signal });
            clearTimeout(t);
            if (!r.ok) return 'local';

            // On n'active le serveur que s'il annonce savoir gérer les comptes
            // par mot de passe. Sinon, inutile de provoquer une erreur 404.
            const info = await r.json().catch(() => ({}));
            const capacites = Array.isArray(info.features) ? info.features : [];
            return capacites.includes('password-auth') ? 'api' : 'local';
        } catch (e) {
            return 'local';
        }
    }

    /* ------------------------------------------------------------------ */
    /* API publique                                                       */
    /* ------------------------------------------------------------------ */
    /* `?offline=1` force l'enregistrement sur l'appareil (utile pour tester
       sans réseau, ou pour faire une démo sans serveur). Le choix est retenu
       pour les pages suivantes ; `?offline=0` le désactive. */
    function lireVœuHorsLigne() {
        try {
            const p = new URLSearchParams(location.search).get('offline');
            if (p === '1') store.set(KEY_OFFLINE, '1');
            if (p === '0') store.del(KEY_OFFLINE);
            return store.get(KEY_OFFLINE) === '1';
        } catch (e) {
            return store.get(KEY_OFFLINE) === '1';
        }
    }

    async function configure({ api }) {
        API_BASE = api || '';
        if (lireVœuHorsLigne()) { mode = 'local'; return mode; }
        if (API_BASE && window.VCAPI) {
            window.VCAPI.configure(API_BASE);
            mode = await detecter();
        }
        return mode;
    }

    /* Si le serveur répond mais ne connaît pas encore les nouvelles routes
       (déploiement en cours, migration non faite), on bascule en local au
       lieu d'afficher une erreur incompréhensible. */
    const CODES_SERVEUR_ABSENT = ['ROUTE_INCONNUE', 'ERREUR_SERVEUR', 'API_NON_CONFIGUREE', 'RESEAU', 'NETWORK', 'ERREUR_RESEAU'];

    async function create(payload) {
        if (mode === 'api') {
            try {
                return await createServeur(payload);
            } catch (err) {
                if (err && CODES_SERVEUR_ABSENT.includes(err.code)) {
                    mode = 'local';
                    return createLocal(payload);
                }
                throw err;
            }
        }
        return createLocal(payload);
    }

    async function login(phone, password) {
        if (mode === 'api') {
            try {
                return await loginServeur(phone, password);
            } catch (err) {
                if (err && CODES_SERVEUR_ABSENT.includes(err.code)) {
                    mode = 'local';
                    return loginLocal(phone, password);
                }
                throw err;
            }
        }
        return loginLocal(phone, password);
    }

    function current() {
        if (mode === 'api') {
            const p = profilEnCache();
            if (p && window.VCAPI && window.VCAPI.isLoggedIn()) return p;
            return null;
        }
        const id = store.get(KEY_SESSION);
        if (!id) return null;
        return publicView(readAll().find(a => a.id === id) || null);
    }

    function all() {
        if (mode === 'api') {
            const p = profilEnCache();
            return p ? [p] : [];
        }
        return readAll().map(publicView);
    }

    const isLoggedIn = () => !!current();

    function logout() {
        if (mode === 'api') {
            store.del(KEY_PROFIL);
            if (window.VCAPI) window.VCAPI.auth.logout().catch(() => {});
            return;
        }
        store.del(KEY_SESSION);
    }

    async function update(patch) {
        if (mode === 'api') {
            const envoi = {};
            if (patch.name !== undefined) envoi.pseudo = patch.name;
            if (patch.birth !== undefined) envoi.birth_date = patch.birth;
            if (patch.commune !== undefined) envoi.commune = patch.commune;
            if (patch.gender !== undefined) envoi.gender = patch.gender;
            if (patch.artists !== undefined) envoi.artists = patch.artists;
            if (Object.keys(envoi).length) {
                await window.VCAPI.users.updateProfile(envoi);
                const p = profilEnCache() || {};
                cacheProfil(Object.assign({}, p, patch));
            }
            return profilEnCache();
        }

        const id = store.get(KEY_SESSION);
        if (!id) return null;
        const list = readAll();
        const i = list.findIndex(a => a.id === id);
        if (i === -1) return null;
        ['name', 'gender', 'seeking', 'commune', 'artists', 'verified', 'photos']
            .forEach(k => { if (patch && k in patch) list[i][k] = patch[k]; });
        writeAll(list);
        return publicView(list[i]);
    }

    function remove(phone) {
        const p = normalizePhone(phone);
        writeAll(readAll().filter(a => a.phone !== p));
        logout();
    }

    async function changePassword(oldPassword, newPassword) {
        if (mode === 'api') fail('NON_DISPONIBLE', 'Le changement de mot de passe se fera depuis le serveur.');
        const id = store.get(KEY_SESSION);
        const list = readAll();
        const a = list.find(x => x.id === id);
        if (!a) fail('NON_CONNECTE', 'Aucun compte connecté.');
        if (await derive(String(oldPassword || ''), a.salt) !== a.hash) fail('MOT_DE_PASSE_INCORRECT', 'Ancien mot de passe incorrect.');
        if (!newPassword || String(newPassword).length < MIN_PASSWORD) fail('MOT_DE_PASSE_COURT', 'Mot de passe trop court.');
        a.salt = randomHex(16);
        a.hash = await derive(String(newPassword), a.salt);
        writeAll(list);
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* Photos                                                             */
    /* ------------------------------------------------------------------ */
    const photos = {
        async list() {
            if (mode === 'api') {
                const res = await window.VCAPI.photos.list();
                return res.photos || [];
            }
            return (current() && current().photos) || [];
        },

        /** file = File/Blob déjà compressé ; position 0..2 */
        async add(blob, position) {
            if (mode === 'api') {
                const res = await window.VCAPI.photos.upload(blob, position || 0);
                const p = profilEnCache() || {};
                const liste = (p.photos || []).slice();
                liste[position || 0] = res.photo.url;
                cacheProfil(Object.assign({}, p, { photos: liste.filter(Boolean) }));
                return res.photo;
            }
            fail('MODE_LOCAL', 'Les photos locales sont gérées par assets/js/media.js.');
        },

        async remove(id) {
            if (mode === 'api') {
                await window.VCAPI.photos.remove(id);
                const p = profilEnCache() || {};
                cacheProfil(Object.assign({}, p, {
                    photos: (p.photos || []).filter(u => !String(u).includes(id))
                }));
                return true;
            }
            return false;
        }
    };

    return {
        MIN_PASSWORD,
        configure,
        get mode() { return mode; },
        normalizePhone, isValidPhone, formatPhone, operatorOf,
        ageFrom, lastBirthDate, toISO,
        create, login, logout, current, all, isLoggedIn, update, remove, changePassword, photos,
        exists: phone => !!find(phone),
        find: phone => publicView(find(phone)),
        storagePersistant: store.persistant
    };
})();
