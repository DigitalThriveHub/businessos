export interface PreparedCheckoutRow {
  checkoutId: string;
  organisationId: string;
  connectionId: string;
  stripeAccountId: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  customerEmail: string | null;
  amountMinor: bigint;
  currencyCode: string;
  status: 'PENDING_PROVIDER' | 'OPEN' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
  checkoutUrl: string | null;
  expiresAt: Date | null;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  expiresAt: Date;
}

export interface StripeWebhookResultRow {
  accepted: boolean;
  duplicate: boolean;
  checkoutStatus: string;
}
