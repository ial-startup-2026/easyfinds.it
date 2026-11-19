import { describe, expect, it } from "vitest";
import { lettureDiProva, prossimaLetturaDiProva } from "./mock";
import { analizzaPreferenze, PREFERENZE_DEFAULT } from "./preferenze";
import { normalizzaLettura, type RispostaModello } from "./schema";
import type { Lettura } from "./tipi";
import { valutaLettura } from "./valutazione";

const ADESSO = new Date("2026-10-27T11:00:00Z"); // 27 ottobre 2026, 12:00 a Roma

const risposta = (over: Partial<RispostaModello> = {}): RispostaModello => ({
  nome: "Burrata",
  data_scadenza: "2026-11-02",
  lotto: "L1",
  allergeni: ["latte"],
  quantita: 125,
  unita: "g",
  confidenza: { nome: 0.95, data_scadenza: 0.9, lotto: 0.8, allergeni: 0.9, quantita: 0.9, globale: 0.9 },
  ...over,
});

describe("normalizzaLettura", () => {
  it("lascia passare una lettura buona, ripulendo i testi", () => {
    const l = normalizzaLettura(risposta({ nome: "  Burrata   di  Andria ", lotto: " L1 " }), ADESSO);
    expect(l).toMatchObject({ nome: "Burrata di Andria", lotto: "L1", data_scadenza: "2026-11-02", quantita: 125, unita: "g" });
  });

  it("una data che non esiste o non è plausibile diventa null con confidenza 0", () => {
    for (const data of ["2026-02-30", "12/11/2026", "", "2099-01-01", "2015-01-01"]) {
      const l = normalizzaLettura(risposta({ data_scadenza: data }), ADESSO);
      expect(l.data_scadenza, data).toBeNull();
      expect(l.confidenza.data_scadenza).toBe(0);
    }
    expect(normalizzaLettura(risposta({ data_scadenza: null }), ADESSO).data_scadenza).toBeNull();
  });

  it("una scadenza già passata da poco resta valida (prodotto scaduto da buttare)", () => {
    expect(normalizzaLettura(risposta({ data_scadenza: "2026-10-20" }), ADESSO).data_scadenza).toBe("2026-10-20");
  });

  it("quantità: solo positiva e con unità", () => {
    expect(normalizzaLettura(risposta({ quantita: 0 }), ADESSO).quantita).toBeNull();
    expect(normalizzaLettura(risposta({ quantita: -3 }), ADESSO).quantita).toBeNull();
    const senzaUnita = normalizzaLettura(risposta({ unita: null }), ADESSO);
    expect(senzaUnita.quantita).toBeNull();
    expect(senzaUnita.unita).toBeNull();
    expect(senzaUnita.confidenza.quantita).toBe(0);
  });

  it("nome vuoto → null; confidenze fuori scala vengono riportate tra 0 e 1; allergeni senza doppioni", () => {
    const l = normalizzaLettura(
      risposta({
        nome: "   ",
        allergeni: ["latte", "latte", "uova"],
        confidenza: { nome: 0.9, data_scadenza: 1.7, lotto: -2, allergeni: Number.NaN, quantita: 0.5, globale: 0.5 },
      }),
      ADESSO,
    );
    expect(l.nome).toBeNull();
    expect(l.confidenza).toMatchObject({ nome: 0, data_scadenza: 1, lotto: 0, allergeni: 0 });
    expect(l.allergeni).toEqual(["latte", "uova"]);
  });
});

describe("valutaLettura", () => {
  const base: Lettura = {
    nome: "Burrata",
    data_scadenza: "2026-11-02",
    lotto: "L1",
    allergeni: ["latte"],
    quantita: 125,
    unita: "g",
    confidenza: { nome: 0.95, data_scadenza: 0.9, lotto: 0.8, allergeni: 0.9, quantita: 0.9, globale: 0.9 },
  };

  it("una lettura sicura non segnala nulla", () => {
    const v = valutaLettura(base);
    expect(v.daControllare.size).toBe(0);
    expect(v.bassaConfidenza).toBe(false);
  });

  it("segnala nome, scadenza e allergeni se mancano o sono dubbi", () => {
    const v = valutaLettura({ ...base, nome: null, data_scadenza: null, confidenza: { ...base.confidenza, allergeni: 0.3 } });
    expect([...v.daControllare].sort()).toEqual(["allergeni", "data_scadenza", "nome"]);
    expect(v.bassaConfidenza).toBe(true);
  });

  it("lotto e quantità assenti non sono un problema; letti con poca sicurezza sì", () => {
    expect(valutaLettura({ ...base, lotto: null, quantita: null, unita: null, confidenza: { ...base.confidenza, lotto: 0, quantita: 0 } }).daControllare.size).toBe(0);
    const v = valutaLettura({ ...base, confidenza: { ...base.confidenza, lotto: 0.4, quantita: 0.5 } });
    expect([...v.daControllare].sort()).toEqual(["lotto", "quantita"]);
    expect(v.bassaConfidenza).toBe(false); // non sono campi importanti
  });

  it("allergeni con lista vuota ma lettura incerta vanno segnalati (non significa 'senza allergeni')", () => {
    const v = valutaLettura({ ...base, allergeni: [], confidenza: { ...base.confidenza, allergeni: 0 } });
    expect(v.daControllare.has("allergeni")).toBe(true);
  });

  it("la confidenza globale bassa basta a dare l'avviso", () => {
    expect(valutaLettura({ ...base, confidenza: { ...base.confidenza, globale: 0.4 } }).bassaConfidenza).toBe(true);
  });
});

describe("letture di prova", () => {
  it("sono tutte valide secondo lo stesso schema usato per le letture vere", () => {
    for (const lettura of lettureDiProva(ADESSO)) {
      if (!lettura) continue;
      const comeRispostaModello = { ...lettura } as RispostaModello;
      expect(normalizzaLettura(comeRispostaModello, ADESSO)).toEqual(lettura);
    }
  });

  it("coprono i casi difficili: data dubbia, allergeni dubbi, lettura fallita", () => {
    const elenco = lettureDiProva(ADESSO);
    expect(elenco.some((l) => l === null)).toBe(true);
    expect(elenco.some((l) => l && valutaLettura(l).daControllare.has("data_scadenza"))).toBe(true);
    expect(elenco.some((l) => l && valutaLettura(l).daControllare.has("allergeni"))).toBe(true);
    expect(elenco.some((l) => l && valutaLettura(l).daControllare.size === 0)).toBe(true);
  });

  it("ruotano e segnano l'origine 'prova'", () => {
    const esiti = Array.from({ length: 6 }, () => prossimaLetturaDiProva(ADESSO));
    expect(esiti.filter((e) => e.ok).every((e) => e.ok && e.origine === "prova")).toBe(true);
    expect(esiti.some((e) => !e.ok)).toBe(true);
  });
});

describe("analizzaPreferenze", () => {
  it("legge valori validi", () => {
    expect(analizzaPreferenze(JSON.stringify({ posizione: "freezer", categoria: "carne", continua: true }))).toEqual({
      posizione: "freezer",
      categoria: "carne",
      continua: true,
    });
  });

  it("scarta valori sconosciuti, testo rotto e assenza di dati", () => {
    expect(analizzaPreferenze(JSON.stringify({ posizione: "garage", categoria: 5, continua: "sì" }))).toEqual(PREFERENZE_DEFAULT);
    expect(analizzaPreferenze("{rotto")).toEqual(PREFERENZE_DEFAULT);
    expect(analizzaPreferenze(null)).toEqual(PREFERENZE_DEFAULT);
  });
});
