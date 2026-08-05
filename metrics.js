/* =============================================================================
   Prodos performance-dashboards — gedeelde parsing & berekeningen.
   Gebruikt door de losse klant-dashboards én de consultant-overzichtspagina,
   zodat de cijfers overal identiek zijn.
   ============================================================================= */

// Verwachte kolomnamen in de sheets. Kolommen worden op naam herkend, zodat
// optionele kolommen (Microsoft, locale campagnes) per klant mogen ontbreken.
const KOLOMMEN = {
  datum: 'Datum',
  meta: 'Meta Ads kosten',
  google: 'Google Ads kosten',
  microsoft: 'Microsoft Ads Kosten', // optioneel; telt mee in de ad-kosten
  locale: 'Kosten locale campagnes',  // optioneel; wordt van de ad-kosten afgetrokken
  netto: 'Netto inkomsten (ex btw)'
};

function normHeader(s) {
  return String(s == null ? '' : s).replace(/^﻿/, '').trim().toLowerCase();
}

// Splitst een CSV-regel met respect voor dubbele quotes.
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// NL-bedrag "€1.298,29" -> 1298.29 ; lege/ongeldige waarde -> 0.
function parseBedrag(raw) {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (s === '') return 0;
  s = s.replace(/€/g, '').replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
  s = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Geldige datum YYYY-MM-DD? -> string of null.
function parseDatum(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(s) ? s : null;
}

// Parse CSV-tekst naar rijen o.b.v. de klant-config.
// Omzet in de sheet is bruto (incl. btw): wordt gedeeld door (1 + btwTarief).
// Retourneert { rows, heeftLocaleKolom, heeftMicrosoftKolom }.
function parseSheet(text, config) {
  const btwTarief = (config && config.btwTarief != null) ? config.btwTarief : 0.21;
  const lines = String(text).split(/\r?\n/);
  if (lines.length === 0) return { rows: [], heeftLocaleKolom: false, heeftMicrosoftKolom: false };

  const header = splitCsvLine(lines[0]).map(normHeader);
  const idx = (naam) => header.indexOf(normHeader(naam));
  const iDatum = idx(KOLOMMEN.datum);
  const iMeta = idx(KOLOMMEN.meta);
  const iGoogle = idx(KOLOMMEN.google);
  const iMicrosoft = idx(KOLOMMEN.microsoft);
  const iLocale = idx(KOLOMMEN.locale);
  const iNetto = idx(KOLOMMEN.netto);
  const heeftLocaleKolom = iLocale !== -1;
  const heeftMicrosoftKolom = iMicrosoft !== -1;
  const kolomDatum = iDatum === -1 ? 0 : iDatum; // fallback: eerste kolom

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue; // sla instructie-/lege regels over
    rows.push({
      datum,
      meta: parseBedrag(cols[iMeta]),
      google: parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft]),
      locale: iLocale === -1 ? 0 : parseBedrag(cols[iLocale]),
      netto: parseBedrag(cols[iNetto]) / (1 + btwTarief)
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftLocaleKolom, heeftMicrosoftKolom };
}

// ---------- Staffel ----------
function feeVoorTacos(tacosPct, staffel) {
  for (const tred of staffel) {
    if (tacosPct < tred.maxTacos) return tred;
  }
  return staffel[staffel.length - 1];
}
function eersteTred(staffel) { return staffel[0]; }
function noFeeThreshold(staffel) {
  const eindig = staffel.map(t => t.maxTacos).filter(m => isFinite(m));
  return eindig.length ? Math.max(...eindig) : null;
}

// ---------- Samengevatte metrics ----------
// Effectieve ad-kosten = Meta + Google + Microsoft − locale campagnes.
// TACOS = effectieve ad-kosten / netto omzet (ex btw).
function computeMetrics(rows, config) {
  const totMeta = rows.reduce((s, r) => s + r.meta, 0);
  const totGoogle = rows.reduce((s, r) => s + r.google, 0);
  const totMicrosoft = rows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const totLocale = rows.reduce((s, r) => s + (r.locale || 0), 0);
  const brutoKosten = totMeta + totGoogle + totMicrosoft;
  const effKosten = brutoKosten - totLocale;
  const totNetto = rows.reduce((s, r) => s + r.netto, 0);

  const heeftOmzet = totNetto > 0;
  const tacos = heeftOmzet ? (effKosten / totNetto) * 100 : null;
  const tred = heeftOmzet ? feeVoorTacos(tacos, config.staffel) : null;
  const feePct = tred ? tred.fee : 0;
  const feeBedrag = heeftOmzet ? feePct * totNetto : 0;
  const aantalDagen = rows.length;

  return {
    totMeta, totGoogle, totMicrosoft, totLocale, brutoKosten, effKosten, totNetto,
    heeftOmzet, tacos, tred, feePct, feeBedrag, aantalDagen,
    gemPerDag: aantalDagen ? totNetto / aantalDagen : 0,
    eerste: aantalDagen ? rows[0].datum : null,
    laatste: aantalDagen ? rows[aantalDagen - 1].datum : null
  };
}

/* ---------- Horecagoedkoop: CMS-target deal ----------
   Andere deal dan de TACOS-klanten. Per maand een CMS-target (incl. btw).
   Actual = som van de dagelijkse 'CMS incl. btw'. Beide worden omgerekend naar
   'CMS − retour & emballage' via ÷(1+btw) en ×(1−retourEmballage).
   Fee-banden op doelbereik:
     0–50% van target      -> 0%
     50–100% van target     -> feeBanden.band2 (1,2%) over het behaalde deel in die band
     >100% van target       -> feeBanden.band3 (2%) over het deel boven target
*/
function parseCmsSheet(text, config) {
  const kolom = (config && config.cmsKolom) || 'CMS incl. btw';
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.indexOf(normHeader('Datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  let iCms = header.indexOf(normHeader(kolom));
  if (iCms === -1) iCms = 1; // fallback: tweede kolom
  // Optionele ad-kosten-kolommen (informatief; niet in de fee).
  const iMeta = header.findIndex(h => h.includes('meta'));
  const iGoogle = header.findIndex(h => h.includes('google'));
  const iMicrosoft = header.findIndex(h => h.includes('microsoft'));
  const heeftAdKosten = iMeta !== -1 || iGoogle !== -1 || iMicrosoft !== -1;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue;
    rows.push({
      datum,
      cmsInclBtw: parseBedrag(cols[iCms]),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function cmsNaRetour(inclBtw, config) {
  const btw = (config && config.btwTarief != null) ? config.btwTarief : 0.21;
  const re = (config && config.retourEmballage != null) ? config.retourEmballage : 0.20;
  return inclBtw / (1 + btw) * (1 - re);
}

function horecaFee(actualNetto, targetNetto, banden) {
  const b2 = (banden && banden.band2 != null) ? banden.band2 : 0.012;
  const b3 = (banden && banden.band3 != null) ? banden.band3 : 0.02;
  const half = 0.5 * targetNetto;
  const band2Bedrag = Math.max(0, Math.min(actualNetto, targetNetto) - half);
  const band3Bedrag = Math.max(0, actualNetto - targetNetto);
  return {
    fee: b2 * band2Bedrag + b3 * band3Bedrag,
    band1Bedrag: half, band2Bedrag, band3Bedrag,
    feeBand2: b2 * band2Bedrag, feeBand3: b3 * band3Bedrag
  };
}

function dagenInMaand(maandISO) {
  const [y, m] = maandISO.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function computeHorecaMetrics(monthRows, maandISO, config) {
  const targetIncl = (config.targets && config.targets[maandISO] != null) ? config.targets[maandISO] : null;
  const targetNetto = targetIncl != null ? cmsNaRetour(targetIncl, config) : null;
  const btw = (config.btwTarief != null) ? config.btwTarief : 0.21;

  const actualInclToDate = monthRows.reduce((s, r) => s + r.cmsInclBtw, 0);
  const actualNettoToDate = cmsNaRetour(actualInclToDate, config);
  const actualExBtw = actualInclToDate / (1 + btw);

  // Ad-kosten (informatief; niet in de fee-berekening).
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;

  const dim = dagenInMaand(maandISO);
  // Alleen dagen mét ingevulde data tellen mee (voor-ingevulde lege rijen negeren).
  const rijenMetData = monthRows.filter(r => r.cmsInclBtw > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;

  // Projectie: extrapoleer de pace naar het maandeinde (o.b.v. dagen mét data).
  const projectedIncl = dagenVerstreken > 0 ? actualInclToDate / dagenVerstreken * dim : 0;
  const projectedNetto = cmsNaRetour(projectedIncl, config);

  const feeNu = targetNetto != null ? horecaFee(actualNettoToDate, targetNetto, config.feeBanden) : null;
  const feeVerwacht = targetNetto != null ? horecaFee(projectedNetto, targetNetto, config.feeBanden) : null;

  return {
    targetIncl, targetNetto, btw,
    actualInclToDate, actualNettoToDate, actualExBtw,
    totMeta, totGoogle, totMicrosoft, adKosten,
    dagen, dagenVerstreken, dagenInMaand: dim,
    projectedIncl, projectedNetto,
    feeNu, feeVerwacht,
    behaaldPct: targetNetto ? (actualNettoToDate / targetNetto * 100) : null,
    projectiePct: targetNetto ? (projectedNetto / targetNetto * 100) : null,
    eerste: dagen ? rijenMetData[0].datum : (monthRows.length ? monthRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (monthRows.length ? monthRows[monthRows.length - 1].datum : null)
  };
}

/* ---------- Booklydoo: fee per betalende gebruiker ----------
   Fee = feePerUnit (€0,75) × aantal Digital Purchases (GA4) in de maand.
   Kolommen worden flexibel op trefwoord herkend (meta / google / purchase),
   zodat kleine naamverschillen ('Meta ad kosten' vs 'Meta Ads kosten') werken.
   (De backend/10%-regel is bewust nog niet toegepast — later toe te voegen.)
*/
function parseUnitSheet(text, config) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.findIndex(h => h.includes('datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  const iUnits = header.findIndex(h => h.includes('purchase') || h.includes('aankop') || h.includes('betalende') || h.includes('gebruiker'));
  const iMeta = header.findIndex(h => h.includes('meta'));
  const iGoogle = header.findIndex(h => h.includes('google'));
  const iMicrosoft = header.findIndex(h => h.includes('microsoft'));
  const heeftAdKosten = iMeta !== -1 || iGoogle !== -1 || iMicrosoft !== -1;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue;
    rows.push({
      datum,
      units: iUnits === -1 ? 0 : Math.round(parseBedrag(cols[iUnits])),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function computeUnitMetrics(monthRows, maandISO, config) {
  const feePerUnit = (config && config.feePerUnit != null) ? config.feePerUnit : 0.75;
  const totUnits = monthRows.reduce((s, r) => s + (r.units || 0), 0);
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;
  const fee = feePerUnit * totUnits;

  const rijenMetData = monthRows.filter(r => (r.units || 0) > 0 || (r.meta || 0) > 0 || (r.google || 0) > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;

  return {
    totUnits, fee, feePerUnit, totMeta, totGoogle, totMicrosoft, adKosten,
    kostenPerUnit: totUnits > 0 ? adKosten / totUnits : null,
    dagen, dagenVerstreken, dagenInMaand: dagenInMaand(maandISO),
    eerste: dagen ? rijenMetData[0].datum : (monthRows.length ? monthRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (monthRows.length ? monthRows[monthRows.length - 1].datum : null)
  };
}

/* ---------- Profipack: baseline-banden ----------
   Fee op omzet t.o.v. de baseline (2025) van díe kalendermaand:
     0–100% van baseline    -> 0%
     100–110% van baseline  -> rate2 (1%) over dat deel
     >110% van baseline      -> rate3 (3%) over dat deel
   met een maximum (cap) per maand. Baseline per maand-van-het-jaar (1–12).
   Toont ook een pace-projectie naar het maandeinde.
*/
function parseBaselineSheet(text, config) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.findIndex(h => h.includes('datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  const iMeta = header.findIndex(h => h.includes('meta'));
  const iGoogle = header.findIndex(h => h.includes('google'));
  const iMicrosoft = header.findIndex(h => h.includes('microsoft'));
  let iOmzet = header.findIndex(h => h.includes('omzet') || h.includes('revenue') || h.includes('turnover'));
  if (iOmzet === -1) {
    for (let j = 0; j < header.length; j++) {
      if (j !== kolomDatum && j !== iMeta && j !== iGoogle && j !== iMicrosoft && header[j] !== '') { iOmzet = j; break; }
    }
  }
  const heeftAdKosten = iMeta !== -1 || iGoogle !== -1 || iMicrosoft !== -1;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue;
    rows.push({
      datum,
      omzet: iOmzet === -1 ? 0 : parseBedrag(cols[iOmzet]),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function computeBaselineMetrics(monthRows, maandISO, config) {
  const btw = (config && config.btwTarief != null) ? config.btwTarief : 0;
  const maandNr = Number(maandISO.split('-')[1]); // 1..12
  const baseline = (config.baselines && config.baselines[maandNr] != null) ? config.baselines[maandNr] : null;
  const f = config.fee || {};
  const drempel2 = f.drempel2 != null ? f.drempel2 : 1.00; // 100%
  const drempel3 = f.drempel3 != null ? f.drempel3 : 1.10; // 110%
  const rate2 = f.rate2 != null ? f.rate2 : 0.01;
  const rate3 = f.rate3 != null ? f.rate3 : 0.03;
  const cap = f.cap != null ? f.cap : null;

  const omzetToDate = monthRows.reduce((s, r) => s + (r.omzet || 0), 0) / (1 + btw);
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;

  function feeVoor(omzet) {
    if (baseline == null) return null;
    const t2 = baseline * drempel2, t3 = baseline * drempel3;
    const band2Bedrag = Math.max(0, Math.min(omzet, t3) - t2);
    const band3Bedrag = Math.max(0, omzet - t3);
    const raw = rate2 * band2Bedrag + rate3 * band3Bedrag;
    const fee = cap != null ? Math.min(raw, cap) : raw;
    return { fee, raw, gecapt: cap != null && raw > cap, band2Bedrag, band3Bedrag, feeBand2: rate2 * band2Bedrag, feeBand3: rate3 * band3Bedrag, t2, t3 };
  }

  const dim = dagenInMaand(maandISO);
  const rijenMetData = monthRows.filter(r => (r.omzet || 0) > 0 || (r.meta || 0) > 0 || (r.google || 0) > 0 || (r.microsoft || 0) > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;
  const projectedOmzet = dagenVerstreken > 0 ? omzetToDate / dagenVerstreken * dim : 0;

  return {
    baseline, btw, drempel2, drempel3, rate2, rate3, cap,
    omzetToDate, projectedOmzet, totMeta, totGoogle, totMicrosoft, adKosten,
    feeNu: feeVoor(omzetToDate), feeVerwacht: feeVoor(projectedOmzet),
    pctVanBaseline: baseline ? omzetToDate / baseline * 100 : null,
    projectiePct: baseline ? projectedOmzet / baseline * 100 : null,
    dagen, dagenVerstreken, dagenInMaand: dim,
    eerste: dagen ? rijenMetData[0].datum : (monthRows.length ? monthRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (monthRows.length ? monthRows[monthRows.length - 1].datum : null)
  };
}

// ---------- Maanden ----------
// Fee wordt per kalendermaand berekend. Rijen blijven in één sheet staan;
// hieronder filteren/kiezen we de juiste maand.
function maandVan(datumIso) { return String(datumIso).slice(0, 7); } // 'YYYY-MM'

function beschikbareMaanden(rows) {
  return [...new Set(rows.map(r => maandVan(r.datum)))].sort();
}

function huidigeMaandISO(nu) {
  const d = nu || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Standaard = huidige kalendermaand als die data heeft, anders de laatste maand mét data.
function kiesMaand(rows, gewenst) {
  const maanden = beschikbareMaanden(rows);
  if (!maanden.length) return null;
  const doel = gewenst || huidigeMaandISO();
  return maanden.includes(doel) ? doel : maanden[maanden.length - 1];
}

function filterMaand(rows, maandISO) {
  if (!maandISO) return rows.slice();
  return rows.filter(r => maandVan(r.datum) === maandISO);
}

// ---------- Formatters (NL) ----------
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const pct1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtEuro(n) { return euro.format(n || 0); }
function fmtPct(n) { return pct1.format(n) + '%'; }
function fmtDatumNL(iso) { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
function maandLabel(maandISO) {
  const [y, m] = maandISO.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1); // "Augustus 2026"
}
