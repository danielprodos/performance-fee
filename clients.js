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
  },
  {
    // Fee per betalende gebruiker (Digital Purchases uit GA4).
    id: 'booklydoo',
    naam: 'Booklydoo',
    dashboard: 'dashboards/booklydoo.html',
    type: 'unit',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQSxo1OIqv8q72DzQ2MfrJagtiiVA3qs3qPeZpsgNbBQf-FKu1Hbbm7L9qQmvj5y60rMAshHHW0HZfH/pub?output=csv',
    feePerUnit: 0.75 // €0,75 per Digital Purchase
    // Let op: backend/10%-regel is nog niet toegepast (v1 op GA4 DigitalPurchases).
  },
  {
    // Fee o.b.v. omzet t.o.v. de 2025-baseline per kalendermaand.
    id: 'profipack',
    naam: 'Profipack',
    dashboard: 'dashboards/profipack.html',
    type: 'baseline',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRla9Y_woHI3jytPJUz14CNgYA40RQmA5JaM79OKxg6pwHX2uhl_WpicwIBO7JVpekgIYcGZF4lKSzj/pub?output=csv',
    btwTarief: 0, // omzet vergelijken op dezelfde basis als de baseline (ex btw)
    // Baseline = "Exact omzet 100% 2025" per maand (maand-van-het-jaar 1..12)
    baselines: {
      1: 698927, 2: 623538, 3: 676306, 4: 676433, 5: 683697, 6: 700762,
      7: 652821, 8: 626488, 9: 765924, 10: 888419, 11: 918502, 12: 725252
    },
    // Banden: 100–110% => 1%, >110% => 3%, met max €10.000 per maand.
    fee: { drempel2: 1.00, drempel3: 1.10, rate2: 0.01, rate3: 0.03, cap: 10000 }
  },
  {
    // Fee per lead; fee/lead o.b.v. kosten-per-lead (CPL). 50% korting op eerste 125 leads.
    id: 'financieelfit',
    naam: 'Financieel Fit',
    dashboard: 'dashboards/financieelfit.html',
    type: 'lead',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTy3Uch2gn0psHOXsjYY2ccnwt1pQUJwHRWi1nbGzAECldsFlDzVIDhtSYbR_GMCd2bdSm1zW64E5Es/pub?output=csv',
    // Fee per lead o.b.v. CPL (kosten per lead). maxCPL is exclusief (<). Aaneengesloten.
    leadStaffel: [
      { maxCPL: 40,       fee: 17.00, label: '< €40' },
      { maxCPL: 65,       fee: 14.50, label: '€40–€64' },
      { maxCPL: 96,       fee: 12.00, label: '€65–€95' },
      { maxCPL: 111,      fee: 10.00, label: '€96–€110' },
      { maxCPL: Infinity, fee: 8.00,  label: '≥ €111' }
    ],
    kortingLeads: 125, // eerste 125 leads
    kortingPct: 0.5    // 50% korting op de fee/lead
  },
  {
    // Fee op new + revived deals, met CPL-modifier.
    id: 'vilifestyle',
    naam: 'Vi Lifestyle',
    dashboard: 'dashboards/vilifestyle.html',
    type: 'deals',
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTe5R4EVsjl2RYVdC4lIzbwS7AtadnvjAmXJ0W2gjKFImbStjZfJWKlwk7J6BkPLWJSPAMSHPlbLN0Y/pub?output=csv',
    feePerNew: 30,       // € per new deal boven de drempel
    feePerRevived: 10,   // € per revived deal
    newDrempel: 75,      // drempel new business (3-maands gem., voorlopig vast)
    cplBasis: 'new',     // CPL = ad-kosten ÷ new deals ('new' | 'all' | 'leads')
    // CPL-modifier op de totale fee. maxCPL is exclusief (<).
    cplStaffel: [
      { maxCPL: 250,      mod: 1.25, label: '< €250' },
      { maxCPL: 350,      mod: 1.00, label: '€250–€350' },
      { maxCPL: 500,      mod: 0.75, label: '€350–€500' },
      { maxCPL: Infinity, mod: 0.50, label: '> €500' }
    ]
  },
  {
    // Fee over productie-banden × ROAS-factor. ROAS = productie ÷ ad-kosten.
    id: 'kredietgroepnl',
    naam: 'Krediet Groep Nederland',
    dashboard: 'dashboards/kredietgroepnl.html',
    type: 'production',
    csvUrl: '', // <-- vul de gepubliceerde CSV-link in zodra de sheet klaar is
    // Fee over productie: 0,30% over €1,2M–€2,0M, 0,20% boven €2,0M (0% eronder).
    productieBanden: [
      { van: 1200000, tot: 2000000, rate: 0.003 },
      { van: 2000000, tot: Infinity, rate: 0.002 }
    ],
    // ROAS-factor op de fee (logische lezing; pas aan als de afspraak anders is).
    // Volgorde hoog -> laag; eerste waar roas >= minRoas wint.
    roasBanden: [
      { minRoas: 109, factor: 1.0 },  // ≥109 -> 100%
      { minRoas: 100, factor: 0.5 },  // 100–109 -> 50%
      { minRoas: 0,   factor: 0.0 }   // <100 -> 0%
    ]
  },
  {
    // Per-KWARTAAL fee op totale omzet t.o.v. kwartaaltarget (geen kanalen).
    // Omzet wordt gelezen met parseBaselineSheet (omzet-kolom); berekend met
    // computeLazyMetrics. Fee getrapt: <85% 0%, 85–100% 5%, >100% 6%.
    id: 'lazysusan',
    naam: 'Lazy Susan',
    dashboard: 'dashboards/lazysusan.html',
    type: 'quarterly',
    csvUrl: '', // <-- vul de gepubliceerde CSV-link in zodra de sheet klaar is
    btwTarief: 0.20,               // omzet bruto incl 20% btw -> netto = ÷1,20
    // Kwartaaltargets (NETTO £) per kwartaal-van-het-jaar, uit de deal-tabel 2026.
    kwartaalTargets: {
      1: 1237825.87, // Q1
      2: 3329864.24, // Q2
      3: 1404913.59, // Q3
      4: 285989.09   // Q4
    },
    wisselkoers: 1.15,             // £ -> € voor de fee
    fee: { drempelStart: 0.85, drempelVol: 1.00, rateTussen: 0.05, rateBoven: 0.06 }
  }
];
