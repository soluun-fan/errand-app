import { paymentConfiguration } from "./config";

/** Simulated invoices for development and explicitly isolated staging. Real payments use service.ts. */
export interface AccountRef {
  userId: string;
}

export interface Invoice {
  invoiceId: string;
  dealId: string;
  amount: number;
  /** What the QR code encodes (QPay returns this for the payer's bank app). */
  qrText: string;
}

export interface PaymentProvider {
  readonly name: "mock" | "qpay";
  /** `purpose` separates a deal's first payment from later ones (an over-budget top-up). */
  createInvoice(dealId: string, amount: number, purpose?: string): Promise<Invoice>;
  // The provider calls our webhook when paid → we verify it, then run confirm_payment.
  release(dealId: string, payouts: { to: AccountRef; amount: number }[]): Promise<void>;
  refund(dealId: string, amount: number, to: AccountRef): Promise<void>;
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  async createInvoice(dealId, amount, purpose) {
    if (!mockPaymentsEnabled()) throw new Error("Simulated payments are disabled");
    // One invoice per deal + purpose: pressing "pay" twice reuses it, so the payment is booked once.
    const invoiceId = purpose ? `mock-inv-${dealId}-${purpose}` : `mock-inv-${dealId}`;
    return { invoiceId, dealId, amount, qrText: `MOCK-QPAY|${invoiceId}|${amount}` };
  },
  async release() {
    // Mock: money movements are recorded in our ledger only.
  },
  async refund() {
    // Mock: as above.
  },
};

/** Runtime enforcement, also used by every simulate-payment server action. */
export function mockPaymentsEnabled(): boolean {
  return paymentConfiguration(process.env).provider === "mock";
}

export function paymentProvider(): PaymentProvider {
  if (mockPaymentsEnabled()) return mockProvider;
  throw new Error("Simulated payments are disabled; Wire payments use the checkout service");
}
