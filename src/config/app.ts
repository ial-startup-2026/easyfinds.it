/** Configurazione dell'app. Il nome è provvisorio: cambia solo qui. */
export const APP_NAME = "easyfinds.it";
export const APP_DESCRIPTION =
  "Il magazzino della tua cucina: cosa c'è, dove e fino a quando.";

export const LOCALE = "it-IT";
export const TIMEZONE = "Europe/Rome";

/**
 * Colori usati dal sistema operativo (barra di stato, schermata di avvio).
 * Devono coincidere con --background in globals.css
 * (lo verifica src/lib/design/token.test.ts).
 */
export const COLORI_PWA = {
  chiaro: { tema: "#ececf1", sfondo: "#ececf1" },
  scuro: { tema: "#0d0d11", sfondo: "#0d0d11" },
} as const;

/** Lettura delle etichette: la foto si riduce e si legge nel browser (OCR gratuito, nessun server). */
export const SCAN = {
  /** Lato lungo massimo dell'immagine inviata, in pixel. */
  latoMaxPx: 1600,
  qualitaJpeg: 0.8,
  /** Sotto questa confidenza (0-1) un campo va ricontrollato a mano. */
  confidenzaMinima: 0.6,
  /** Lingua dell'OCR (dati scaricati dal browser la prima volta). */
  lingua: "ita",
  /** Attesa massima per una lettura, in millisecondi: la prima volta include il download dei dati della lingua. */
  timeoutMs: 90_000,
} as const;

