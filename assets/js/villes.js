/* ---------------------------------------------------------------------------
   Viens chop — communes et quartiers.

   Une seule liste pour tout le site : la page des Coins Chill (recherche) et
   l'espace promoteur (saisie d'un lieu).

   Principe : dès qu'une commune est choisie, la colonne « quartier » se
   remplit avec ses quartiers, et il n'y a plus qu'à choisir. Chaque liste se
   termine par « Autre » : si le quartier n'y est pas, on écrit son nom à la
   main. Aucun gérant ne doit rester bloqué parce qu'il manque une ligne.
   --------------------------------------------------------------------------- */

window.VC_VILLES = {
  'Abidjan — Abobo': [
    'Abobo Gare', 'Abobo Baoulé', 'Abobo Sagbé', 'Akéikoi', 'Akéité',
    'Anonkoua-Kouté', 'Avocatier', 'Belle-Ville', 'PK18', 'Abobo Centre',
    'Kennedy', 'Mairie'
  ],
  'Abidjan — Adjamé': [
    'Adjamé Centre', '220 Logements', 'Bromakoté', 'Williamsville', 'Liberté',
    'Brasseries', 'Attiéké', 'N’Guéchié', 'Bacongo', 'Gare Routière'
  ],
  'Abidjan — Attécoubé': [
    'Attécoubé Centre', 'Lokoa', 'Santé', 'Anonkoua', 'Abidjan Attécoubé'
  ],
  'Abidjan — Cocody': [
    'Angré', 'Angré 8e Tranche', 'Riviera 1', 'Riviera 2', 'Riviera 3',
    'Riviera 4', 'Riviera Palmeraie', 'Deux Plateaux', 'Deux Plateaux Vallons',
    'Cocody Centre', 'Blockhaus', 'Saint-Jean', 'Cité des Arts', 'Danga',
    'Boulevard Latrille', 'Ambassades', 'Mermoz', 'Faya'
  ],
  'Abidjan — Koumassi': [
    'Koumassi Centre', 'Grand Marché', 'Remblais', 'Sicogi', 'Campement',
    'Zone Industrielle', 'Divo', 'Koumassi A', 'Koumassi B'
  ],
  'Abidjan — Marcory': [
    'Marcory Résidentiel', 'Zone 4', 'Biétry', 'Anoumabo', 'Marcory Sud',
    'M’Badon', 'Sicogi Marcory', 'Kéitas'
  ],
  'Abidjan — Plateau': [
    'Plateau Centre', 'Cité Administrative', 'Pyramide', 'Docteur Blanchard',
    'Marché du Plateau'
  ],
  'Abidjan — Port-Bouët': [
    'Vridi', 'Vridi Canal', 'Gonzagueville', 'Adjouffou', 'Aéroport',
    'Poto-Poto', 'Port-Bouët Centre'
  ],
  'Abidjan — Treichville': [
    'Zone 3', 'Arras', 'Belleville', 'Rue du Commerce', 'Treichville Centre',
    'Avenue 16'
  ],
  'Abidjan — Yopougon': [
    'Sicogi', 'Siporex', 'Niangon', 'Niangon Sud', 'Toits Rouges', 'Ananeraie',
    'Banco', 'Selmer', 'Académie', 'Kouté', 'N’Dotré', 'Gesco', 'Wassakara',
    'Yopougon Attié', 'Micao', 'Port-Bouët Yopougon', 'Quartier Résidentiel'
  ],
  'Bingerville': ['Bingerville Centre', 'Adjamé-Bingerville', 'Gbagba', 'Eloka', 'Cocody-Bingerville'],
  'Grand-Bassam': ['Quartier France', 'Impérial', 'Mockeyville', 'Modeste', 'Grand-Bassam Centre', 'Vitré'],
  'Anyama': ['Anyama Centre', 'Abobo-Anyama', 'Anyama Gare', 'Longou'],
  'Songon': ['Songon Centre', 'Songon-Dagbé', 'Songon-Agbanou', 'Songon-Brignan'],
  'Dabou': ['Dabou Centre', 'Dabou Kpangban', 'Toupah'],
  'Bouaké': ['Bouaké Centre', 'Air France', 'Nimbo', 'Belleville', 'Koko', 'N’Gattakro', 'Sokoura', 'Dar-es-Salam'],
  'Yamoussoukro': ['Yamoussoukro Centre', 'Dioulakro', 'Habitat', 'Millionnaire', 'Kokrenou', 'N’Zuessy'],
  'San-Pédro': ['San-Pédro Centre', 'Séwéké', 'Balmer', 'Béréby'],
  'Korhogo': ['Korhogo Centre', 'Soba', 'Koko', 'Petit Paris'],
  'Daloa': ['Daloa Centre', 'Tazibouo', 'Lobia', 'Commerce']
};

/** Le nom affiché : « Abidjan — Yopougon » devient « Yopougon ». */
window.vcNomCourt = function (nom) {
  return String(nom || '').replace(/^Abidjan — /, '');
};

/**
 * Remplit un <select> de communes.
 *   avecVide : ajoute une ligne vide en tête
 *   autre    : ajoute la ligne « Autre commune… » (écriture libre)
 */
window.vcRemplirCommunes = function (select, { avecVide = true, vide = '— Choisir la commune —', autre = true } = {}) {
  if (!select) return;
  const garder = select.value;
  select.innerHTML = '';
  if (avecVide) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = vide;
    select.appendChild(o);
  }
  Object.keys(window.VC_VILLES).sort().forEach(nom => {
    const o = document.createElement('option');
    o.value = nom;
    o.textContent = window.vcNomCourt(nom);
    select.appendChild(o);
  });
  if (autre) {
    const a = document.createElement('option');
    a.value = '__autre';
    a.textContent = 'Autre commune…';
    select.appendChild(a);
  }
  if (garder) select.value = garder;
};

/**
 * Remplit un <select> de quartiers d'après la commune choisie.
 * Tant qu'aucune commune n'est choisie, la liste est désactivée : on ne peut
 * pas choisir un quartier qui n'appartient à rien.
 */
window.vcRemplirQuartiers = function (select, commune, { avecVide = true, autre = true, desactiverSiVide = true } = {}) {
  if (!select) return;
  select.innerHTML = '';

  const liste = window.VC_VILLES[commune] || [];
  const sansCommune = !commune;

  if (avecVide) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = sansCommune ? '— Choisis la commune —' : '— Choisir —';
    select.appendChild(o);
  }

  liste.forEach(q => {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = q;
    select.appendChild(o);
  });

  if (autre) {
    const a = document.createElement('option');
    a.value = '__autre';
    a.textContent = sansCommune ? 'Autre quartier (écris-le)…' : 'Autre quartier…';
    select.appendChild(a);
  }

  select.disabled = desactiverSiVide && sansCommune;
};
