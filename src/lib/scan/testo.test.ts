import { describe, expect, it } from "vitest";
import { valutaLettura } from "./valutazione";
import { leggiTesto } from "./testo";

const ADESSO = new Date("2026-10-27T11:00:00Z");

const ETICHETTA = `BURRATA DI ANDRIA
Ingredienti: latte vaccino pastorizzato, panna, sale, caglio.
Peso netto 125 g e
Da consumarsi entro il 02/11/2026
Lotto L2611B
Prodotto e confezionato il 20/10/2026
Valori nutrizionali per 100 g: energia 1100 kJ`;

describe("leggiTesto", () => {
  it("legge i dati principali di un'etichetta tipica", () => {
    const l = leggiTesto(ETICHETTA, ADESSO);
    expect(l).toMatchObject({ nome: "BURRATA DI ANDRIA", data_scadenza: "2026-11-02", lotto: "L2611B", quantita: 125, unita: "g" });
    expect(l.allergeni).toEqual(["latte"]);
  });

  it("la data accanto a 'scadenza' vince su quella di produzione, anche se è più lontana nel testo", () => {
    expect(leggiTesto("Prodotto il 20/10/2026\nScad. 15.11.26", ADESSO).data_scadenza).toBe("2026-11-15");
    expect(leggiTesto("Scad. 15/11/2026\nConfezionato il 25/10/2026", ADESSO).data_scadenza).toBe("2026-11-15");
  });

  it("capisce i mesi scritti a parole e 'mese/anno' (ultimo giorno del mese)", () => {
    expect(leggiTesto("TMC 12 dicembre 2026", ADESSO).data_scadenza).toBe("2026-12-12");
    expect(leggiTesto("Da consumarsi preferibilmente entro fine: 12.2026", ADESSO).data_scadenza).toBe("2026-12-31");
    expect(leggiTesto("Scad. 02/2028", ADESSO).data_scadenza).toBe("2028-02-29");
  });

  it("senza parola chiave la data è dubbia (da controllare)", () => {
    const l = leggiTesto("Pasta fresca\n18/11/2026", ADESSO);
    expect(l.data_scadenza).toBe("2026-11-18");
    expect(l.confidenza.data_scadenza).toBeLessThan(0.6);
    expect(valutaLettura(l).daControllare.has("data_scadenza")).toBe(true);
  });

  it("una data impossibile non viene inventata", () => {
    const l = leggiTesto("Scad. 31/02/2026", ADESSO);
    expect(l.data_scadenza).toBeNull();
    expect(l.confidenza.data_scadenza).toBe(0);
  });

  it("nome e allergeni vanno sempre ricontrollati, anche quando sembrano giusti", () => {
    const v = valutaLettura(leggiTesto(ETICHETTA, ADESSO));
    expect(v.daControllare.has("nome")).toBe(true);
    expect(v.daControllare.has("allergeni")).toBe(true);
    expect(v.bassaConfidenza).toBe(true);
  });

  it("riconosce gli allergeni dalle parole dell'etichetta", () => {
    const l = leggiTesto("Ingredienti: farina di frumento, uova, olio di soia, mandorle, anidride solforosa", ADESSO);
    expect(l.allergeni).toEqual(expect.arrayContaining(["glutine", "uova", "soia", "frutta_a_guscio", "solfiti"]));
  });

  it("quantità: converte cl in ml e ignora i valori 'per 100 g'", () => {
    expect(leggiTesto("Contenuto netto 75 cl", ADESSO)).toMatchObject({ quantita: 750, unita: "ml" });
    const l = leggiTesto("Valori medi per 100 g\nPeso netto 1,5 kg", ADESSO);
    expect(l).toMatchObject({ quantita: 1.5, unita: "kg" });
  });

  it("testo senza dati utili: tutto vuoto, nessuna invenzione", () => {
    const l = leggiTesto("§§ ~~ ..", ADESSO);
    expect(l).toMatchObject({ nome: null, data_scadenza: null, lotto: null, quantita: null, unita: null, allergeni: [] });
  });
});
