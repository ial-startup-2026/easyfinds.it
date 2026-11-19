import type { CodiceAllergene } from "@/lib/costanti/allergeni";
import type { CodiceUnita } from "@/lib/costanti/unita";
import { normalizzaLettura, type RispostaModello } from "./schema";
import type { Lettura } from "./tipi";

/**
 * Trasforma il testo letto da una foto (OCR) in una `Lettura`. Funzione pura e prudente: l'OCR sbaglia,
 * quindi nome e allergeni escono sempre con confidenza bassa (la schermata li segna "Da controllare")
 * e un dato che non si riconosce resta vuoto invece di essere inventato.
 */

const MESI: Record<string, number> = {
  gen: 1, gennaio: 1, feb: 2, febbraio: 2, mar: 3, marzo: 3, apr: 4, aprile: 4, mag: 5, maggio: 5, giu: 6, giugno: 6,
  lug: 7, luglio: 7, ago: 8, agosto: 8, set: 9, sett: 9, settembre: 9, ott: 10, ottobre: 10, nov: 11, novembre: 11, dic: 12, dicembre: 12,
};

const PAROLE_SCADENZA = /(scad|entro|tmc|consumars|consumare|use by|best before|exp\b)/i;
const PAROLE_PRODUZIONE = /(produz|prodott|confez|packed|mfg|imbott)/i;

const due = (n: number) => String(n).padStart(2, "0");
const anno4 = (a: number) => (a < 100 ? 2000 + a : a);
const ultimoGiorno = (anno: number, mese: number) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();

type DataTrovata = { iso: string; posizione: number; esatta: boolean };

function dateNelTesto(originale: string): DataTrovata[] {
  const trovate: DataTrovata[] = [];
  const aggiungi = (anno: number, mese: number, giorno: number | null, posizione: number) => {
    if (mese < 1 || mese > 12) return;
    const g = giorno ?? ultimoGiorno(anno, mese);
    if (g < 1 || g > ultimoGiorno(anno, mese)) return;
    trovate.push({ iso: `${anno}-${due(mese)}-${due(g)}`, posizione, esatta: giorno !== null });
  };
  // Il pezzo già riconosciuto come data si cancella (stessa lunghezza): "12 dicembre 2026" non conta anche come "dicembre 2026".
  let testo = originale;
  const consuma = (m: RegExpMatchArray) => {
    testo = testo.slice(0, m.index) + " ".repeat(m[0].length) + testo.slice(m.index! + m[0].length);
  };

  // 02/11/2026, 02-11-26, 02.11.2026
  for (const m of [...testo.matchAll(/(?<!\d)(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})(?!\d)/g)]) {
    aggiungi(anno4(Number(m[3])), Number(m[2]), Number(m[1]), m.index);
    consuma(m);
  }
  // 02 nov 2026, 2 novembre 26
  for (const m of [...testo.matchAll(/(?<!\d)(\d{1,2})\s*([a-zà]{3,9})\.?\s*(\d{4}|\d{2})(?!\d)/gi)]) {
    const mese = MESI[m[2]!.toLowerCase()];
    if (!mese) continue;
    aggiungi(anno4(Number(m[3])), mese, Number(m[1]), m.index);
    consuma(m);
  }
  // 11/2026, 11.2026 → ultimo giorno del mese (solo mese e anno)
  for (const m of [...testo.matchAll(/(?<![\d/.\-])(\d{1,2})\s*[/.\-]\s*(\d{4})(?!\d)/g)]) {
    aggiungi(Number(m[2]), Number(m[1]), null, m.index);
    consuma(m);
  }
  // nov 2026, novembre 2026
  for (const m of [...testo.matchAll(/(?<![\da-zà])([a-zà]{3,9})\.?\s+(\d{4})(?!\d)/gi)]) {
    const mese = MESI[m[1]!.toLowerCase()];
    if (mese) aggiungi(Number(m[2]), mese, null, m.index);
  }
  return trovate;
}

/** La data di scadenza e quanto ci si fida: vicino a "scad./entro/TMC" è sicura, altrimenti si segnala. */
function scadenza(testo: string): { data: string | null; confidenza: number } {
  const date = dateNelTesto(testo);
  if (date.length === 0) return { data: null, confidenza: 0 };

  const vicino = (d: DataTrovata) => testo.slice(Math.max(0, d.posizione - 45), d.posizione);
  const conParola = date.filter((d) => PAROLE_SCADENZA.test(vicino(d)) && !PAROLE_PRODUZIONE.test(vicino(d).slice(-18)));
  if (conParola.length > 0) {
    const scelta = conParola.sort((a, b) => (a.iso < b.iso ? 1 : -1))[0]!;
    return { data: scelta.iso, confidenza: scelta.esatta ? 0.85 : 0.7 };
  }
  const nonProduzione = date.filter((d) => !PAROLE_PRODUZIONE.test(vicino(d)));
  const candidate = nonProduzione.length > 0 ? nonProduzione : date;
  const scelta = [...candidate].sort((a, b) => (a.iso < b.iso ? 1 : -1))[0]!;
  return { data: scelta.iso, confidenza: candidate.length === 1 ? 0.5 : 0.4 };
}

function lotto(testo: string): { lotto: string | null; confidenza: number } {
  const m = testo.match(/\b(?:lotto|lot|l)\b\s*[:.nº°\-]*\s*([A-Z0-9][A-Z0-9\-/.]{2,19})/i);
  const valore = m?.[1]?.replace(/[.\-/]+$/, "");
  return valore && /\d/.test(valore) ? { lotto: valore.toUpperCase(), confidenza: 0.7 } : { lotto: null, confidenza: 0 };
}

const ALLERGENI_PAROLE: [CodiceAllergene, RegExp][] = [
  ["glutine", /glutine|frumento|grano|orzo|segale|avena|farro|kamut|semola|farina di (?:grano|frumento)/i],
  ["crostacei", /crostace|gamber|scamp|aragost|granchi/i],
  ["uova", /\buov[oa]\b|\btuorl|albume/i],
  ["pesce", /\bpesce|merluzz|salmon|tonno|acciug|alici|sardin/i],
  ["arachidi", /arachid/i],
  ["soia", /\bsoia|\bsoya/i],
  ["latte", /\blatte|lattosio|\bsiero|\bburro|\bpanna\b|\bcaseina|formaggi|mozzarell|ricotta|yogurt/i],
  ["frutta_a_guscio", /frutta a guscio|mandorl|nocciol|\bnoci\b|pistacchi|anacard|noce pecan|macadamia/i],
  ["sedano", /sedano/i],
  ["senape", /senape/i],
  ["sesamo", /sesamo/i],
  ["solfiti", /solfit|anidride solforosa|\bE22[0-8]\b/i],
  ["lupini", /lupin/i],
  ["molluschi", /mollusch|cozze|vongole|calamar|polpo|seppia/i],
];

const UNITA_ALIAS: Record<string, { unita: CodiceUnita; fattore: number }> = {
  kg: { unita: "kg", fattore: 1 },
  g: { unita: "g", fattore: 1 },
  gr: { unita: "g", fattore: 1 },
  l: { unita: "l", fattore: 1 },
  lt: { unita: "l", fattore: 1 },
  litri: { unita: "l", fattore: 1 },
  ml: { unita: "ml", fattore: 1 },
  cl: { unita: "ml", fattore: 10 },
  pz: { unita: "pz", fattore: 1 },
  pezzi: { unita: "pz", fattore: 1 },
};

function quantita(testo: string): { quantita: number | null; unita: CodiceUnita | null; confidenza: number } {
  const nessuna = { quantita: null, unita: null, confidenza: 0 };
  let migliore: { quantita: number; unita: CodiceUnita; netto: boolean } | null = null;
  for (const m of testo.matchAll(/(?<![\d,.])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|lt|litri|l|pezzi|pz)\b\.?\s*e?/gi)) {
    const prima = testo.slice(Math.max(0, m.index - 14), m.index);
    if (/per\s*$|ogni\s*$|100\s*$/i.test(prima)) continue; // "per 100 g": valori nutrizionali
    const alias = UNITA_ALIAS[m[2]!.toLowerCase()];
    const valore = Number(m[1]!.replace(",", "."));
    if (!alias || !(valore > 0)) continue;
    const netto = /netto|net\b|peso|quantit|contenuto/i.test(testo.slice(Math.max(0, m.index - 24), m.index));
    if (!migliore || (netto && !migliore.netto)) migliore = { quantita: valore * alias.fattore, unita: alias.unita, netto };
  }
  return migliore ? { quantita: migliore.quantita, unita: migliore.unita, confidenza: migliore.netto ? 0.7 : 0.5 } : nessuna;
}

const NON_NOME = /(scad|entro|lotto|ingredient|peso|netto|conserv|prodott|via |italia|www\.|tel|cod|allergen|valori|energia|\d{4})/i;

/** Il nome è la prima riga che sembra un nome di prodotto: è un'ipotesi, quindi confidenza bassa. */
function nome(testo: string): string | null {
  for (const riga of testo.split("\n")) {
    const pulita = riga.replace(/[^A-Za-zÀ-ÿ0-9' %\-]/g, " ").replace(/\s+/g, " ").trim();
    const lettere = pulita.replace(/[^A-Za-zÀ-ÿ]/g, "").length;
    if (lettere < 4 || pulita.length > 60 || lettere / pulita.replace(/\s/g, "").length < 0.75 || NON_NOME.test(pulita)) continue;
    return pulita;
  }
  return null;
}

export function leggiTesto(testo: string, adesso: Date): Lettura {
  const s = scadenza(testo);
  const l = lotto(testo);
  const q = quantita(testo);
  const n = nome(testo);
  const allergeni = ALLERGENI_PAROLE.filter(([, parole]) => parole.test(testo)).map(([codice]) => codice);

  const grezza: RispostaModello = {
    nome: n,
    data_scadenza: s.data,
    lotto: l.lotto,
    allergeni,
    quantita: q.quantita,
    unita: q.unita,
    confidenza: {
      nome: n ? 0.4 : 0,
      data_scadenza: s.confidenza,
      lotto: l.confidenza,
      // Sotto la soglia (0.6): gli allergeni letti da un OCR vanno sempre ricontrollati sull'etichetta.
      allergeni: 0.5,
      quantita: q.confidenza,
      globale: s.data ? 0.5 : 0.2,
    },
  };
  return normalizzaLettura(grezza, adesso);
}
