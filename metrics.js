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

// ---------- Formatters (NL) ----------
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const pct1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtEuro(n) { return euro.format(n || 0); }
function fmtPct(n) { return pct1.format(n) + '%'; }
function fmtDatumNL(iso) { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
