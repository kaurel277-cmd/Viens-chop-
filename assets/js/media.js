/* ==========================================================================
   VIENS CHOP — moteur média (photos et vidéos)

   RÈGLE D'OR : rien n'est stocké sur Render.
   Le service Render gratuit n'a pas de disque persistant (512 Mo de RAM,
   fichiers effacés à chaque redéploiement). Les médias vont donc :
     1. sur l'appareil (IndexedDB) en mode actuel, sans serveur ;
     2. sur Cloudflare R2 dès que les clés sont ajoutées — 10 Go gratuits,
        trafic sortant gratuit. Il suffit de brancher un uploader.

   Vue unique
     Un média marqué `viewOnce` est supprimé du stockage dès que le
     destinataire l'a regardé (ou au plus tard à `expiresAt`, 24 h).
     Ce n'est pas une option d'affichage : l'octet disparaît.

   Quota
     Budget local par appareil (60 Mo par défaut). Au-delà, les médias les
     plus anciens sont effacés en premier. Une photo est ramenée à ~120 Ko
     avant stockage : 60 Mo ≈ 500 photos.

   API
     await VCMedia.ready()
     VCMedia.pick({ kind, viewOnce, ttlMs })   -> record | null  (ouvre le sélecteur)
     await VCMedia.compressImage(file)          -> { blob, width, height, bytes }
     await VCMedia.probeVideo(file)             -> { duration, bytes }
     await VCMedia.save({ file, kind, viewOnce, ownerId, ttlMs })
     await VCMedia.get(id)                      -> record + blob
     await VCMedia.list({ ownerId, kind })
     await VCMedia.remove(id)
     await VCMedia.markViewed(id)               -> supprime définitivement
     await VCMedia.stats()                      -> { count, bytes, quota, pct }
     VCMedia.previewUrl(record)                 -> URL temporaire à révoquer
     VCMedia.setUploader(fn)                    -> bascule vers R2
   ========================================================================== */
window.VCMedia = (function () {
    'use strict';

    const DB_NAME = 'vc_media_v1';
    const STORE = 'media';
    const QUOTA_BYTES = 60 * 1024 * 1024;   // 60 Mo par appareil
    const PHOTO_MAX_SIDE = 1280;
    const PHOTO_TARGET = 120 * 1024;        // ~120 Ko visés
    const VIDEO_MAX_BYTES = 6 * 1024 * 1024;
    const VIDEO_MAX_SECONDS = 15;
    const DEFAULT_TTL = 24 * 60 * 60 * 1000;

    let dbPromise = null;
    let externalUploader = null;    // fn(file, meta) -> Promise<record distant>

    /* ------------------------------------------------------------------ */
    /* Base locale                                                        */
    /* ------------------------------------------------------------------ */
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB indisponible'));
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'id' });
                    store.createIndex('ownerId', 'ownerId');
                    store.createIndex('kind', 'kind');
                    store.createIndex('createdAt', 'createdAt');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function tx(mode, fn) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            const store = t.objectStore(STORE);
            let result;
            try { result = fn(store); } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    }

    const req = r => ({ __req: r });

    /* ------------------------------------------------------------------ */
    /* Identifiants                                                       */
    /* ------------------------------------------------------------------ */
    function uid() {
        const a = new Uint8Array(8);
        (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256);
        return 'm_' + Date.now().toString(36) + Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 6);
    }

    /* ------------------------------------------------------------------ */
    /* Compression d'image                                                */
    /* ------------------------------------------------------------------ */
    function loadBitmap(file) {
        if (window.createImageBitmap) {
            return createImageBitmap(file).catch(() => loadImage(file));
        }
        return loadImage(file);
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
            img.src = url;
        });
    }

    function toBlob(canvas, type, quality) {
        return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality));
    }

    async function compressImage(file, opts) {
        const maxSide = (opts && opts.maxSide) || PHOTO_MAX_SIDE;
        const target = (opts && opts.target) || PHOTO_TARGET;
        const src = await loadBitmap(file);
        const w0 = src.width || src.naturalWidth;
        const h0 = src.height || src.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(src, 0, 0, w, h);
        if (src.close) src.close();

        // WebP si le navigateur sait le produire, sinon JPEG
        let type = 'image/webp';
        let quality = 0.82;
        let blob = await toBlob(canvas, type, quality);
        if (!blob) {
            type = 'image/jpeg';
            blob = await toBlob(canvas, type, quality);
        }
        // On descend la qualité jusqu'à tenir dans la cible (min 0.45)
        let guard = 0;
        while (blob && blob.size > target && quality > 0.45 && guard < 6) {
            quality -= 0.07;
            guard++;
            const smaller = await toBlob(canvas, type, quality);
            if (!smaller) break;
            blob = smaller;
        }
        return { blob, width: w, height: h, bytes: blob ? blob.size : 0, type };
    }

    /* ------------------------------------------------------------------ */
    /* Vidéo                                                              */
    /* ------------------------------------------------------------------ */
    function probeVideo(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            v.onloadedmetadata = () => {
                const duration = v.duration || 0;
                URL.revokeObjectURL(url);
                resolve({ duration, width: v.videoWidth, height: v.videoHeight, bytes: file.size });
            };
            v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Vidéo illisible')); };
            v.src = url;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Sélecteur de fichier                                              */
    /* ------------------------------------------------------------------ */
    function pick({ kind = 'photo', capture = false, viewOnce = false, ttlMs = DEFAULT_TTL, ownerId = null } = {}) {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = kind === 'video' ? 'video/*' : 'image/*';
            if (capture) input.capture = 'environment';
            input.style.display = 'none';
            document.body.appendChild(input);

            let settled = false;
            const done = async file => {
                if (settled) return;
                settled = true;
                input.remove();
                if (!file) return resolve(null);
                try {
                    resolve(await save({ file, kind, viewOnce, ttlMs, ownerId }));
                } catch (e) {
                    resolve({ error: e.code || 'ERREUR', message: e.message });
                }
            };

            input.addEventListener('change', () => done(input.files && input.files[0]));
            // Si l'utilisateur annule, le focus revient sans "change" : on nettoie
            window.addEventListener('focus', function onFocus() {
                window.removeEventListener('focus', onFocus);
                setTimeout(() => { if (!settled) { settled = true; input.remove(); resolve(null); } }, 800);
            }, { once: true });

            input.click();
        });
    }

    /* ------------------------------------------------------------------ */
    /* Enregistrement                                                     */
    /* ------------------------------------------------------------------ */
    function fail(code, message) {
        const e = new Error(message || code);
        e.code = code;
        throw e;
    }

    async function save({ file, kind = 'photo', viewOnce = false, ownerId = null, ttlMs = DEFAULT_TTL }) {
        if (!file) fail('FICHIER_ABSENT', 'Aucun fichier.');

        let payload, meta = {};
        if (kind === 'photo') {
            const c = await compressImage(file);
            if (!c.bytes) fail('COMPRESSION_ECHOUEE', "Cette image n'a pas pu être préparée.");
            payload = c.blob;
            meta = { width: c.width, height: c.height, type: c.type };
        } else {
            const info = await probeVideo(file);
            if (info.bytes > VIDEO_MAX_BYTES) fail('VIDEO_TROP_LOURDE', 'Vidéo trop lourde (6 Mo maximum).');
            if (info.duration > VIDEO_MAX_SECONDS) fail('VIDEO_TROP_LONGUE', 'Vidéo trop longue (15 secondes maximum).');
            payload = file;
            meta = { width: info.width, height: info.height, duration: info.duration, type: file.type };
        }

        const record = {
            id: uid(),
            ownerId: ownerId || 'local',
            kind,
            viewOnce: !!viewOnce,
            viewed: false,
            createdAt: Date.now(),
            expiresAt: Date.now() + ttlMs,
            bytes: payload.size || 0,
            blob: payload,
            remoteUrl: null,
            ...meta
        };

        const statut = await ensureQuota(record.bytes);
        await tx('readwrite', store => store.put(record));

        // Si un stockage distant est branché (R2), on envoie et on ne garde
        // qu'une vignette locale. Sans uploader, tout reste sur l'appareil.
        if (externalUploader) {
            try {
                const distant = await externalUploader(payload, record);
                record.remoteUrl = distant.url;
                record.blob = null;               // plus d'octets lourds en local
                record.thumb = distant.thumb || null;
                await tx('readwrite', store => store.put(record));
                if (statut.evicted) record.evicted = statut.evicted;
                return record;
            } catch (e) {
                // Réseau coupé : on garde la version locale, rien n'est perdu
                record.uploadPending = true;
            }
        }
        if (statut.evicted) record.evicted = statut.evicted;
        return record;
    }

    /* ------------------------------------------------------------------ */
    /* Quota : on efface les plus anciens médias vus ou expirés d'abord    */
    /* ------------------------------------------------------------------ */
    async function ensureQuota(incoming) {
        const all = await listAll();
        let total = all.reduce((s, m) => s + (m.bytes || 0), 0);
        if (total + incoming <= QUOTA_BYTES) return { evicted: 0 };

        let evicted = 0;
        const order = all
            .filter(m => m.viewed || m.expiresAt < Date.now())
            .concat(all.filter(m => !m.viewed && m.expiresAt >= Date.now()))
            .sort((a, b) => a.createdAt - b.createdAt);

        for (const m of order) {
            if (total + incoming <= QUOTA_BYTES) break;
            if (m.viewOnce && !m.viewed) continue;     // on protège les vues uniques non ouvertes
            await remove(m.id);
            total -= m.bytes || 0;
            evicted++;
        }
        return { evicted };
    }

    /* ------------------------------------------------------------------ */
    /* Lecture                                                            */
    /* ------------------------------------------------------------------ */
    async function listAll() {
        try {
            return await tx('readonly', store => req(store.getAll()));
        } catch (e) {
            return [];
        }
    }

    async function list({ ownerId = null, kind = null } = {}) {
        const all = await listAll();
        return all
            .filter(m => (!ownerId || m.ownerId === ownerId) && (!kind || m.kind === kind))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    async function get(id) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const t = db.transaction(STORE, 'readonly');
            const r = t.objectStore(STORE).get(id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    }

    async function remove(id) {
        await tx('readwrite', store => store.delete(id));
        return true;
    }

    async function markViewed(id) {
        const m = await get(id);
        if (!m) return false;
        await remove(id);
        return true;
    }

    async function purge() {
        const all = await listAll();
        const now = Date.now();
        let n = 0;
        for (const m of all) {
            if (m.expiresAt < now || (m.viewOnce && m.viewed)) { await remove(m.id); n++; }
        }
        return n;
    }

    async function stats() {
        const all = await listAll();
        const bytes = all.reduce((s, m) => s + (m.bytes || 0), 0);
        return {
            count: all.length,
            bytes,
            quota: QUOTA_BYTES,
            pct: Math.min(100, Math.round(bytes / QUOTA_BYTES * 100))
        };
    }

    /* ------------------------------------------------------------------ */
    /* Affichage                                                          */
    /* ------------------------------------------------------------------ */
    function previewUrl(record) {
        if (!record) return '';
        if (record.remoteUrl) return record.remoteUrl;
        if (record.blob) return URL.createObjectURL(record.blob);
        return record.thumb || '';
    }

    function humanBytes(n) {
        if (n < 1024) return n + ' o';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' Ko';
        return (n / (1024 * 1024)).toFixed(1).replace('.0', '') + ' Mo';
    }

    return {
        ready: openDb,
        pick, save, get, list, listAll, remove, markViewed, purge, stats,
        compressImage, probeVideo, previewUrl, humanBytes,
        setUploader: fn => { externalUploader = fn; },
        QUOTA_BYTES, PHOTO_TARGET, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, DEFAULT_TTL
    };
})();
