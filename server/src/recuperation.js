import crypto from 'node:crypto';

/* ---------------------------------------------------------------------------
   Clé de secours — le « mot de passe oublié » de Viens chop.

   Il n'y a ni email ni SMS (règle du projet). La seule chose qui peut donc
   prouver qu'on est bien le propriétaire du compte, c'est un secret que la
   personne a noté au moment de son inscription : sa clé de secours.

   - 12 caractères tirés au hasard, sans les signes qu'on confond en recopiant
     (0/O, 1/I/L) : environ 10^17 combinaisons.
   - Affichée une seule fois, jamais renvoyée ensuite.
   - Stockée hachée (scrypt, sel par compte) : même quelqu'un qui lit la base
     ne peut pas s'en servir.
   - Utilisable une seule fois : après un dépannage, il faut en générer une
     nouvelle.
   --------------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 31 signes, sans I L O 0 1
const LONGUEUR = 12;

/** Tire une clé neuve et renvoie sa forme affichée : ABCD-EFGH-JKMN */
export function genererCleSecours() {
  let brute = '';
  for (let i = 0; i < LONGUEUR; i++) brute += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return brute.match(/.{1,4}/g).join('-');
}

/** Accepte « abcd efgh jkmn », « ABCD-EFGH-JKMN » ou la version collée. */
export function normaliserCleSecours(saisie) {
  return String(saisie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Vrai si la saisie a la bonne forme (avant même de toucher à la base). */
export function cleSecoursBienFormee(saisie) {
  const c = normaliserCleSecours(saisie);
  if (c.length !== LONGUEUR) return false;
  return [...c].every(signe => ALPHABET.includes(signe));
}
