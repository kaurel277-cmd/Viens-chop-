#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Dépannage manuel : donner une nouvelle clé de secours à un compte.

   À utiliser seulement quand quelqu'un a perdu son mot de passe ET n'a plus
   sa clé (compte créé avant la mise en place du dispositif, par exemple).
   Tu lances la commande, tu lui donnes la clé par le canal de ton choix, elle
   va sur mot-de-passe-oublie.html et choisit un nouveau mot de passe.

   Usage (depuis le dossier server/, avec la DATABASE_URL de Neon) :
     DATABASE_URL="postgresql://..." node tools/nouvelle-cle.js 0701020304

   Rien n'est écrit en clair : seule l'empreinte de la clé est enregistrée.
   --------------------------------------------------------------------------- */
import { query } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { genererCleSecours, normaliserCleSecours } from '../src/recuperation.js';

const brut = process.argv[2];
if (!brut) {
  console.error('Donne un numéro. Exemple : node tools/nouvelle-cle.js 0701020304');
  process.exit(1);
}

const chiffres = String(brut).replace(/\D/g, '').replace(/^225/, '');
const phone = `+225${chiffres}`;

const { rows } = await query(
  `select id, pseudo, phone, (recovery_hash is not null) as a_cle
     from public.users where phone = $1`,
  [phone]
);

if (!rows.length) {
  console.error(`Aucun compte avec le numéro ${phone}.`);
  process.exit(1);
}

const u = rows[0];
const cle = genererCleSecours();

await query(
  `update public.users
      set recovery_hash = $2, recovery_created_at = now(), recovery_used_at = null
    where id = $1`,
  [u.id, hashPassword(normaliserCleSecours(cle))]
);

console.log('');
console.log(`Compte      : ${u.pseudo} (${u.phone})`);
console.log(`Clé de secours : ${cle}`);
console.log('');
console.log('Transmets-la à la personne. Elle va sur mot-de-passe-oublie.html,');
console.log('entre son numéro, cette clé, puis un nouveau mot de passe.');
console.log('La clé ne fonctionne qu\'une fois.');
process.exit(0);
