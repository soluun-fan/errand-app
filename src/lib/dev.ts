import "server-only";

/** Development only: show OTP codes on screen instead of sending SMS. Never enable where real users can reach. */
export const devShowSmsCodes = () => process.env.DEV_SHOW_SMS_CODES === "true";

/** The component gallery (/dev/ui) is available in development or when codes are shown. */
export const devToolsEnabled = () => process.env.NODE_ENV !== "production" || devShowSmsCodes();
