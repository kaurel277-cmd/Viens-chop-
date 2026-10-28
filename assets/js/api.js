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

    // Jeton expiré : on tente un rafraîchissement, puis on rejoue une fois.
    if (res.status === 401 && retry && state.refresh) {
      const refreshed = await tryRefresh();
      if (refreshed) return request(path, { ...options, retry: false });
      clearSession();
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      throw new ApiError(e.code, e.message, res.status);
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
    async sendCode(phone) {
      const local = String(phone).replace(/\D/g, '').replace(/^225/, '');
      return request('/api/auth/otp', { method: 'POST', auth: false, body: { phone: local } });
    },

    async verify(phone, code) {
      const local = String(phone).replace(/\D/g, '').replace(/^225/, '');
      const d = await request('/api/auth/verify', {
        method: 'POST', auth: false, body: { phone: local, code }
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
    quiz() {
      return request('/api/safety/quiz');
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
    auth, users, feed, likes, matches, safety
  };
})();
