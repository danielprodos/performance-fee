/* =============================================================================
   Centrale klantenregistratie — SINGLE SOURCE OF TRUTH.

   Nieuwe klant toevoegen:
     1) Voeg hieronder één object toe (uniek `id`).
     2) Kopieer een bestaand dashboard-bestand in /dashboards (bv. tunturi.html)
        naar dashboards/<id>.html en pas bovenin alleen de regel
        `const CONFIG = CLIENTS.find(c => c.id === '<id>');` aan + de <title>.
     3) Publiceer de Google Sheet als CSV en zet de link in `csvUrl`.

   De consultant-overzichtspagina (index.html) leest deze lijst automatisch;
   je hoeft daar niets aan te passen.

   Velden:
     id         uniek, kebab-case (koppelt registratie aan dashboard-bestand)
     naam       weergavenaam
     dashboard  pad naar het dashboard (relatief t.o.v. de site-root)
     csvUrl     gepubliceerde Google Sheet CSV
     btwTarief  0    -> omzet in de sheet staat al ex btw
                0.21 -> omzet is bruto (incl. 21% btw); wordt gedeeld door 1,21
     staffel    fee-% over omzet ex btw o.b.v. TACOS. maxTacos is exclusief (<).
                Volgorde laag -> hoog; laatste trede sluit af met Infinity.
   ============================================================================= */

const CLIENTS = [
  {
    id: 'tunturi',
    naam: 'Tunturi',
    dashboard: 'dashboards/tunturi.html',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQFTpm2oz97EGlO8WKhhAY8VA2V9IjPk6F82LJ8_ly0RD-l6jJpudnMktnOh8xLo0PFO09Irhdtj9c/pub?output=csv',
    btwTarief: 0,
    staffel: [
      { maxTacos: 4,        fee: 0.035,  labelRange: '0–4%' },
      { maxTacos: 5,        fee: 0.025,  labelRange: '4–5%' },
      { maxTacos: 6,        fee: 0.0175, labelRange: '5–6%' },
      { maxTacos: 7,        fee: 0.01,   labelRange: '6–7%' },
      { maxTacos: Infinity, fee: 0,      labelRange: '≥7%' }
    ]
  },
  {
    id: 'fitnessdelivery',
    naam: 'Fitnessdelivery',
    dashboard: 'dashboards/fitnessdelivery.html',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTOUYJZNgGwb6OkXEBPKxpxM270ZZhVxg0r2cY0svDXmm_Qa_0RVpn-pI_0CNDa0pu3HGbESZx0MQuD/pub?output=csv',
    btwTarief: 0.21,
    staffel: [
      { maxTacos: 7,        fee: 0.04,  labelRange: '0–7%' },
      { maxTacos: 10,       fee: 0.03,  labelRange: '7–10%' },
      { maxTacos: 12,       fee: 0.025, labelRange: '10–12%' },
      { maxTacos: 15,       fee: 0.02,  labelRange: '12–15%' },
      { maxTacos: Infinity, fee: 0,     labelRange: '≥15%' }
    ]
  },
  {
    // Andere deal: fee op basis van maandelijks CMS-target (geen TACOS).
    id: 'horecagoedkoop',
    naam: 'Horecagoedkoop',
    dashboard: 'dashboards/horecagoedkoop.html',
    type: 'cms',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR2OmTqM4DzXSN3Mi9vP5tLRZo067--q3SZS-HnzqdACn0LkmYP3_E91zNLmV57F2EDKghjmPuP456P/pub?output=csv',
    cmsKolom: 'CMS incl btw', // dagkolom in de sheet (exacte header)
    btwTarief: 0.21,           // CMS ex btw = incl ÷ 1,21
    retourEmballage: 0.20,     // "− retour & emballage" = ex btw × 0,80
    // Maandtargets = CMS incl. btw per maand
    targets: {
      '2026-06': 581911,
      '2026-07': 467423,
      '2026-08': 394221
    },
    // Fee-banden op doelbereik (van 'CMS − retour & emballage')
    feeBanden: { band2: 0.012, band3: 0.02 } // 50–100%: 1,2% · >100%: 2%
  }
];
