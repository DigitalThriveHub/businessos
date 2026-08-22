export type FinanceRecord = Record<string, unknown>;

export interface FinanceDashboardRow {
  dashboard: unknown;
}

export interface FinanceDocumentRow extends FinanceRecord {
  id: string;
}
