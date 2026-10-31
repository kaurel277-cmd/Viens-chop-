/* ---------------------------------------------------------------------------
   Viens chop — communes et quartiers.

   Une seule liste pour tout le site : la page des Coins Chill (recherche) et
   l'espace promoteur (saisie d'un lieu). Chaque liste se termine par
   « Autre » : si le quartier ou la commune n'est pas proposé, on écrit le nom
   à la main. Aucun gérant ne doit rester bloqué parce qu'il manque une ligne.
   --------------------------------------------------------------------------- */

window.VC_VILLES = {
  'Abidjan — Abobo': ['Abobo Baoulé', 'Anonkoua-Kouté', 'Avocatier', 'Sagbé', 'PK18'],
  'Abidjan — Adjamé': ['220 Logements', 'Brasseur', 'Liberté', 'Williamsville', 'Attiéké'],
  'Abidjan — Attécoubé': ['Attécoubé Centre', 'Lokoa', 'Santé'],
  'Abidjan — Cocody': ['Angré', 'Riviera 2', 'Riviera 3', 'Riviera Palmeraie', 'Deux Plateaux',
                       'Blockhaus', 'Saint-Jean', 'Cité des Arts', 'Cocody Centre'],
  'Abidjan — Koumassi': ['Koumassi Centre', 'Grand Marché', 'Remblais', 'Sicogi', 'Zone Industrielle'],
  'Abidjan — Marcory': ['Marcory Résidentiel', 'Zone 4', 'Biétry', 'Anoumabo', 'Marcory Sud'],
  'Abidjan — Plateau': ['Plateau Centre', 'Cité Administrative', 'Pyramide'],
  'Abidjan — Port-Bouët': ['Vridi', 'Gonzagueville', 'Adjouffou', 'Aéroport'],
  'Abidjan — Treichville': ['Zone 3', 'Arras', 'Belleville', 'Rue du Commerce'],
  'Abidjan — Yopougon': ['Sicogi', 'Niangon', 'Toits Rouges', 'Ananeraie', 'Banco',
                         'Yopougon Selmer', 'Académie', 'Kouté'],
  'Bingerville': ['Bingerville Centre', 'Adjamé-Bingerville'],
  'Grand-Bassam': ['Quartier France', 'Impérial', 'Mockeyville'],
  'Anyama': ['Anyama Centre', 'Abobo-Anyama'],
  'Songon': ['Songon Centre', 'Songon-Dagbé'],
  'Dabou': ['Dabou Centre'],
  'Bouaké': ['Bouaké Centre', 'Air France', 'Nimbo'],
  'Yamoussoukro': ['Yamoussoukro Centre', 'Dioulakro', 'Habitat'],
  'San-Pédro': ['San-Pédro Centre', 'Séwéké'],
  'Korhogo': ['Korhogo Centre'],
  'Daloa': ['Daloa Centre']
};

/** Remplit un <select> de communes. */
window.vcRemplirCommunes = function (select, { avecVide = true, vide = '— Choisis une commune —' } = {}) {
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
    o.textContent = nom.replace(/^Abidjan — /, '');
    select.appendChild(o);
  });
  const autre = document.createElement('option');
  autre.value = '__autre';
  autre.textContent = 'Autre ville / commune…';
  select.appendChild(autre);
  if (garder) select.value = garder;
};

/** Remplit un <select> de quartiers d'après la commune choisie. */
window.vcRemplirQuartiers = function (select, commune, { avecVide = true } = {}) {
  if (!select) return;
  select.innerHTML = '';
  const liste = window.VC_VILLES[commune] || [];
  if (avecVide) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = liste.length ? '— Choisis un quartier —' : '— Choisis d’abord la commune —';
    select.appendChild(o);
  }
  liste.forEach(q => {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = q;
    select.appendChild(o);
  });
  const autre = document.createElement('option');
  autre.value = '__autre';
  autre.textContent = 'Autre quartier…';
  select.appendChild(autre);
};
