/* ==========================================================================
   VIENS CHOP — comptes enregistrés sur l'appareil (version bêta, sans serveur)

   But : permettre de s'inscrire et de se connecter sans API, sans SMS et sans
   réseau. Le numéro est l'identifiant, le mot de passe protège l'accès.

   Le mot de passe n'est JAMAIS stocké en clair : on garde un sel aléatoire et
   une empreinte PBKDF2-SHA256 (120 000 tours). C'est correct pour un appareil
   personnel, mais ce n'est PAS de la sécurité de niveau serveur : n'importe qui
   ayant la main sur le navigateur peut lire le stockage local. Le passage au
   serveur (SMS + comptes en base) reste prévu pour la version publique.

   Utilisation :
     await VCCompte.create({ phone, password, birth, invitation })
     await VCCompte.login(phone, password)
     VCCompte.current()      -> compte connecté ou null
     VCCompte.logout()
     VCCompte.update({ name: 'Awa' })
   ========================================================================== */
window.VCCompte = (function () {
    'use strict';

    const KEY_ACCOUNTS = 'vc_comptes_v1';
    const KEY_SESSION = 'vc_session_v1';
    const ITERATIONS = 120000;
    const MIN_PASSWORD = 6;

    /* ------------------------------------------------------------------ */
    /* Stockage : localStorage quand il existe, sinon mémoire de session   */
    /* (navigation privée, file:// verrouillé, quota saturé…)             */
    /* ------------------------------------------------------------------ */
    const memory = {};
    const store = {
        get(k) {
            try { return localStorage.getItem(k); } catch (e) { return memory[k] || null; }
        },
        set(k, v) {
            try { localStorage.setItem(k, v); } catch (e) { memory[k] = v; }
        },
        del(k) {
            try { localStorage.removeItem(k); } catch (e) { delete memory[k]; }
        },
        persistant() {
            try {
                localStorage.setItem('vc_test', '1');
                localStorage.removeItem('vc_test');
                return true;
            } catch (e) { return false; }
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

    function isValidPhone(raw) {
        return /^0[1-9]\d{8}$/.test(normalizePhone(raw));
    }

    function formatPhone(raw) {
        return normalizePhone(raw).replace(/(\d{2})(?=\d)/g, '$1 ');
    }

    const OPERATORS = {
        '07': { name: 'Orange CI', color: '#FF7900' },
        '05': { name: 'MTN CI', color: '#FFCC00' },
        '01': { name: 'Moov Africa', color: '#009CDE' }
    };

    function operatorOf(raw) {
        return OPERATORS[normalizePhone(raw).slice(0, 2)] || null;
    }

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

    function lastBirthDate() {
        const t = new Date();
        return new Date(t.getFullYear() - 18, t.getMonth(), t.getDate());
    }

    function toISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function hex(buf) {
        return Array.prototype.map.call(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }

    function randomHex(bytes) {
        const a = new Uint8Array(bytes);
        (window.crypto || window.msCrypto).getRandomValues(a);
        return hex(a);
    }

    /* PBKDF2-SHA256. Si le navigateur refuse WebCrypto (contexte non sécurisé),
       on retombe sur une empreinte simple : moins solide, mais le mot de passe
       n'est toujours pas écrit en clair. */
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
    /* Lecture / écriture                                                  */
    /* ------------------------------------------------------------------ */
    function readAll() {
        try { return JSON.parse(store.get(KEY_ACCOUNTS) || '[]') || []; } catch (e) { return []; }
    }

    function writeAll(list) {
        store.set(KEY_ACCOUNTS, JSON.stringify(list));
    }

    function publicView(a) {
        if (!a) return null;
        const copy = Object.assign({}, a);
        delete copy.salt;
        delete copy.hash;
        delete copy.iterations;
        return copy;
    }

    function find(phone) {
        const p = normalizePhone(phone);
        return readAll().find(a => a.phone === p) || null;
    }

    /* ------------------------------------------------------------------ */
    /* API publique                                                        */
    /* ------------------------------------------------------------------ */
    async function create({ phone, password, birth, invitation }) {
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
            phone: p,
            salt,
            hash: await derive(String(password), salt),
            iterations: ITERATIONS,
            birth,
            age,
            name: '',
            gender: '',
            seeking: '',
            commune: '',
            artists: [],
            invitation: String(invitation || '').trim().toUpperCase().slice(0, 12),
            plan: 'coude',
            likes_left: 3,
            verified: false,
            createdAt: new Date().toISOString()
        };
        list.push(account);
        writeAll(list);
        store.set(KEY_SESSION, account.id);
        return publicView(account);
    }

    async function login(phone, password) {
        const a = find(phone);
        if (!a) fail('COMPTE_INTROUVABLE', 'Aucun compte avec ce numéro.');
        const attempt = await derive(String(password || ''), a.salt);
        if (attempt !== a.hash) fail('MOT_DE_PASSE_INCORRECT', 'Mot de passe incorrect.');
        store.set(KEY_SESSION, a.id);
        return publicView(a);
    }

    function current() {
        const id = store.get(KEY_SESSION);
        if (!id) return null;
        return publicView(readAll().find(a => a.id === id) || null);
    }

    function isLoggedIn() {
        return !!current();
    }

    function logout() {
        store.del(KEY_SESSION);
    }

    function update(patch) {
        const id = store.get(KEY_SESSION);
        if (!id) return null;
        const list = readAll();
        const i = list.findIndex(a => a.id === id);
        if (i === -1) return null;
        const allowed = ['name', 'gender', 'seeking', 'commune', 'artists', 'verified'];
        allowed.forEach(k => { if (patch && k in patch) list[i][k] = patch[k]; });
        writeAll(list);
        return publicView(list[i]);
    }

    function remove(phone) {
        const p = normalizePhone(phone);
        writeAll(readAll().filter(a => a.phone !== p));
        logout();
    }

    async function changePassword(oldPassword, newPassword) {
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

    return {
        MIN_PASSWORD,
        normalizePhone, isValidPhone, formatPhone, operatorOf,
        ageFrom, lastBirthDate, toISO,
        create, login, logout, current, isLoggedIn, update, remove, changePassword,
        exists: phone => !!find(phone),
        find: phone => publicView(find(phone)),
        storagePersistant: store.persistant
    };
})();
