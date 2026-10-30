/* ==========================================================================
   VIENS CHOP — likes, matchs et messagerie réels

   Ne s'active qu'en mode serveur. En mode appareil (hors ligne), les
   fonctions de démonstration d'app.html restent inchangées.

   Règles appliquées côté serveur, jamais dans le navigateur :
     - 3 likes par jour en Mode Coulé (trigger PostgreSQL)
     - deux likes réciproques créent un match (trigger)
     - la photo se débloque au 5ᵉ message (trigger)
     - l'expéditeur doit appartenir au match (trigger)

   API
     VCSo.like(userId)            -> { matched, match_id, likes_left }
     VCSo.matches()               -> liste des matchs
     VCSo.open(matchId)           -> ouvre la conversation et démarre le suivi
     VCSo.send(matchId, texte)
     VCSo.close()
   ========================================================================== */
window.VCSo = (function () {
    'use strict';

    let API = null;
    let ouvert = null;              // match actuellement affiché
    let minuteur = null;            // rafraîchissement des messages
    let dernierMessageVu = null;

    const url = p => (window.VCAPI ? window.VCAPI.photos.url(p) : p);

    /* ------------------------------------------------------------------ */
    /* Likes                                                              */
    /* ------------------------------------------------------------------ */
    async function like(userId) {
        if (!API) throw Object.assign(new Error('API indisponible'), { code: 'API_NON_CONFIGUREE' });
        const rep = await API.likes.like(userId);
        return {
            matched: !!rep.matched,
            matchId: rep.match_id || null,
            likesLeft: rep.likes_left === null || rep.likes_left === undefined ? null : rep.likes_left
        };
    }

    /* ------------------------------------------------------------------ */
    /* Matchs                                                             */
    /* ------------------------------------------------------------------ */
    async function matches() {
        const rep = await API.matches.list();
        return (rep.matches || []).map(m => ({
            id: m.id,
            userId: m.other_id,
            nom: m.other_pseudo,
            age: m.other_age,
            commune: m.other_commune,
            photo: m.other_photo_url ? url(m.other_photo_url) : null,
            photoDebloquee: !!m.photo_unlocked,
            dernier: m.last_message || '',
            dernierAt: m.last_message_at || m.created_at,
            nonLus: Number(m.unread || 0),
            messages: Number(m.message_count || 0)
        }));
    }

    /* ------------------------------------------------------------------ */
    /* Conversation                                                       */
    /* ------------------------------------------------------------------ */
    async function open(matchId) {
        const rep = await API.matches.messages(matchId);
        ouvert = {
            id: matchId,
            photoDebloquee: !!rep.match.photo_unlocked,
            restants: rep.match.messages_until_unlock,
            messages: rep.messages || []
        };
        dernierMessageVu = ouvert.messages.length;
        return ouvert;
    }

    async function send(matchId, texte) {
        const rep = await API.matches.send(matchId, texte);
        ouvert.restants = rep.messages_until_unlock;
        ouvert.photoDebloquee = !!rep.photo_unlocked;
        return rep;
    }

    /* ------------------------------------------------------------------ */
    /* Médias en vue unique                                               */
    /* ------------------------------------------------------------------ */
    async function mediaListe(matchId) {
        const rep = await API.matches.media(matchId);
        return { disponible: rep.disponible !== false, media: rep.media || [], moi: rep.moi };
    }

    async function envoyerMedia(matchId, blob, kind) {
        const rep = await API.matches.sendMedia(matchId, blob, kind);
        return rep.media;
    }

    async function ouvrirMedia(matchId, mediaId) {
        return API.matches.ouvrirMedia(matchId, mediaId);
    }

    /** Suit les nouveaux messages sans recharger la page. */
    function suivre(matchId, onNouveau, onDeblocage, onMedia) {
        arreter();
        minuteur = setInterval(async () => {
            try {
                const rep = await API.matches.messages(matchId);
                const liste = rep.messages || [];
                if (liste.length !== dernierMessageVu) {
                    const nouveaux = liste.slice(dernierMessageVu);
                    dernierMessageVu = liste.length;
                    onNouveau(nouveaux, liste);
                }
                if (rep.match.photo_unlocked && !ouvert.photoDebloquee) {
                    ouvert.photoDebloquee = true;
                    if (onDeblocage) onDeblocage();
                }
                ouvert.restants = rep.match.messages_until_unlock;
                if (onMedia) {
                    const m = await API.matches.media(matchId);
                    onMedia(m.media || [], m.moi);
                }
            } catch (e) { /* réseau instable : on réessaiera */ }
        }, 3000);
    }

    function arreter() {
        if (minuteur) { clearInterval(minuteur); minuteur = null; }
    }

    function close() {
        arreter();
        ouvert = null;
        dernierMessageVu = null;
    }

    return {
        brancher(api) { API = api; },
        get pret() { return !!API; },
        get ouvert() { return ouvert; },
        like, matches, open, send, suivre, arreter, close,
        mediaListe, envoyerMedia, ouvrirMedia
    };
})();
