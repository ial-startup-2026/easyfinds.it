import { SCAN } from "@/config/app";
import { registraProdotto } from "@/app/scansiona/azioni";
import { ridimensionaImmagine } from "@/lib/immagini";
import { leggiConOcr } from "@/lib/scan/ocr";
import type { ServiziScansione } from "@/lib/scan/tipi";
import { creaClientBrowser } from "@/lib/supabase/client";

/**
 * Servizi della vera app: la foto si legge nel browser (OCR gratuito), la foto dell'etichetta
 * si archivia in Storage e il prodotto si registra con una Server Action.
 * In modalità demo non c'è archivio: la foto non si salva.
 */
export function creaServiziApp(localeId: string, demo: boolean): ServiziScansione {
  return {
    comprimi: (file) => ridimensionaImmagine(file, { latoMax: SCAN.latoMaxPx, qualita: SCAN.qualitaJpeg }),

    leggi: (foto, segnale) => leggiConOcr(foto, segnale),

    async salva(dati, foto) {
      let fotoPath: string | null = null;
      let avviso: string | undefined;

      if (foto && !demo) {
        const percorso = `${localeId}/${dati.clientUuid}.jpg`;
        const { error } = await creaClientBrowser()
          .storage.from("etichette")
          .upload(percorso, foto, { contentType: "image/jpeg" });
        // Se un invio precedente aveva già caricato la foto, il file c'è: va bene lo stesso.
        if (!error || /already exists|duplicate/i.test(error.message)) fotoPath = percorso;
        else avviso = "Il prodotto è salvato, ma non sono riuscito a salvare la foto dell'etichetta.";
      }

      const esito = await registraProdotto({ ...dati, fotoPath });
      return esito.ok ? { ok: true, prodottoId: esito.prodottoId, avviso } : { ok: false, errore: esito.errore };
    },
  };
}
