/* ==========================================================================
   VIENS CHOP — client API
   Petit module partagé par inscription.html et app.html.

   Configuration :
     <script src="assets/js/api.js"></script>
     <script> VCAPI.configure('https://viens-chop-api.onrender.com'); </script>

   Si aucune adresse n'est configurée, le site reste en mode démonstration
   (aucun appel réseau) — c'est le comportement actuel du site vitrine.
   ========================================================================== */
(function () {
  'use strict';

  const STORE = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} }
  };

  const state = {
    base: '',
    access: null,
    refresh: null
  };

  /** Erreur d'API, avec le code renvoyé par le serveur. */
  class ApiError extends Error {
    constructor(code, message, status) {
      super(message || 'Une erreur est survenue.');
      this.code = code || 'ERREUR_INCONNUE';
      this.status = status || 0;
    }
  }

  function configure(baseUrl) {
    state.base = (baseUrl || '').replace(/\/$/, '');
    state.access = STORE.get('vc_access');
    state.refresh = STORE.get('vc_refresh');
    return enabled();
  }

  function enabled() {
    return state.base.length > 0;
  }

  function saveSession(access, refresh) {
    state.access = access || null;
    state.refresh = refresh || null;
    if (access) STORE.set('vc_access', access); else STORE.del('vc_access');
    if (refresh) STORE.set('vc_refresh', refresh); else STORE.del('vc_refresh');
  }

  function clearSession() {
    saveSession(null, null);
  }

  function isLoggedIn() {
    return !!state.access;
  }

  /**
   * Appel HTTP. Rafraîchit automatiquement le jeton expiré (une seule fois).
   */
  async function request(path, options = {}) {
    if (!enabled()) throw new ApiError('API_NON_CONFIGUREE', 'API non configurée.');

    const { method = 'GET', body, auth = true, retry = true } = options;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && state.access) headers.Authorization = 'Bearer ' + state.access;

    let res;
    try {
      res = await fetch(state.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError('RESEAU', 'Impossible de joindre le serveur. Vérifie ta connexion.');
    }

    // Le serveur répond mais plante (base indisponible, migration manquante)
    if (res.status >= 500) {
      throw new ApiError('ERREUR_SERVEUR', 'Le serveur est momentanément indisponible.', 500);
    }

    // Jeton expiré : on tente un rafraîchissement, puis on rejoue une fois.
    if (res.status === 401 && retry && state.refresh) {
      const refreshed = await tryRefresh();
      if (refreshed) return request(path, { ...options, retry: false });
      clearSession();
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      // Certaines réponses (plafond de requêtes) ne sont pas du JSON :
      // on donne quand même un code compréhensible à l'interface.
      const code = e.code || (res.status === 429 ? 'TROP_DE_DEMANDES'
                   : res.status === 404 ? 'ROUTE_INCONNUE'
                   : 'ERREUR_' + res.status);
      const message = e.message || (res.status === 429
        ? 'Trop de requêtes en peu de temps. Patiente une minute.'
        : 'Le serveur a refusé la demande.');
      throw new ApiError(code, message, res.status);
    }
    return data;
  }

  async function tryRefresh() {
    try {
      const res = await fetch(state.base + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.refresh })
      });
      if (!res.ok) return false;
      const d = await res.json();
      saveSession(d.access_token, d.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Endpoints                                                           */
  /* ------------------------------------------------------------------ */

  const auth = {
    /* Inscription par mot de passe : le serveur hache avec scrypt. */
    async register(phone, password, birthDate) {
      const local = String(phone).replace(/\D/g, '').replace(/^225/, '');
      const d = await request('/api/auth/register', {
        method: 'POST', auth: false,
        body: { phone: local, password, birth_date: birthDate }
      });
      saveSession(d.access_token, d.refresh_token);
      return d;
    },

    async login(phone, password) {
      const local = String(phone).replace(/\D/g, '').replace(/^225/, '');
      const d = await request('/api/auth/login', {
        method: 'POST', auth: false,
        body: { phone: local, password }
      });
      saveSession(d.access_token, d.refresh_token);
      return d;
    },

    me() {
      return request('/api/auth/me');
    },

    async logout() {
      if (state.refresh) {
        try {
          await request('/api/auth/logout', { method: 'POST', body: { refresh_token: state.refresh } });
        } catch { /* on efface quand même */ }
      }
      clearSession();
    }
  };

  const users = {
    updateProfile(p) {
      return request('/api/users/me', { method: 'POST', body: p });
    },
    get(id) {
      return request('/api/users/' + encodeURIComponent(id));
    }
  };

  /* Photos de profil — stockées dans Neon, compressées côté navigateur. */
  const photos = {
    async upload(blob, position, metrics) {
      const data = await blobToBase64(blob);
      return request('/api/photos', {
        method: 'POST',
        body: { data, mime: blob.type || 'image/jpeg', position: position || 0, metrics: metrics || null }
      });
    },
    list() {
      return request('/api/photos/me');
    },
    remove(id) {
      return request('/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    url(idOrUrl) {
      if (!idOrUrl) return '';
      if (/^https?:/.test(idOrUrl)) return idOrUrl;
      return state.base + idOrUrl;
    }
  };

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  const feed = {
    list(limit) {
      return request('/api/feed' + (limit ? '?limit=' + limit : ''));
    }
  };

  const likes = {
    like(userId) {
      return request('/api/likes', { method: 'POST', body: { user_id: userId } });
    },
    whoLikedMe() {
      return request('/api/likes/who-liked-me');
    },
    /* Passer un profil : sans cela il réapparaît au rechargement du fil. */
    pass(userId) {
      return request('/api/likes/pass', { method: 'POST', body: { user_id: userId } });
    }
  };

  const matches = {
    list() {
      return request('/api/matches');
    },
    messages(matchId) {
      return request('/api/matches/' + matchId + '/messages');
    },
    send(matchId, body) {
      return request('/api/matches/' + matchId + '/messages', { method: 'POST', body: { body } });
    },
    media(matchId) {
      return request('/api/matches/' + matchId + '/media');
    },
    async sendMedia(matchId, blob, kind) {
      const data = await blobToBase64(blob);
      return request('/api/matches/' + matchId + '/media', {
        method: 'POST',
        body: { data, mime: blob.type || 'image/jpeg', kind }
      });
    },
    ouvrirMedia(matchId, mediaId) {
      return request('/api/matches/' + matchId + '/media/' + encodeURIComponent(mediaId) + '/ouvrir',
        { method: 'POST' });
    }
  };

  const safety = {
    fakeCall() {
      return request('/api/safety/fake-call', { method: 'POST' });
    },
    report(userId, reason, details) {
      return request('/api/safety/report', { method: 'POST', body: { user_id: userId, reason, details } });
    },
    block(userId) {
      return request('/api/safety/block', { method: 'POST', body: { user_id: userId } });
    },
    blocks() {
      return request('/api/safety/blocks');
    },
    unblock(userId) {
      return request('/api/safety/block/' + encodeURIComponent(userId), { method: 'DELETE' });
    },
    quiz() {
      return request('/api/safety/quiz');
    }
  };

  /* Vérification d'identité (selfie comparé à la main par l'équipe) */
  const certification = {
    statut() {
      return request('/api/certification/me');
    },
    async envoyerSelfie(blob) {
      const data = await blobToBase64(blob);
      return request('/api/certification/selfie', {
        method: 'POST',
        body: { data, mime: blob.type || 'image/jpeg' }
      });
    }
  };

  // Exposition globale (le site est en HTML simple, sans bundler)
  window.VCAPI = {
    ApiError,
    configure,
    enabled,
    isLoggedIn,
    clearSession,
    request,
    auth, users, feed, likes, matches, safety, photos, certification
  };
})();
