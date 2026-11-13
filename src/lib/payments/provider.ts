/**
 * Payment provider boundary (CLAUDE.md §6). We never hold money: a licensed bank holds it,
 * QPay is the pay-in rail. Our system records the deal and sends instructions.
 *
 * Today only MockProvider exists. It behaves like the prototype's "Simulate bank
 * confirmation": the customer presses a button and we act as if the bank's webhook arrived.
 */
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
  createInvoice(dealId: string, amount: number): Promise<Invoice>;
  // The provider calls our webhook when paid → we verify it, then run confirm_payment.
  release(dealId: string, payouts: { to: AccountRef; amount: number }[]): Promise<void>;
  refund(dealId: string, amount: number, to: AccountRef): Promise<void>;
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  async createInvoice(dealId, amount) {
    // One invoice per deal: pressing "pay" twice reuses it, so the payment is booked once.
    return { invoiceId: `mock-inv-${dealId}`, dealId, amount, qrText: `MOCK-QPAY|${dealId}|${amount}` };
  },
  async release() {
    // Mock: money movements are recorded in our ledger only.
  },
  async refund() {
    // Mock: as above.
  },
};

/** The simulate-payment button exists only while no real provider is configured. */
export function mockPaymentsEnabled(): boolean {
  return (process.env.PAYMENT_PROVIDER ?? "mock") === "mock";
}

export function paymentProvider(): PaymentProvider {
  if (mockPaymentsEnabled()) return mockProvider;
  throw new Error(`PAYMENT_PROVIDER=${process.env.PAYMENT_PROVIDER} is not implemented yet (CLAUDE.md §10 step 10)`);
}
