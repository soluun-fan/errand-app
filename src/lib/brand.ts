/**
 * The app's name, in one place (owner, 2026-11-20: "Guigere"; V1 spec: "use a constant APP_NAME").
 * Texts get it as {app} from `common.app` in src/i18n (Mongolian sentences put case endings on
 * "апп", so a new name needs no grammar changes). Latin letters where Cyrillic doesn't fit: SMS
 * (one message on every phone), payment descriptions, web addresses.
 */
export const APP_NAME = "Guigere";
export const APP_NAME_LATIN = "Guigere";

/** The letter in the orange app mark (login, top bars, footer). */
export const APP_MARK = APP_NAME_LATIN.charAt(0).toUpperCase();
