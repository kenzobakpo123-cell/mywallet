"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { dateKeyInZone, localDateInputValue } from "@/lib/dates";
import { CURRENCIES, TIMEZONES, displayDate, formatMoney } from "@/lib/preferences";
import { api } from "@/components/client-api";
import AuthScreen, { type ForcedSetup } from "@/components/auth-screen";
import Icon, { type IconName } from "@/components/icons";
import Modal from "@/components/modal";
import {
  EMPTY_FILTERS,
  EMPTY_SUM,
  type AuditInfo,
  type Budget,
  type Category,
  type Filters,
  type Profile,
  type SecurityStatus,
  type SessionInfo,
  type Sum,
  type Tx,
  type Wallet,
} from "@/components/finance-types";

type Section = "overview" | "transactions" | "manage" | "settings";
type Dialog =
  | { kind: "wallet"; item?: Wallet }
  | { kind: "category"; item?: Category }
  | { kind: "budget"; item?: Budget }
  | { kind: "tx"; item?: Tx }
  | { kind: "deleteTx"; item: Tx }
  | { kind: "deleteWallet"; item: Wallet }
  | { kind: "deleteCategory"; item: Category }
  | { kind: "deleteBudget"; item: Budget }
  | { kind: "confirm"; title: string; description: string; action: "revoke-session" | "revoke-others"; item?: SessionInfo }
  | { kind: "twofaSetup" }
  | { kind: "twofaDisable" }
  | { kind: "twofaRecovery" }
  | { kind: "twofaRecoveryDone" }
  | { kind: "audit" }
  | { kind: "reset" }
  | null;

type TwoFactorSetup = { otpauthUri: string; secret: string; recoveryCodes: string[] };

const NAV: { key: Section; label: string; icon: IconName }[] = [
  { key: "overview", label: "Ringkasan", icon: "home" },
  { key: "transactions", label: "Transaksi", icon: "list" },
  { key: "manage", label: "Pengelolaan", icon: "layers" },
  { key: "settings", label: "Pengaturan", icon: "settings" },
];

const GOOD_NEWS = /berhasil|dibuat|terkirim|diproses|aktif|tersimpan|dicabut|dihapus/i;

const AUDIT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Masuk berhasil",
  LOGIN_FAILED: "Masuk gagal",
  LOGIN_UNVERIFIED: "Masuk ditolak · email belum diverifikasi",
  LOGIN_2FA_REQUIRED: "Verifikasi dua faktor diminta",
  SESSION_CREATE: "Perangkat baru masuk",
  TWO_FACTOR_SETUP: "Menyiapkan 2FA",
  TWO_FACTOR_ENABLED: "2FA diaktifkan",
  TWO_FACTOR_DISABLED: "2FA dinonaktifkan",
  TWO_FACTOR_SUCCESS: "Verifikasi 2FA berhasil",
  TWO_FACTOR_FAILED: "Verifikasi 2FA gagal",
  TWO_FACTOR_RECOVERY_USED: "Kode pemulihan dipakai",
  TWO_FACTOR_RECOVERY_REGENERATED: "Kode pemulihan dibuat ulang",
  TWO_FACTOR_SETUP_REQUIRED: "2FA wajib dipasang",
  SUSPICIOUS_LOGIN_LOCKOUT: "Sesi dicabut karena login mencurigakan",
  PASSWORD_RESET: "Password diubah",
  DATA_RESET: "Data keuangan dihapus",
};

function auditLabel(action: string) {
  return AUDIT_LABELS[action] ?? action.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function queryFor(month: string, filters: Filters, offset?: number) {
  const params = new URLSearchParams();
  if (filters.from || filters.to) {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  } else {
    params.set("month", month);
  }
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (offset !== undefined) params.set("offset", String(offset));
  return params.toString();
}

function exportQuery(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  return params.toString();
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [sum, setSum] = useState<Sum | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [msg, setMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileForm, setProfileForm] = useState({ name: "", timezone: "UTC", currency: "IDR" });
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [month, setMonth] = useState(() => localDateInputValue().slice(0, 7));
  const [txType, setTxType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState("");
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [forcedSetup, setForcedSetup] = useState<ForcedSetup | null>(null);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[]>([]);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [audits, setAudits] = useState<AuditInfo[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const prefInitialized = useRef(false);

  const rp = (n: number) => formatMoney(n, profile?.currency ?? "IDR");
  const todayInput = profile ? dateKeyInZone(new Date(), profile.timezone) : localDateInputValue();

  useEffect(() => {
    if (!msg) return;
    const timer = window.setTimeout(() => setMsg(""), 6500);
    return () => window.clearTimeout(timer);
  }, [msg]);

  const load = useCallback(async () => {
    const [tx, summary, walletRes, categoryRes, budgetRes] = await Promise.all([
      api<{ items: Tx[]; total: number }>(`/api/transactions?${queryFor(month, appliedFilters)}`),
      api<Sum>(`/api/summary?month=${month}`),
      api<{ items: Wallet[] }>("/api/wallets"),
      api<{ items: Category[] }>("/api/categories"),
      api<{ items: Budget[] }>(`/api/budgets?month=${month}`),
    ]);

    if ([tx, summary, walletRes, categoryRes, budgetRes].some((r) => r.status === 401)) {
      setAuthed(false);
      return;
    }

    const failed = [tx, summary, walletRes, categoryRes, budgetRes].some((r) => !r.ok);
    setLoadError(failed ? "Sebagian data gagal dimuat. Muat ulang halaman untuk mencoba lagi." : "");
    setAuthed(true);
    setTxs(Array.isArray(tx.d.items) ? tx.d.items : []);
    setTxTotal(typeof tx.d.total === "number" ? tx.d.total : 0);
    setTxOffset(0);
    setSum(summary.ok && Array.isArray(summary.d.byCategory) ? summary.d : EMPTY_SUM);
    setWallets(Array.isArray(walletRes.d.items) ? walletRes.d.items : []);
    setCategories(Array.isArray(categoryRes.d.items) ? categoryRes.d.items : []);
    setBudgets(Array.isArray(budgetRes.d.items) ? budgetRes.d.items : []);
  }, [month, appliedFilters]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;
    api<{ profile: Profile; security?: SecurityStatus }>("/api/profile").then((r) => {
      if (cancelled || !r.ok || !r.d.profile) return;
      const p = r.d.profile;
      setProfile(p);
      setSecurity(r.d.security ?? null);
      setProfileForm({ name: p.name, timezone: p.timezone, currency: p.currency });
      if (!prefInitialized.current) {
        prefInitialized.current = true;
        setMonth(dateKeyInZone(new Date(), p.timezone).slice(0, 7));
      }
    });
    return () => { cancelled = true; };
  }, [authed]);

  const loadSessions = useCallback(async () => {
    const r = await api<{ items: SessionInfo[] }>("/api/sessions");
    if (r.ok && Array.isArray(r.d.items)) setSessions(r.d.items);
  }, []);

  const loadAudits = useCallback(async (reset = false, cursor?: string | null) => {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const r = await api<{ items: AuditInfo[]; nextCursor: string | null }>(`/api/audit?limit=25${suffix}`);
    if (!r.ok || !Array.isArray(r.d.items)) return;
    setAudits((prev) => reset || !cursor ? r.d.items : [...prev, ...r.d.items]);
    setAuditCursor(r.d.nextCursor ?? null);
  }, []);

  useEffect(() => {
    if (authed === true) queueMicrotask(() => { void loadSessions(); });
  }, [authed, loadSessions]);

  const fmtDateTime = (value: string) =>
    new Date(value).toLocaleString("id-ID", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      timeZone: profile?.timezone || undefined,
    });

  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("finwise-sync");
    channelRef.current = channel;
    channel.onmessage = () => load();
    return () => { channel.close(); channelRef.current = null; };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  function refresh() {
    channelRef.current?.postMessage("refresh");
    void load();
  }

  function openSection(key: Section) {
    setActiveSection(key);
    if (key === "settings") void loadAudits(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await api(`/api/auth/${mode}`, "POST", body);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal");
    if (r.d.twoFactorSetupRequired && typeof r.d.challengeToken === "string") {
      const setup = await api<TwoFactorSetup>("/api/auth/2fa/setup", "POST", { challengeToken: r.d.challengeToken });
      if (!setup.ok) return setMsg(setup.d.error ?? "Gagal menyiapkan 2FA.");
      setForcedSetup({ challengeToken: r.d.challengeToken, ...setup.d });
      setMsg("");
      return;
    }
    if (r.d.twoFactorRequired && typeof r.d.challengeToken === "string") {
      setTwoFactorChallenge(r.d.challengeToken);
      setMsg("");
      return;
    }
    if (mode === "register") {
      setMode("login");
      return setMsg(r.d.message ?? r.d.warning ?? "Akun dibuat. Cek email untuk verifikasi.");
    }
    setMsg("");
    refresh();
  }

  async function submitTwoFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (!twoFactorChallenge || !code) return;
    const r = await api("/api/auth/2fa/verify-login", "POST", { challengeToken: twoFactorChallenge, code });
    if (!r.ok) return setMsg(r.d.error ?? "Kode tidak cocok.");
    setTwoFactorChallenge("");
    setMsg("");
    refresh();
  }

  function cancelTwoFactor() {
    setTwoFactorChallenge("");
    setMsg("");
  }

  async function submitForcedSetup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (!forcedSetup || !code) return;
    const r = await api("/api/auth/2fa/enable", "POST", {
      challengeToken: forcedSetup.challengeToken,
      code,
      recoveryCodes: forcedSetup.recoveryCodes,
    });
    if (!r.ok) return setMsg(r.d.error ?? "Kode tidak cocok.");
    setForcedSetup(null);
    setMsg("");
    refresh();
  }

  function cancelForcedSetup() {
    setForcedSetup(null);
    setMsg("");
  }

  async function regenerateRecovery(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    const r = await api<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery", "POST", body);
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal membuat kode pemulihan.");
    setNewRecoveryCodes(r.d.recoveryCodes ?? []);
    setDialog({ kind: "twofaRecoveryDone" });
    void refreshSecurity();
  }

  async function refreshSecurity() {
    const r = await api<{ security: SecurityStatus }>("/api/profile");
    if (r.ok && r.d.security) setSecurity(r.d.security);
  }

  async function startTwoFactor() {
    if (busy) return;
    setBusy(true);
    const r = await api<TwoFactorSetup>("/api/auth/2fa/setup", "POST", {});
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menyiapkan 2FA.");
    setTwoFactorSetup(r.d);
    setDialog({ kind: "twofaSetup" });
  }

  async function enableTwoFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!twoFactorSetup || busy) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    const r = await api("/api/auth/2fa/enable", "POST", {
      code,
      recoveryCodes: twoFactorSetup.recoveryCodes,
    });
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal mengaktifkan 2FA.");
    setDialog(null);
    setTwoFactorSetup(null);
    setMsg("Autentikasi dua faktor aktif. Simpan kode pemulihanmu di tempat aman.");
    void refreshSecurity();
  }

  async function disableTwoFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    const r = await api("/api/auth/2fa/disable", "POST", body);
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menonaktifkan 2FA.");
    setDialog(null);
    setSecurity({ twoFactorEnabled: false, recoveryCodesRemaining: 0 });
    setAuthed(false);
    setMsg("2FA dinonaktifkan. Semua sesi dicabut; silakan masuk lagi.");
  }

  async function sendAuthEmail(kind: "forgot-password" | "resend-verification") {
    const email = document.querySelector<HTMLInputElement>('input[name="email"]')?.value.trim();
    if (!email) return setMsg("Isi alamat email terlebih dahulu.");
    setMsg("");
    const r = await api(`/api/auth/${kind}`, "POST", { email });
    setMsg(r.d.message ?? r.d.error ?? "Permintaan diproses.");
  }

  async function submitForm(url: string, body: unknown, form: HTMLFormElement, errorText: string) {
    const r = await api(url, "POST", body);
    if (!r.ok) return setMsg(r.d.error ?? errorText);
    form.reset();
    setMsg("");
    refresh();
  }

  function addTx(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const walletValue = f.get("walletId");
    void submitForm("/api/transactions", {
      type: txType,
      amount: Number(f.get("amount")),
      category: f.get("category"),
      note: f.get("note") || undefined,
      date: f.get("date"),
      ...(walletValue ? { walletId: Number(walletValue) } : {}),
    }, form, "Gagal menyimpan transaksi");
  }

  function readAmount(label: string, value: string): number | null {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      setMsg(`${label} harus bilangan bulat non-negatif.`);
      return null;
    }
    return amount;
  }

  function applyFilters(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAppliedFilters({ q: filters.q.trim(), category: filters.category, from: filters.from, to: filters.to });
    setTxOffset(0);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  async function loadMore() {
    const offset = txOffset + 200;
    const r = await api<{ items: Tx[] }>(`/api/transactions?${queryFor(month, appliedFilters, offset)}`);
    if (!r.ok || !Array.isArray(r.d.items)) return setMsg("Gagal memuat transaksi lainnya");
    setTxs((prev) => [...prev, ...r.d.items]);
    setTxOffset(offset);
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await api<{ profile: Profile }>("/api/profile", "PATCH", profileForm);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menyimpan profil");
    const p = r.d.profile;
    setProfile(p);
    setMonth(dateKeyInZone(new Date(), p.timezone).slice(0, 7));
    setMsg("Profil berhasil disimpan.");
    refresh();
  }

  async function logout(all = false) {
    await api("/api/auth/logout", "POST", all ? { all: true } : undefined);
    setAuthed(false);
    setProfile(null);
    setSessions([]);
    prefInitialized.current = false;
    setMonth(localDateInputValue().slice(0, 7));
    setTxs([]);
    setSum(null);
    setWallets([]);
    setCategories([]);
    setBudgets([]);
    setTxTotal(0);
    setTxOffset(0);
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setActiveSection("overview");
    setTxType("EXPENSE");
    setDialog(null);
    setMsg("");
    setLoadError("");
  }

  async function submitDialog(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog || busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);

    let url = "";
    let method = "POST";
    let body: unknown;
    let okText = "Perubahan tersimpan.";

    if (dialog.kind === "wallet") {
      const initialBalance = readAmount("Saldo awal", String(f.get("initialBalance") ?? 0));
      if (initialBalance === null) return setBusy(false);
      url = dialog.item ? `/api/wallets/${dialog.item.id}` : "/api/wallets";
      method = dialog.item ? "PATCH" : "POST";
      body = { name: String(f.get("name") ?? "").trim(), initialBalance };
      okText = dialog.item ? "Dompet diperbarui." : "Dompet ditambahkan.";
    } else if (dialog.kind === "category") {
      url = dialog.item ? `/api/categories/${dialog.item.id}` : "/api/categories";
      method = dialog.item ? "PATCH" : "POST";
      body = { name: String(f.get("name") ?? "").trim(), type: f.get("type") };
      okText = dialog.item ? "Kategori diperbarui." : "Kategori ditambahkan.";
    } else if (dialog.kind === "budget") {
      const limit = readAmount("Batas anggaran", String(f.get("limit") ?? 0));
      if (limit === null) return setBusy(false);
      if (limit === 0) {
        setBusy(false);
        return setMsg("Batas anggaran harus lebih dari 0.");
      }
      url = dialog.item ? `/api/budgets/${dialog.item.id}` : "/api/budgets";
      method = dialog.item ? "PATCH" : "POST";
      body = { categoryId: Number(f.get("categoryId")), month, limit };
      okText = dialog.item ? "Anggaran diperbarui." : "Anggaran diatur.";
    } else if (dialog.kind === "tx") {
      const amount = readAmount("Jumlah", String(f.get("amount") ?? 0));
      if (amount === null) return setBusy(false);
      if (amount === 0) {
        setBusy(false);
        return setMsg("Jumlah transaksi harus lebih dari 0.");
      }
      const walletValue = f.get("walletId");
      url = dialog.item ? `/api/transactions/${dialog.item.id}` : "/api/transactions";
      method = dialog.item ? "PATCH" : "POST";
      body = {
        type: f.get("type"),
        amount,
        category: String(f.get("category") ?? "").trim(),
        note: f.get("note") || undefined,
        date: f.get("date"),
        ...(walletValue ? { walletId: Number(walletValue) } : {}),
      };
      okText = dialog.item ? "Transaksi diperbarui." : "Transaksi tersimpan.";
    } else if (dialog.kind === "deleteTx") {
      url = `/api/transactions/${dialog.item.id}`;
      method = "DELETE";
      okText = "Transaksi dihapus.";
    } else if (dialog.kind === "deleteWallet") {
      url = `/api/wallets/${dialog.item.id}`;
      method = "DELETE";
      okText = "Dompet dihapus.";
    } else if (dialog.kind === "deleteCategory") {
      url = `/api/categories/${dialog.item.id}`;
      method = "DELETE";
      okText = "Kategori dihapus.";
    } else if (dialog.kind === "deleteBudget") {
      url = `/api/budgets/${dialog.item.id}`;
      method = "DELETE";
      okText = "Anggaran dihapus.";
    } else if (dialog.kind === "confirm") {
      if (dialog.action === "revoke-session" && dialog.item) {
        url = `/api/sessions/${dialog.item.id}`;
        method = "DELETE";
        okText = "Perangkat dicabut.";
      } else {
        url = "/api/sessions";
        method = "DELETE";
        okText = "Perangkat lain dicabut.";
      }
    }

    const r = await api(url, method, body);
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menyimpan perubahan.");

    if (dialog.kind === "confirm" && dialog.action === "revoke-session" && dialog.item) {
      setSessions((prev) => prev.filter((item) => item.id !== dialog.item?.id));
      if (r.d.current) {
        void logout();
        return;
      }
      void loadSessions();
    }
    if (dialog.kind === "confirm" && dialog.action === "revoke-others") void loadSessions();

    setDialog(null);
    setMsg(okText);
    refresh();
  }

  async function resetData() {
    if (resetPhrase !== "RESET" || busy) return;
    setBusy(true);
    const r = await api("/api/data/reset", "POST", { confirm: "RESET" });
    setBusy(false);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menghapus data.");
    setDialog(null);
    await logout();
    setMsg("Data keuangan dihapus. Akun kamu tetap tersedia.");
  }

  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
  const quickCategories = categories.filter((category) => category.type === txType);
  const budgetCategories = categories.filter((category) => category.type === "EXPENSE");
  const exportSuffix = exportQuery(appliedFilters);

  if (authed === null) {
    return (
      <main className="loading-screen" aria-label="Memuat aplikasi">
        <div className="brand-mark">Rp</div>
        <p>Menyiapkan buku kas kamu…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <AuthScreen
        mode={mode}
        msg={msg}
        onSubmit={submitAuth}
        onAuthEmail={sendAuthEmail}
        onSwitchMode={() => { setMode(mode === "login" ? "register" : "login"); setMsg(""); }}
        twoFactor={Boolean(twoFactorChallenge)}
        onTwoFactor={submitTwoFactor}
        onCancelTwoFactor={cancelTwoFactor}
        forcedSetup={forcedSetup}
        onForcedSetup={submitForcedSetup}
        onCancelForcedSetup={cancelForcedSetup}
      />
    );
  }

  const dialogMeta = (() => {
    if (!dialog) return null;
    switch (dialog.kind) {
      case "wallet":
        return { title: dialog.item ? "Ubah dompet" : "Dompet baru", description: "Simpan saldo awal supaya saldo bulan ini lebih akurat." };
      case "category":
        return { title: dialog.item ? "Ubah kategori" : "Kategori baru", description: "Kategori memudahkan pencarian dan anggaran." };
      case "budget":
        return { title: dialog.item ? "Ubah anggaran" : "Anggaran baru", description: `Berlaku untuk ${monthLabel}.` };
      case "tx":
        return { title: dialog.item ? "Ubah transaksi" : "Transaksi baru", description: "Semua kolom mengikuti apa yang kamu tulis." };
      case "deleteTx":
        return { title: "Hapus transaksi?", description: `${dialog.item.category} · ${rp(dialog.item.amount)}` };
      case "deleteWallet":
        return { title: `Hapus dompet "${dialog.item.name}"?`, description: "Transaksi yang memakai dompet ini tetap tersimpan tanpa dompet." };
      case "deleteCategory":
        return { title: `Hapus kategori "${dialog.item.name}"?`, description: "Anggaran kategori ini ikut terhapus. Transaksi lama tetap tersimpan." };
      case "deleteBudget":
        return { title: `Hapus anggaran ${dialog.item.category.name}?`, description: "Batas bulanan ini akan dihapus." };
      case "confirm":
        return { title: dialog.title, description: dialog.description };
      case "twofaSetup":
        return { title: "Aktifkan autentikasi dua faktor", description: "Pindai kode QR, lalu masukkan kode 6 digit untuk mengonfirmasi." };
      case "twofaDisable":
        return { title: "Nonaktifkan 2FA?", description: "Semua perangkat akan dicabut dan kamu perlu masuk lagi." };
      case "twofaRecovery":
        return { title: "Kode pemulihan baru", description: "Kode lama akan berhenti berlaku. Konfirmasi dengan password dan kode 2FA." };
      case "twofaRecoveryDone":
        return { title: "Simpan kode pemulihan baru", description: "Kode berikut hanya ditampilkan sekali." };
      case "audit":
        return { title: "Aktivitas keamanan", description: "Riwayat login, perubahan data, dan peristiwa keamanan terakhir." };
      case "reset":
        return { title: "Hapus semua data keuangan?", description: "Tindakan ini tidak bisa dibatalkan." };
    }
  })();

  function walletOptions() {
    return (
      <>
        <option value="">Tanpa dompet</option>
        {wallets.map((wallet) => (
          <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
        ))}
      </>
    );
  }

  function renderDialogBody() {
    if (!dialog) return null;

    if (dialog.kind === "twofaSetup" && twoFactorSetup) {
      return (
        <form className="dialog-form" onSubmit={enableTwoFactor}>
          <p className="modal-note">
            Tambahkan akun <strong>Finwise</strong> di Google Authenticator, 1Password, Authy, atau aplikasi TOTP lain.
            Masukkan kunci ini bila tidak bisa memindai tautan:
          </p>
          <code className="secret-code">{twoFactorSetup.secret}</code>
          <a className="btn btn-quiet wide" href={twoFactorSetup.otpauthUri}>Buka di aplikasi authenticator</a>
          <div className="reset-warning">
            <Icon name="alert" />
            <div>
              <p><strong>Simpan kode pemulihan ini sekarang.</strong> Kode berikut hanya ditampilkan sekali.</p>
              <div className="code-grid">
                {twoFactorSetup.recoveryCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
            </div>
          </div>
          <label className="field">Kode 6 digit dari aplikasi
            <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" pattern="\d{6}" required />
          </label>
          <div className="dialog-actions">
            <button className="btn btn-quiet" type="button" onClick={() => { setDialog(null); setTwoFactorSetup(null); }} disabled={busy}>Batal</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Mengaktifkan…" : "Aktifkan 2FA"}</button>
          </div>
        </form>
      );
    }

    if (dialog.kind === "twofaDisable") {
      return (
        <form className="dialog-form" onSubmit={disableTwoFactor}>
          <div className="reset-warning"><Icon name="alert" /><p>Setelah dinonaktifkan, semua sesi dicabut dan kode pemulihan yang tersisa dihapus.</p></div>
          <label className="field">Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <label className="field">Kode 2FA atau kode pemulihan
            <input name="code" autoComplete="one-time-code" required />
          </label>
          <div className="dialog-actions">
            <button className="btn btn-quiet" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</button>
            <button className="btn btn-danger" type="submit" disabled={busy}>{busy ? "Menonaktifkan…" : "Nonaktifkan 2FA"}</button>
          </div>
        </form>
      );
    }

    if (dialog.kind === "twofaRecovery") {
      return (
        <form className="dialog-form" onSubmit={regenerateRecovery}>
          <div className="reset-warning"><Icon name="alert" /><p>Kode pemulihan lama akan langsung tidak berlaku setelah ini.</p></div>
          <label className="field">Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <label className="field">Kode 2FA atau kode pemulihan yang masih aktif
            <input name="code" autoComplete="one-time-code" required />
          </label>
          <div className="dialog-actions">
            <button className="btn btn-quiet" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Membuat…" : "Buat kode baru"}</button>
          </div>
        </form>
      );
    }

    if (dialog.kind === "twofaRecoveryDone") {
      return (
        <div className="dialog-form">
          <div className="reset-warning">
            <Icon name="alert" />
            <p>Salin dan simpan kode ini sekarang. Kode lama sudah tidak bisa dipakai.</p>
          </div>
          <div className="code-grid">
            {newRecoveryCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
          <div className="dialog-actions">
            <button className="btn btn-primary wide" type="button" onClick={() => { setDialog(null); setNewRecoveryCodes([]); }}>Sudah disimpan</button>
          </div>
        </div>
      );
    }

    if (dialog.kind === "audit") {
      return (
        <div className="dialog-form">
          {audits.length === 0 ? (
            <div className="empty-inline"><Icon name="shield" /><p>Belum ada aktivitas yang tercatat.</p></div>
          ) : (
            <div className="audit-list">
              {audits.map((item) => (
                <div className="audit-row" key={item.id}>
                  <span className="audit-detail">
                    <strong>{auditLabel(item.action)}</strong>
                    <small>{fmtDateTime(item.createdAt)}{item.ip ? ` · ${item.ip}` : ""}</small>
                  </span>
                  {item.entity && <span className="tag">{item.entity}</span>}
                </div>
              ))}
            </div>
          )}
          {auditCursor && (
            <button className="btn btn-quiet wide" type="button" onClick={() => void loadAudits(false, auditCursor)}>
              Muat lebih banyak
            </button>
          )}
        </div>
      );
    }

    if (dialog.kind === "reset") {
      return (
        <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); void resetData(); }}>
          <div className="reset-warning">
            <Icon name="alert" />
            <p>
              Transaksi, dompet, kategori, anggaran, dan sesi login akan dihapus. Nama, email, dan password kamu tetap disimpan.
            </p>
          </div>
          <label className="field">
            Ketik <strong>RESET</strong> untuk melanjutkan
            <input
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              placeholder="RESET"
              autoComplete="off"
              required
            />
          </label>
          <div className="dialog-actions">
            <button className="btn btn-quiet" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</button>
            <button className="btn btn-danger" type="submit" disabled={busy || resetPhrase !== "RESET"}>
              {busy ? "Menghapus…" : "Ya, hapus semua data"}
            </button>
          </div>
        </form>
      );
    }

    return (
      <form className="dialog-form" onSubmit={submitDialog}>
        {dialog.kind === "wallet" && (
          <>
            <label className="field">Nama dompet
              <input name="name" defaultValue={dialog.item?.name} placeholder="Contoh: Dompet harian" required />
            </label>
            <label className="field">Saldo awal ({profile?.currency ?? "IDR"})
              <input name="initialBalance" type="number" min={0} step={1} defaultValue={dialog.item?.initialBalance ?? 0} required />
            </label>
          </>
        )}

        {dialog.kind === "category" && (
          <>
            <label className="field">Nama kategori
              <input name="name" defaultValue={dialog.item?.name} placeholder="Contoh: Transportasi" required />
            </label>
            <label className="field">Jenis
              <select name="type" defaultValue={dialog.item?.type ?? "EXPENSE"}>
                <option value="EXPENSE">Pengeluaran</option>
                <option value="INCOME">Pemasukan</option>
              </select>
            </label>
          </>
        )}

        {dialog.kind === "budget" && (
          <>
            <label className="field">Kategori pengeluaran
              <select name="categoryId" defaultValue={dialog.item?.categoryId} required>
                <option value="">Pilih kategori</option>
                {budgetCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="field">Batas ({profile?.currency ?? "IDR"})
              <input name="limit" type="number" min={1} step={1} defaultValue={dialog.item?.limit} placeholder="0" required />
            </label>
            {budgetCategories.length === 0 && <p className="modal-note">Buat kategori pengeluaran dulu sebelum mengatur anggaran.</p>}
          </>
        )}

        {dialog.kind === "tx" && (
          <>
            <label className="field">Jenis
              <select name="type" defaultValue={dialog.item?.type ?? "EXPENSE"}>
                <option value="EXPENSE">Pengeluaran</option>
                <option value="INCOME">Pemasukan</option>
              </select>
            </label>
            <div className="field-grid">
              <label className="field">Jumlah ({profile?.currency ?? "IDR"})
                <input name="amount" type="number" min={1} step={1} defaultValue={dialog.item?.amount} required />
              </label>
              <label className="field">Tanggal
                <input name="date" type="date" defaultValue={dialog.item?.dateKey ?? dialog.item?.date.slice(0, 10) ?? todayInput} required />
              </label>
            </div>
            <label className="field">Kategori
              <input name="category" defaultValue={dialog.item?.category} placeholder="Sesuai tulisan kamu" required />
            </label>
            <label className="field">Dompet
              <select name="walletId" defaultValue={dialog.item?.walletId ?? ""}>{walletOptions()}</select>
            </label>
            <label className="field">Catatan
              <input name="note" defaultValue={dialog.item?.note ?? ""} placeholder="Opsional" />
            </label>
          </>
        )}

        {(dialog.kind === "deleteTx" || dialog.kind === "deleteWallet" || dialog.kind === "deleteCategory" || dialog.kind === "deleteBudget" || dialog.kind === "confirm") && (
          <p className="modal-note">
            {dialog.kind === "deleteTx"
              ? "Transaksi ini akan hilang dari buku kas dan ekspor."
              : "description" in dialog
                ? dialog.description
                : ""}
          </p>
        )}

        <div className="dialog-actions">
          <button className="btn btn-quiet" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</button>
          <button
            className={`btn ${dialog.kind === "deleteTx" || dialog.kind === "deleteWallet" || dialog.kind === "deleteCategory" || dialog.kind === "deleteBudget" || dialog.kind === "confirm" ? "btn-danger" : "btn-primary"}`}
            type="submit"
            disabled={busy}
          >
            {busy ? "Memproses…" : dialog.kind === "deleteTx" || dialog.kind === "deleteWallet" || dialog.kind === "deleteCategory" || dialog.kind === "deleteBudget" || dialog.kind === "confirm" ? "Ya, lanjutkan" : "Simpan"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="app-brand"><span className="brand-mark">Rp</span><span>Finwise</span></div>
        <nav className="nav-list" aria-label="Navigasi utama">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${activeSection === item.key ? "active" : ""}`}
              type="button"
              aria-current={activeSection === item.key ? "page" : undefined}
              onClick={() => openSection(item.key)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="user-avatar">{(profile?.name ?? "K").slice(0, 1).toUpperCase()}</span>
            <span className="user-detail"><strong>{profile?.name ?? "Kamu"}</strong><small>{profile?.email ?? ""}</small></span>
          </div>
          <button className="logout-button" type="button" onClick={() => void logout()}>
            <Icon name="logout" size={16} /> Keluar
          </button>
        </div>
      </aside>

      <section className="dashboard">
        <header className="dashboard-header">
          <div className="header-copy">
            <p className="header-kicker">Buku kas · {monthLabel}</p>
            <h1>Halo, {profile?.name ?? "kamu"}.</h1>
            <p className="header-sub">Catat dulu, pikirkan nanti. Semua tersimpan rapi di sini.</p>
          </div>
          <div className="header-actions">
            <label className="month-field" title="Bulan yang sedang dilihat">
              <Icon name="calendar" size={16} />
              <input aria-label="Pilih bulan" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <div className="export-group">
              <a className="btn btn-quiet" href={`/api/transactions/export?format=csv${exportSuffix ? `&${exportSuffix}` : ""}`}>
                <Icon name="download" size={16} /> CSV
              </a>
              <a className="btn btn-quiet" href={`/api/transactions/export?format=pdf${exportSuffix ? `&${exportSuffix}` : ""}`}>
                <Icon name="file" size={16} /> PDF
              </a>
            </div>
          </div>
        </header>

        {msg && (
          <div className={`toast ${GOOD_NEWS.test(msg) ? "ok" : "err"}`} role="status">
            <Icon name={GOOD_NEWS.test(msg) ? "check" : "alert"} size={16} /> {msg}
          </div>
        )}
        {!msg && loadError && (
          <div className="toast err" role="status"><Icon name="alert" size={16} /> {loadError}</div>
        )}

        {activeSection === "overview" && (
          <>
            <div className="summary-grid">
              <article className="summary-card balance-card">
                <div className="summary-icon"><Icon name="wallet" /></div>
                <div><span>Saldo saat ini</span><strong>{rp(sum?.balance ?? 0)}</strong></div>
                <small>termin bulan ini</small>
              </article>
              <article className="summary-card">
                <div className="summary-icon income-icon"><Icon name="income" /></div>
                <div><span>Pemasukan bulan ini</span><strong className="income-text">{rp(sum?.income ?? 0)}</strong></div>
              </article>
              <article className="summary-card">
                <div className="summary-icon expense-icon"><Icon name="expense" /></div>
                <div><span>Pengeluaran bulan ini</span><strong className="expense-text">{rp(sum?.expense ?? 0)}</strong></div>
              </article>
            </div>

            <div className="sheet-grid two-col">
              <section className="sheet">
                <div className="sheet-head">
                  <div><span className="sheet-kicker">Catatan baru</span><h2>Tambah transaksi</h2></div>
                </div>
                <form className="quick-form" key={todayInput} onSubmit={addTx}>
                  <div className="type-switch" role="group" aria-label="Jenis transaksi">
                    <button
                      className={txType === "EXPENSE" ? "active expense" : ""}
                      type="button"
                      onClick={() => setTxType("EXPENSE")}
                    >
                      <Icon name="expense" size={16} /> Pengeluaran
                    </button>
                    <button
                      className={txType === "INCOME" ? "active income" : ""}
                      type="button"
                      onClick={() => setTxType("INCOME")}
                    >
                      <Icon name="income" size={16} /> Pemasukan
                    </button>
                    <input type="hidden" name="type" value={txType} />
                  </div>
                  <div className="field-grid">
                    <label className="field">Jumlah ({profile?.currency ?? "IDR"})
                      <input name="amount" type="number" min={1} step={1} placeholder="0" required />
                    </label>
                    <label className="field">Tanggal
                      <input name="date" type="date" defaultValue={todayInput} required />
                    </label>
                  </div>
                  <label className="field">Kategori
                    {quickCategories.length > 0 ? (
                      <select name="category" required>
                        <option value="">Pilih kategori</option>
                        {quickCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                      </select>
                    ) : (
                      <input name="category" placeholder="Contoh: Makanan" required />
                    )}
                  </label>
                  <label className="field">Dompet
                    <select name="walletId">{walletOptions()}</select>
                  </label>
                  <label className="field">Catatan
                    <input name="note" placeholder="Tulis sesuai kebutuhan kamu" />
                  </label>
                  <button className="btn btn-primary wide" type="submit"><Icon name="plus" size={16} /> Simpan transaksi</button>
                </form>
              </section>

              <section className="sheet">
                <div className="sheet-head">
                  <div><span className="sheet-kicker">Analisis</span><h2>Keluar ke mana</h2></div>
                  <span className="tag">{monthLabel}</span>
                </div>
                {sum && sum.byCategory.length > 0 ? (
                  <div className="breakdown">
                    {sum.byCategory.slice(0, 6).map((item, index) => {
                      const width = sum.expense ? Math.max(6, Math.round(item.total / sum.expense * 100)) : 0;
                      return (
                        <div className="breakdown-row" key={item.category}>
                          <div className="breakdown-meta">
                            <span><i className={`dot dot-${index % 5}`} />{item.category}</span>
                            <strong>{rp(item.total)}</strong>
                          </div>
                          <div className="breakdown-track"><div className={`breakdown-fill dot-${index % 5}`} style={{ width: `${width}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-inline"><Icon name="target" /><p>Belum ada pengeluaran bulan ini.</p></div>
                )}
              </section>
            </div>

            <section className="sheet">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Aktivitas terbaru</span><h2>Catatan terakhir</h2></div>
                <button className="btn btn-small" type="button" onClick={() => openSection("transactions")}>Lihat semua</button>
              </div>
              {txs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="list" /></div>
                  <h3>Buku kas masih kosong</h3>
                  <p>Isi transaksi pertama di atas, nanti semua riwayatnya bisa diunduh.</p>
                </div>
              ) : (
                <div className="compact-list">
                  {txs.slice(0, 5).map((item) => (
                    <div className="compact-row" key={item.id}>
                      <span className={`tx-icon ${item.type === "INCOME" ? "income-icon" : "expense-icon"}`}>
                        <Icon name={item.type === "INCOME" ? "income" : "expense"} size={16} />
                      </span>
                      <span className="compact-main">
                        <strong>{item.category}</strong>
                        <small>{item.note || "Tanpa catatan"} · {displayDate(item.dateKey ?? item.date.slice(0, 10))}</small>
                      </span>
                      <strong className={item.type === "INCOME" ? "income-text" : "expense-text"}>
                        {item.type === "INCOME" ? "+" : "−"}{rp(item.amount)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {activeSection === "transactions" && (
          <>
            <section className="export-strip">
              <div>
                <span className="sheet-kicker">Arsip</span>
                <h2>Unduh riwayat transaksi</h2>
                <p>Isinya lengkap sesuai tulisan kamu: tanggal, tipe, kategori, dompet, jumlah, dan catatan.</p>
              </div>
              <div className="export-actions">
                <a className="btn btn-quiet" href={`/api/transactions/export?format=csv${exportSuffix ? `&${exportSuffix}` : ""}`}>
                  <Icon name="download" size={16} /> Unduh CSV
                </a>
                <a className="btn btn-primary" href={`/api/transactions/export?format=pdf${exportSuffix ? `&${exportSuffix}` : ""}`}>
                  <Icon name="file" size={16} /> Unduh PDF
                </a>
              </div>
            </section>

            <section className="sheet" id="transaction-history">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Riwayat</span><h2>Semua transaksi</h2></div>
                <span className="tag">Menampilkan {txs.length} dari {txTotal}</span>
              </div>
              <form className="filter-bar" onSubmit={applyFilters}>
                <label className="search-field"><Icon name="search" size={16} />
                  <input aria-label="Cari transaksi" placeholder="Cari kategori atau catatan" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
                </label>
                <select aria-label="Filter kategori" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                  <option value="">Semua kategori</option>
                  {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                </select>
                <input aria-label="Dari tanggal" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                <input aria-label="Sampai tanggal" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                <button className="btn btn-primary btn-small" type="submit">Terapkan</button>
                <button className="btn btn-quiet btn-small" type="button" onClick={resetFilters}>Reset</button>
              </form>

              {txs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="list" /></div>
                  <h3>Belum ada transaksi</h3>
                  <p>Tambahkan transaksi pertamamu dari halaman Ringkasan.</p>
                </div>
              ) : (
                <div className="transaction-table">
                  <div className="transaction-head" aria-hidden="true">
                    <span>Tanggal</span><span>Keterangan</span><span>Dompet</span><span className="align-right">Jumlah</span><span />
                  </div>
                  {txs.map((item) => (
                    <div className="transaction-row" key={item.id}>
                      <span className="tx-date">{displayDate(item.dateKey ?? item.date.slice(0, 10))}</span>
                      <span className="tx-main">
                        <span className={`tx-icon ${item.type === "INCOME" ? "income-icon" : "expense-icon"}`}>
                          <Icon name={item.type === "INCOME" ? "income" : "expense"} size={15} />
                        </span>
                        <span className="tx-copy">
                          <strong>{item.category}</strong>
                          <small>{item.note || "Tanpa catatan"}</small>
                        </span>
                      </span>
                      <span className="tx-wallet">{wallets.find((wallet) => wallet.id === item.walletId)?.name ?? "—"}</span>
                      <strong className={`tx-amount ${item.type === "INCOME" ? "income-text" : "expense-text"}`}>
                        {item.type === "INCOME" ? "+" : "−"}{rp(item.amount)}
                      </strong>
                      <span className="row-actions">
                        <button className="icon-button" type="button" aria-label="Ubah transaksi" onClick={() => setDialog({ kind: "tx", item })}><Icon name="pencil" size={15} /></button>
                        <button className="icon-button danger" type="button" aria-label="Hapus transaksi" onClick={() => setDialog({ kind: "deleteTx", item })}><Icon name="trash" size={15} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {txs.length < txTotal && (
                <button className="btn btn-quiet wide" type="button" onClick={() => void loadMore()}>Muat lebih banyak</button>
              )}
            </section>
          </>
        )}

        {activeSection === "manage" && (
          <div className="management-grid">
            <section className="sheet">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Tempat uang</span><h2>Dompet</h2></div>
                <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "wallet" })}><Icon name="plus" size={14} /> Tambah</button>
              </div>
              {wallets.length === 0 ? (
                <div className="empty-inline"><Icon name="wallet" /><p>Belum ada dompet.</p></div>
              ) : (
                <div className="item-list">
                  {wallets.map((wallet) => (
                    <div className="item-row" key={wallet.id}>
                      <span className="item-icon"><Icon name="wallet" size={16} /></span>
                      <span className="item-main"><strong>{wallet.name}</strong><small>Saldo awal {rp(wallet.initialBalance)}</small></span>
                      <strong className="item-value">{rp(wallet.balance)}</strong>
                      <span className="row-actions">
                        <button className="icon-button" type="button" aria-label="Ubah dompet" onClick={() => setDialog({ kind: "wallet", item: wallet })}><Icon name="pencil" size={15} /></button>
                        <button className="icon-button danger" type="button" aria-label="Hapus dompet" onClick={() => setDialog({ kind: "deleteWallet", item: wallet })}><Icon name="trash" size={15} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {wallets.length > 0 && <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "wallet" })}>Tambah dompet</button>}
            </section>

            <section className="sheet">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Pengelompokan</span><h2>Kategori</h2></div>
                <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "category" })}><Icon name="plus" size={14} /> Tambah</button>
              </div>
              {categories.length === 0 ? (
                <div className="empty-inline"><Icon name="tag" /><p>Belum ada kategori.</p></div>
              ) : (
                <div className="item-list">
                  {categories.map((category) => (
                    <div className="item-row" key={category.id}>
                      <span className="item-icon"><Icon name="tag" size={16} /></span>
                      <span className="item-main"><strong>{category.name}</strong><small>{category.type === "INCOME" ? "Pemasukan" : "Pengeluaran"}</small></span>
                      <span className="row-actions">
                        <button className="icon-button" type="button" aria-label="Ubah kategori" onClick={() => setDialog({ kind: "category", item: category })}><Icon name="pencil" size={15} /></button>
                        <button className="icon-button danger" type="button" aria-label="Hapus kategori" onClick={() => setDialog({ kind: "deleteCategory", item: category })}><Icon name="trash" size={15} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="sheet">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Batas bulanan</span><h2>Anggaran</h2></div>
                <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "budget" })}><Icon name="plus" size={14} /> Tambah</button>
              </div>
              {budgets.length === 0 ? (
                <div className="empty-inline"><Icon name="target" /><p>Belum ada anggaran bulan ini.</p></div>
              ) : (
                <div className="item-list">
                  {budgets.map((budget) => {
                    const spent = sum?.byCategory.find((item) =>
                      budget.categoryId != null && item.categoryId != null
                        ? item.categoryId === budget.categoryId
                        : item.category === budget.category.name,
                    )?.total ?? 0;
                    const percent = Math.min(100, budget.limit ? Math.round(spent / budget.limit * 100) : 0);
                    return (
                      <div className={`item-row budget-row ${percent >= 100 ? "over" : ""}`} key={budget.id}>
                        <span className="item-main">
                          <strong>{budget.category.name}</strong>
                          <small>{rp(spent)} / {rp(budget.limit)}</small>
                          <span className="breakdown-track"><span className={`breakdown-fill ${percent >= 100 ? "dot-1" : "dot-0"}`} style={{ width: `${percent}%` }} /></span>
                        </span>
                        <span className="row-actions">
                          <button className="icon-button" type="button" aria-label="Ubah anggaran" onClick={() => setDialog({ kind: "budget", item: budget })}><Icon name="pencil" size={15} /></button>
                          <button className="icon-button danger" type="button" aria-label="Hapus anggaran" onClick={() => setDialog({ kind: "deleteBudget", item: budget })}><Icon name="trash" size={15} /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {activeSection === "settings" && (
          <>
            <div className="settings-grid">
              <section className="sheet" id="profile">
                <div className="sheet-head">
                  <div><span className="sheet-kicker">Preferensi akun</span><h2>Profil</h2></div>
                  <span className="tag">{profile?.email ?? ""}</span>
                </div>
                <form className="profile-form" onSubmit={saveProfile}>
                  <label className="field">Nama
                    <input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} minLength={2} maxLength={60} required />
                  </label>
                  <label className="field">Zona waktu
                    <select value={profileForm.timezone} onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}>
                      {TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                    </select>
                  </label>
                  <label className="field">Mata uang
                    <select value={profileForm.currency} onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })}>
                      {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-primary" type="submit">Simpan profil</button>
                </form>
                <p className="modal-note">Tanggal yang sudah tercatat tidak berubah saat zona waktu diganti.</p>
              </section>

              <section className="sheet" id="security">
                <div className="sheet-head">
                  <div><span className="sheet-kicker">Lapis keamanan</span><h2>Verifikasi dua faktor</h2></div>
                  <span className={`tag ${security?.twoFactorEnabled ? "tag-good" : ""}`}>
                    {security?.twoFactorEnabled ? "Aktif" : "Belum aktif"}
                  </span>
                </div>
                <div className="danger-copy">
                  <p>
                    Setiap masuk harus memasukkan kode dari aplikasi authenticator. Simpan kode pemulihan di tempat aman
                    supaya tetap bisa masuk kalau ponsel hilang.
                  </p>
                  <div className="security-actions">
                    {security?.twoFactorEnabled ? (
                      <>
                        <span className="tag">{security.recoveryCodesRemaining} kode pemulihan tersisa</span>
                        <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "twofaRecovery" })}>
                          Kode pemulihan baru
                        </button>
                        <button className="btn btn-small" type="button" onClick={() => setDialog({ kind: "twofaDisable" })}>
                          Nonaktifkan 2FA
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-small" type="button" onClick={() => void startTwoFactor()} disabled={busy}>
                        {busy ? "Menyiapkan…" : "Aktifkan 2FA"}
                      </button>
                    )}
                    <button
                      className="btn btn-small"
                      type="button"
                      onClick={() => { void loadAudits(true); setDialog({ kind: "audit" }); }}
                    >
                      Lihat aktivitas
                    </button>
                  </div>
                </div>
              </section>

              <section className="sheet" id="sessions">
                <div className="sheet-head">
                  <div><span className="sheet-kicker">Keamanan akun</span><h2>Perangkat aktif</h2></div>
                  <button className="btn btn-small" type="button" onClick={() => setDialog({
                    kind: "confirm",
                    title: "Cabut perangkat lain?",
                    description: "Perangkat yang sedang kamu pakai tetap masuk.",
                    action: "revoke-others",
                  })}>Cabut lainnya</button>
                </div>
                {sessions.length === 0 ? (
                  <div className="empty-inline"><Icon name="shield" /><p>Belum ada sesi yang tercatat.</p></div>
                ) : (
                  <div className="session-list">
                    {sessions.map((item) => (
                      <div className="session-row" key={item.id}>
                        <span className="item-icon"><Icon name="shield" size={16} /></span>
                        <span className="session-detail">
                          <strong>{item.label}{item.current ? " · perangkat ini" : ""}</strong>
                          <small>{item.ip ? `${item.ip} · ` : ""}terakhir dipakai {fmtDateTime(item.lastUsedAt)}</small>
                        </span>
                        <button
                          className="btn btn-small"
                          type="button"
                          onClick={() => item.current
                            ? void logout()
                            : setDialog({
                              kind: "confirm",
                              title: `Cabut "${item.label}"?`,
                              description: "Perangkat itu harus masuk lagi sebelum bisa membaca data.",
                              action: "revoke-session",
                              item,
                            })}
                        >
                          {item.current ? "Keluar" : "Cabut"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="modal-note">Login dari perangkat baru otomatis dikirimi notifikasi ke email kamu.</p>
              </section>
            </div>

            <section className="sheet danger-zone">
              <div className="sheet-head">
                <div><span className="sheet-kicker">Mulai lagi dari nol</span><h2>Hapus semua data keuangan</h2></div>
                <span className="tag danger-tag"><Icon name="alert" size={14} /> Tidak bisa dibatalkan</span>
              </div>
              <div className="danger-copy">
                <p>Menghapus seluruh transaksi, dompet, kategori, anggaran, dan sesi login. Email dan password kamu tetap dipakai untuk masuk.</p>
                <button className="btn btn-danger" type="button" onClick={() => { setResetPhrase(""); setDialog({ kind: "reset" }); }}>
                  <Icon name="trash" size={16} /> Reset data keuangan
                </button>
              </div>
            </section>
          </>
        )}

        <footer className="footer-note">Finwise · buku kas harian · data tersimpan di akun kamu</footer>
      </section>

      {dialog && dialogMeta && (
        <Modal title={dialogMeta.title} description={dialogMeta.description} onClose={() => { if (!busy) setDialog(null); }}>
          {renderDialogBody()}
        </Modal>
      )}
    </main>
  );
}
