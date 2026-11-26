export type Tx = {
  id: number;
  type: "INCOME" | "EXPENSE";
  amount: number;
  category: string;
  note: string | null;
  date: string;
  dateKey?: string;
  walletId?: number | null;
};

export type Profile = { name: string; email: string; timezone: string; currency: string };

export type SecurityStatus = { twoFactorEnabled: boolean; recoveryCodesRemaining: number };

export type AuditInfo = {
  id: number;
  action: string;
  entity: string | null;
  entityId: number | null;
  ip: string | null;
  createdAt: string;
};

export type SessionInfo = {
  id: number;
  label: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

export type Sum = {
  month: string;
  income: number;
  expense: number;
  monthNet: number;
  balance: number;
  byCategory: { category: string; categoryId: number | null; total: number }[];
};

export type Wallet = { id: number; name: string; initialBalance: number; balance: number };
export type Category = { id: number; name: string; type: "INCOME" | "EXPENSE" };
export type Budget = { id: number; categoryId: number; limit: number; category: Category };
export type Filters = { q: string; category: string; from: string; to: string };

export const EMPTY_FILTERS: Filters = { q: "", category: "", from: "", to: "" };
export const EMPTY_SUM: Sum = { month: "", income: 0, expense: 0, monthNet: 0, balance: 0, byCategory: [] };
