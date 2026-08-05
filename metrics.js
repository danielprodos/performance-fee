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
  if (!lines.length) return { rows: [] };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.indexOf(normHeader('Datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  let iCms = header.indexOf(normHeader(kolom));
  if (iCms === -1) iCms = 1; // fallback: tweede kolom
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue;
    rows.push({ datum, cmsInclBtw: parseBedrag(cols[iCms]) });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows };
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

  const dagen = monthRows.length;
  const dim = dagenInMaand(maandISO);
  const dagenVerstreken = dagen ? Number(monthRows[dagen - 1].datum.slice(8, 10)) : 0; // dag-van-maand laatste rij

  // Projectie: extrapoleer de pace naar het maandeinde.
  const projectedIncl = dagenVerstreken > 0 ? actualInclToDate / dagenVerstreken * dim : 0;
  const projectedNetto = cmsNaRetour(projectedIncl, config);

  const feeNu = targetNetto != null ? horecaFee(actualNettoToDate, targetNetto, config.feeBanden) : null;
  const feeVerwacht = targetNetto != null ? horecaFee(projectedNetto, targetNetto, config.feeBanden) : null;

  return {
    targetIncl, targetNetto, btw,
    actualInclToDate, actualNettoToDate, actualExBtw,
    dagen, dagenVerstreken, dagenInMaand: dim,
    projectedIncl, projectedNetto,
    feeNu, feeVerwacht,
    behaaldPct: targetNetto ? (actualNettoToDate / targetNetto * 100) : null,
    projectiePct: targetNetto ? (projectedNetto / targetNetto * 100) : null,
    eerste: dagen ? monthRows[0].datum : null,
    laatste: dagen ? monthRows[dagen - 1].datum : null
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
