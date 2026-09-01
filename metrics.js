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

// Een dagrij telt pas mee als álle relevante datakolommen (die deze klant
// gebruikt) gevuld zijn. Zo wordt een dag met bv. wél ad-kosten maar (nog) geen
// omzet overgeslagen tot alles binnen is. Een expliciete 0 geldt als ingevuld;
// alleen leeg telt niet. `indices` bevat de te controleren kolomindexen (−1 = niet
// aanwezig, wordt genegeerd) — hulptabellen naast de data blijven dus buiten schot.
function rijCompleet(cols, indices) {
  for (const j of indices) {
    if (j == null || j < 0) continue;
    if (String(cols[j] == null ? '' : cols[j]).trim() === '') return false;
  }
  return true;
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
  // Netto/omzet-kolom op trefwoord herkennen, zodat de titel "(ex btw)" of
  // "incl BTW" mag zijn zonder dat het dashboard omvalt. De echte datatabel
  // staat links, dus de eerste 'inkomsten'-kolom is de juiste (een hulptabel
  // ernaast met dezelfde naam wordt zo niet per ongeluk gepakt).
  // LET OP: dit raakt alleen de kolomherkenning, niet de btw-berekening.
  let iNetto = header.findIndex(h => h.includes('inkomsten'));
  if (iNetto === -1) iNetto = idx(KOLOMMEN.netto);
  if (iNetto === -1) iNetto = header.findIndex(h => h.includes('netto') || h.includes('omzet'));
  const heeftLocaleKolom = iLocale !== -1;
  const heeftMicrosoftKolom = iMicrosoft !== -1;
  const kolomDatum = iDatum === -1 ? 0 : iDatum; // fallback: eerste kolom

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue; // sla instructie-/lege regels over
    if (!rijCompleet(cols, [iMeta, iGoogle, iMicrosoft, iLocale, iNetto])) continue; // alleen volledig gevulde dagen
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
    if (!rijCompleet(cols, [iCms, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
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
    if (!rijCompleet(cols, [iUnits, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
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
    if (!rijCompleet(cols, [iOmzet, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
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

/* ---------- Financieel Fit: fee per lead ----------
   Fee/lead hangt af van de kosten-per-lead (CPL = beheerde ad-kosten ÷ leads).
   Eerste `kortingLeads` (125) leads: `kortingPct` (50%) korting op de fee/lead.
   Fee = min(leads,125) × fee/lead × (1−korting) + max(leads−125,0) × fee/lead.
*/
function feePerLead(cpl, staffel) {
  for (const t of staffel) { if (cpl < t.maxCPL) return t; }
  return staffel[staffel.length - 1];
}

function parseLeadSheet(text, config) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.findIndex(h => h.includes('datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  const iLeads = header.findIndex(h => h.includes('lead'));
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
    if (!rijCompleet(cols, [iLeads, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
    rows.push({
      datum,
      leads: iLeads === -1 ? 0 : Math.round(parseBedrag(cols[iLeads])),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function leadFeeBerekening(leads, cpl, config) {
  const staffel = config.leadStaffel;
  const tred = (cpl != null && leads > 0) ? feePerLead(cpl, staffel) : null;
  const fpl = tred ? tred.fee : 0;
  const kortingN = config.kortingLeads != null ? config.kortingLeads : 125;
  const kortingPct = config.kortingPct != null ? config.kortingPct : 0.5;
  const kortingLeads = Math.min(leads, kortingN);
  const volleLeads = Math.max(leads - kortingN, 0);
  const feeKorting = kortingLeads * fpl * (1 - kortingPct);
  const feeVol = volleLeads * fpl;
  return { tred, fpl, kortingLeads, volleLeads, feeKorting, feeVol, fee: feeKorting + feeVol };
}

function computeLeadMetrics(monthRows, maandISO, config) {
  const totLeads = monthRows.reduce((s, r) => s + (r.leads || 0), 0);
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;
  const cpl = totLeads > 0 ? adKosten / totLeads : null;

  const berekening = leadFeeBerekening(totLeads, cpl, config);

  const dim = dagenInMaand(maandISO);
  const rijenMetData = monthRows.filter(r => (r.leads || 0) > 0 || (r.meta || 0) > 0 || (r.google || 0) > 0 || (r.microsoft || 0) > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;
  // Projectie: leads/ad-kosten extrapoleren; CPL blijft (schaalt lineair) => zelfde tier.
  const projLeads = dagenVerstreken > 0 ? Math.round(totLeads / dagenVerstreken * dim) : 0;
  const berekeningVerwacht = leadFeeBerekening(projLeads, cpl, config);

  return {
    totLeads, adKosten, totMeta, totGoogle, totMicrosoft, cpl,
    tred: berekening.tred, feePerLead: berekening.fpl,
    kortingLeads: berekening.kortingLeads, volleLeads: berekening.volleLeads,
    feeKorting: berekening.feeKorting, feeVol: berekening.feeVol, fee: berekening.fee,
    projLeads, feeVerwacht: berekeningVerwacht.fee,
    kostenPerLead: cpl,
    dagen, dagenVerstreken, dagenInMaand: dim,
    eerste: dagen ? rijenMetData[0].datum : (monthRows.length ? monthRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (monthRows.length ? monthRows[monthRows.length - 1].datum : null)
  };
}

/* ---------- Vi Lifestyle: new + revived deals ----------
   Fee = €30 per new deal boven de maanddrempel (75) + €10 per revived deal,
   daarna vermenigvuldigd met een CPL-modifier:
     CPL < €250   -> +25%  (×1,25)
     €250–€350    -> normaal (×1,00)
     €350–€500    -> −25%  (×0,75)
     > €500       -> −50%  (×0,50)
   CPL = beheerde ad-kosten ÷ new deals (config.cplBasis: 'new' | 'all' | 'leads').
*/
function cplModifier(cpl, staffel) {
  for (const t of staffel) { if (cpl < t.maxCPL) return t; }
  return staffel[staffel.length - 1];
}

function parseDealsSheet(text, config) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.findIndex(h => h.includes('datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  const iNew = header.findIndex(h => h.includes('new'));
  const iRevived = header.findIndex(h => h.includes('revived') || h.includes('reactiv') || h.includes('herleef'));
  const iLeads = header.findIndex(h => h.includes('lead'));
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
    if (!rijCompleet(cols, [iNew, iRevived, iLeads, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
    rows.push({
      datum,
      newDeals: iNew === -1 ? 0 : Math.round(parseBedrag(cols[iNew])),
      revived: iRevived === -1 ? 0 : Math.round(parseBedrag(cols[iRevived])),
      leads: iLeads === -1 ? 0 : Math.round(parseBedrag(cols[iLeads])),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function dealsFee(newDeals, revived, cpl, config) {
  const feeNew = (config.feePerNew != null ? config.feePerNew : 30);
  const feeRev = (config.feePerRevived != null ? config.feePerRevived : 10);
  const drempel = (config.newDrempel != null ? config.newDrempel : 75);
  const bovenDrempel = Math.max(newDeals - drempel, 0);
  const basisNew = bovenDrempel * feeNew;
  const basisRevived = revived * feeRev;
  const basis = basisNew + basisRevived;
  const mod = (cpl != null) ? cplModifier(cpl, config.cplStaffel) : null;
  const factor = mod ? mod.mod : 1;
  return { bovenDrempel, drempel, basisNew, basisRevived, basis, mod, factor, fee: basis * factor };
}

function computeDealsMetrics(monthRows, maandISO, config) {
  const newDeals = monthRows.reduce((s, r) => s + (r.newDeals || 0), 0);
  const revived = monthRows.reduce((s, r) => s + (r.revived || 0), 0);
  const totLeads = monthRows.reduce((s, r) => s + (r.leads || 0), 0);
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;

  const basis = config.cplBasis || 'new';
  const noemer = basis === 'all' ? (newDeals + revived) : basis === 'leads' ? totLeads : newDeals;
  const cpl = noemer > 0 ? adKosten / noemer : null;

  const berekening = dealsFee(newDeals, revived, cpl, config);

  const dim = dagenInMaand(maandISO);
  const rijenMetData = monthRows.filter(r => (r.newDeals || 0) > 0 || (r.revived || 0) > 0 || (r.meta || 0) > 0 || (r.google || 0) > 0 || (r.microsoft || 0) > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;
  const projNew = dagenVerstreken > 0 ? Math.round(newDeals / dagenVerstreken * dim) : 0;
  const projRevived = dagenVerstreken > 0 ? Math.round(revived / dagenVerstreken * dim) : 0;
  const feeVerwacht = dealsFee(projNew, projRevived, cpl, config).fee;

  return {
    newDeals, revived, totLeads, adKosten, totMeta, totGoogle, totMicrosoft, cpl, cplBasis: basis,
    drempel: berekening.drempel, bovenDrempel: berekening.bovenDrempel,
    basisNew: berekening.basisNew, basisRevived: berekening.basisRevived, basis: berekening.basis,
    mod: berekening.mod, factor: berekening.factor, fee: berekening.fee,
    projNew, projRevived, feeVerwacht,
    dagen, dagenVerstreken, dagenInMaand: dim,
    eerste: dagen ? rijenMetData[0].datum : (monthRows.length ? monthRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (monthRows.length ? monthRows[monthRows.length - 1].datum : null)
  };
}

/* ---------- Krediet Groep Nederland: productie-banden × ROAS ----------
   Fee over 'productie' (bijv. maandelijkse kredietproductie) in banden,
   daarna vermenigvuldigd met een ROAS-factor. ROAS = productie ÷ ad-kosten.
   LET OP: de ROAS-conditie in de brief was tegenstrijdig; hier de logische
   lezing (hoger = beter), volledig configureerbaar via config.roasBanden.
*/
function roasFactor(roas, banden) {
  for (const b of banden) { if (roas >= b.minRoas) return b; }
  return banden[banden.length - 1];
}

function productieFee(productie, banden) {
  let fee = 0;
  const perBand = banden.map(b => {
    const bedrag = Math.max(0, Math.min(productie, b.tot) - b.van);
    const f = bedrag * b.rate;
    fee += f;
    return { van: b.van, tot: b.tot, rate: b.rate, bedrag, fee: f };
  });
  return { fee, perBand };
}

function parseProductionSheet(text, config) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return { rows: [], heeftAdKosten: false };
  const header = splitCsvLine(lines[0]).map(normHeader);
  const iDatum = header.findIndex(h => h.includes('datum'));
  const kolomDatum = iDatum === -1 ? 0 : iDatum;
  const iMeta = header.findIndex(h => h.includes('meta'));
  const iGoogle = header.findIndex(h => h.includes('google'));
  const iMicrosoft = header.findIndex(h => h.includes('microsoft'));
  let iProd = header.findIndex(h => h.includes('productie') || h.includes('production') || h.includes('omzet'));
  if (iProd === -1) {
    for (let j = 0; j < header.length; j++) {
      if (j !== kolomDatum && j !== iMeta && j !== iGoogle && j !== iMicrosoft && header[j] !== '') { iProd = j; break; }
    }
  }
  const heeftAdKosten = iMeta !== -1 || iGoogle !== -1 || iMicrosoft !== -1;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cols = splitCsvLine(lines[i]);
    const datum = parseDatum(cols[kolomDatum]);
    if (!datum) continue;
    if (!rijCompleet(cols, [iProd, iMeta, iGoogle, iMicrosoft])) continue; // alleen volledig gevulde dagen
    rows.push({
      datum,
      productie: iProd === -1 ? 0 : parseBedrag(cols[iProd]),
      meta: iMeta === -1 ? 0 : parseBedrag(cols[iMeta]),
      google: iGoogle === -1 ? 0 : parseBedrag(cols[iGoogle]),
      microsoft: iMicrosoft === -1 ? 0 : parseBedrag(cols[iMicrosoft])
    });
  }
  rows.sort((a, b) => a.datum.localeCompare(b.datum));
  return { rows, heeftAdKosten };
}

function computeProductionMetrics(monthRows, maandISO, config) {
  const productie = monthRows.reduce((s, r) => s + (r.productie || 0), 0);
  const totMeta = monthRows.reduce((s, r) => s + (r.meta || 0), 0);
  const totGoogle = monthRows.reduce((s, r) => s + (r.google || 0), 0);
  const totMicrosoft = monthRows.reduce((s, r) => s + (r.microsoft || 0), 0);
  const adKosten = totMeta + totGoogle + totMicrosoft;
  const roas = adKosten > 0 ? productie / adKosten : null;

  const banden = productieFee(productie, config.productieBanden);
  const rBand = roas != null ? roasFactor(roas, config.roasBanden) : null;
  const rFactor = rBand ? rBand.factor : 1; // geen ad-data -> geen ROAS-correctie
  const fee = banden.fee * rFactor;

  const dim = dagenInMaand(maandISO);
  const rijenMetData = monthRows.filter(r => (r.productie || 0) > 0 || (r.meta || 0) > 0 || (r.google || 0) > 0 || (r.microsoft || 0) > 0);
  const dagen = rijenMetData.length;
  const dagenVerstreken = dagen ? Number(rijenMetData[dagen - 1].datum.slice(8, 10)) : 0;
  const projProductie = dagenVerstreken > 0 ? productie / dagenVerstreken * dim : 0;
  const projBanden = productieFee(projProductie, config.productieBanden);
  const feeVerwacht = projBanden.fee * rFactor; // ROAS schaalt lineair -> zelfde factor

  return {
    productie, adKosten, totMeta, totGoogle, totMicrosoft, roas,
    feeRaw: banden.fee, perBand: banden.perBand, roasBand: rBand, roasFactor: rFactor, fee,
    projProductie, feeVerwacht,
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

// ---------- Kwartalen (Lazy Susan) ----------
function kwartaalVan(datumIso) {
  const [y, m] = String(datumIso).split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
function beschikbareKwartalen(rows) {
  return [...new Set(rows.map(r => kwartaalVan(r.datum)))].sort();
}
function huidigKwartaalISO(nu) {
  const d = nu || new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
function kiesKwartaal(rows, gewenst) {
  const ks = beschikbareKwartalen(rows);
  if (!ks.length) return null;
  const doel = gewenst || huidigKwartaalISO();
  return ks.includes(doel) ? doel : ks[ks.length - 1];
}
function filterKwartaal(rows, kwartaalISO) {
  if (!kwartaalISO) return rows.slice();
  return rows.filter(r => kwartaalVan(r.datum) === kwartaalISO);
}
function kwartaalLabel(kwartaalISO) {
  const [y, q] = kwartaalISO.split('-Q');
  return `Q${q} ${y}`;
}
function dagenInKwartaal(kwartaalISO) {
  const [y, q] = kwartaalISO.split('-Q').map(Number);
  const startM = (q - 1) * 3; // 0-based eerste maand
  let d = 0;
  for (let mm = startM; mm < startM + 3; mm++) d += new Date(y, mm + 1, 0).getDate();
  return d;
}
function dagVanKwartaal(datumIso) {
  const [y, m, d] = datumIso.split('-').map(Number);
  const startM = Math.floor((m - 1) / 3) * 3; // 0-based eerste maand van dit kwartaal
  let offset = 0;
  for (let mm = startM; mm < m - 1; mm++) offset += new Date(y, mm + 1, 0).getDate();
  return offset + d;
}

/* Lazy Susan: per-kwartaal fee. Getrapt op doelbereik (netto-omzet ÷ kwartaaltarget):
     < drempelStart (85%)       -> 0%
     drempelStart–drempelVol    -> rateTussen (5%)
     > drempelVol (100%)         -> rateBoven (6%)
   Fee over de volledige netto-omzet, in £, daarna × wisselkoers -> €.
   Omzet in de sheet is bruto incl. btw (÷(1+btwTarief) = netto). Pace-projectie
   naar kwartaaleinde. Geen kanalen/ad-kosten.
*/
function computeLazyMetrics(qRows, kwartaalISO, config) {
  const btw = config && config.btwTarief != null ? config.btwTarief : 0.20;
  const koers = config && config.wisselkoers != null ? config.wisselkoers : 1;
  const target = config && config.kwartaalTargetNetto != null ? config.kwartaalTargetNetto : null;
  const f = (config && config.fee) || {};
  const dStart = f.drempelStart != null ? f.drempelStart : 0.85;
  const dVol = f.drempelVol != null ? f.drempelVol : 1.00;
  const rTussen = f.rateTussen != null ? f.rateTussen : 0.05;
  const rBoven = f.rateBoven != null ? f.rateBoven : 0.06;

  const brutoOmzet = qRows.reduce((s, r) => s + (r.omzet || 0), 0);
  const nettoOmzet = brutoOmzet / (1 + btw);

  function rateVoor(pct) {
    if (pct == null) return 0;
    if (pct > dVol) return rBoven;
    if (pct >= dStart) return rTussen;
    return 0;
  }
  function feeVoor(netto) {
    if (target == null) return null;
    const pct = netto / target;
    const rate = rateVoor(pct);
    const feeGBP = rate * netto;
    return { pct, rate, feeGBP, fee: feeGBP * koers };
  }

  const dim = dagenInKwartaal(kwartaalISO);
  const rijenMetData = qRows.filter(r => (r.omzet || 0) > 0);
  const dagen = rijenMetData.length;
  const dagVerstreken = dagen ? dagVanKwartaal(rijenMetData[dagen - 1].datum) : 0;
  const projBruto = dagVerstreken > 0 ? brutoOmzet / dagVerstreken * dim : 0;
  const projNetto = projBruto / (1 + btw);

  const nu = feeVoor(nettoOmzet);
  const verwacht = feeVoor(projNetto);

  return {
    brutoOmzet, nettoOmzet, target, btw, koers,
    pct: nu ? nu.pct : null, rate: nu ? nu.rate : 0,
    feeGBP: nu ? nu.feeGBP : 0, fee: nu ? nu.fee : 0, // fee = € ; feeGBP = £
    projNetto, projPct: verwacht ? verwacht.pct : null, feeVerwacht: verwacht ? verwacht.fee : 0,
    drempelStart: dStart, drempelVol: dVol, rateTussen: rTussen, rateBoven: rBoven,
    dagen, dagVerstreken, dagenInKwartaal: dim,
    eerste: dagen ? rijenMetData[0].datum : (qRows.length ? qRows[0].datum : null),
    laatste: dagen ? rijenMetData[dagen - 1].datum : (qRows.length ? qRows[qRows.length - 1].datum : null)
  };
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

// ---------- Knop naar de gekoppelde CSV ----------
// Voegt op elk klant-dashboard (waar een CONFIG met csvUrl bestaat) een knop toe
// naar de gekoppelde CSV/sheet. Draait niet op het overzicht (geen CONFIG).
function injectSheetKnop() {
  if (typeof CONFIG === 'undefined' || !CONFIG || !CONFIG.csvUrl) return;
  const controls = document.querySelector('.controls');
  if (!controls || document.getElementById('sheetKnop')) return;
  const a = document.createElement('a');
  a.id = 'sheetKnop';
  // De pub?output=csv-link dwingt een download af; de pubhtml-variant opent de
  // gepubliceerde sheet als weergave-pagina in een nieuw tabblad.
  a.href = CONFIG.csvUrl.replace(/pub\?output=csv\b.*/i, 'pubhtml');
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Sheet ↗';
  a.title = 'Open de gekoppelde sheet van deze klant in een nieuw tabblad';
  a.style.cssText = 'display:inline-flex;align-items:center;text-decoration:none;' +
    'background:var(--card);color:var(--text);border:1px solid var(--border);' +
    'border-radius:10px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;' +
    'box-shadow:var(--shadow);cursor:pointer;';
  a.addEventListener('mouseenter', () => { a.style.color = 'var(--accent)'; a.style.borderColor = 'var(--accent)'; });
  a.addEventListener('mouseleave', () => { a.style.color = 'var(--text)'; a.style.borderColor = 'var(--border)'; });
  controls.insertBefore(a, controls.firstChild);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSheetKnop);
  else injectSheetKnop();
}
