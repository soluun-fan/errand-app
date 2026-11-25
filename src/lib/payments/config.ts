export type ProviderName = "mock" | "wire" | "disabled";

type PaymentEnvironment = Partial<
  Record<"NODE_ENV" | "APP_ENV" | "VERCEL_ENV" | "PAYMENT_PROVIDER" | "WIRE_SECRET_KEY" | "WIRE_WEBHOOK_SECRET", string>
>;

/** Shared by runtime and deployment checks. Missing or invalid production settings disable payments. */
export function paymentConfiguration(env: PaymentEnvironment, deployment = false): { provider: ProviderName; errors: string[] } {
  const production = deployment || env.NODE_ENV === "production" || env.APP_ENV === "production" || env.VERCEL_ENV === "production";
  const provider = env.PAYMENT_PROVIDER?.trim() || (production ? "" : "mock");
  const errors: string[] = [];
  if (env.APP_ENV && !["development", "staging", "production"].includes(env.APP_ENV)) {
    errors.push("APP_ENV must be development, staging, or production");
  }
  if (provider === "wire") {
    for (const key of ["WIRE_SECRET_KEY", "WIRE_WEBHOOK_SECRET"] as const) {
      if (!env[key]?.trim()) errors.push(`${key} is required when PAYMENT_PROVIDER=wire`);
    }
  } else if (provider === "mock") {
    if (production && (env.APP_ENV !== "staging" || env.VERCEL_ENV === "production")) {
      errors.push("Mock payments are forbidden in production; isolated staging must explicitly set APP_ENV=staging");
    }
  } else {
    errors.push("PAYMENT_PROVIDER must explicitly be wire in production, or mock in isolated staging");
  }
  return { provider: errors.length ? "disabled" : (provider as Exclude<ProviderName, "disabled">), errors };
}
