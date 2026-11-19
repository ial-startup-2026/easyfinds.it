import { SCAN } from "@/config/app";
import { leggiTesto } from "./testo";
import type { EsitoLettura } from "./tipi";

/** Testo minimo perché valga la pena di cercarci dentro una scadenza. */
const TESTO_MINIMO = 6;

/**
 * Legge la foto di un'etichetta direttamente nel browser (OCR gratuito, Tesseract.js): niente server,
 * niente chiavi, niente costi. La prima volta scarica i dati della lingua italiana (qualche MB),
 * poi il browser li tiene in memoria. Il peso del motore si carica solo qui, al primo uso.
 */
export async function leggiConOcr(foto: Blob, segnale?: AbortSignal, adesso: Date = new Date()): Promise<EsitoLettura> {
  const fine = segnale ? AbortSignal.any([segnale, AbortSignal.timeout(SCAN.timeoutMs)]) : AbortSignal.timeout(SCAN.timeoutMs);
  if (fine.aborted) return { ok: false, motivo: "errore" };

  let worker: { recognize: (f: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null = null;
  const ferma = () => void worker?.terminate().catch(() => undefined);
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker(SCAN.lingua);
    fine.addEventListener("abort", ferma, { once: true });
    if (fine.aborted) return { ok: false, motivo: "errore" };

    const { data } = await worker.recognize(foto);
    if (fine.aborted) return { ok: false, motivo: "errore" };
    if (data.text.replace(/\s/g, "").length < TESTO_MINIMO) return { ok: false, motivo: "nessun_testo" };
    return { ok: true, lettura: leggiTesto(data.text, adesso), origine: "ocr" };
  } catch {
    return { ok: false, motivo: "errore" };
  } finally {
    fine.removeEventListener("abort", ferma);
    ferma();
  }
}
