"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dateKeyInZone, localDateInputValue } from "@/lib/dates";
import { CURRENCIES, TIMEZONES, displayDate, formatMoney } from "@/lib/preferences";
import { api } from "@/components/client-api";
import AuthScreen from "@/components/auth-screen";
import {
  EMPTY_FILTERS,
  EMPTY_SUM,
  type Budget,
  type Category,
  type Filters,
  type Profile,
  type SessionInfo,
  type Sum,
  type Tx,
  type Wallet,
} from "@/components/finance-types";

type Section = "summary" | "transactions" | "profile" | "sessions";

const NAV: { key: Section; label: string; icon: string; target: string }[] = [
  { key: "summary", label: "Ringkasan", icon: "⌂", target: "summary" },
  { key: "transactions", label: "Transaksi", icon: "↕", target: "transaction-history" },
  { key: "profile", label: "Profil", icon: "⚙", target: "profile" },
  { key: "sessions", label: "Perangkat", icon: "▦", target: "sessions" },
];

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

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [sum, setSum] = useState<Sum | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [activeSection, setActiveSection] = useState<Section>("summary");
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
  const prefInitialized = useRef(false);

  const rp = (n: number) => formatMoney(n, profile?.currency ?? "IDR");
  const todayInput = profile ? dateKeyInZone(new Date(), profile.timezone) : localDateInputValue();

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
    api<{ profile: Profile }>("/api/profile").then((r) => {
      if (cancelled || !r.ok || !r.d.profile) return;
      const p = r.d.profile;
      setProfile(p);
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

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await api(`/api/auth/${mode}`, "POST", body);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal");
    if (mode === "register") {
      setMode("login");
      return setMsg(r.d.message ?? r.d.warning ?? "Akun dibuat. Cek email untuk verifikasi.");
    }
    setMsg("");
    refresh();
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

  function addTx(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const walletValue = f.get("walletId");
    void submitForm("/api/transactions", {
      type: f.get("type"),
      amount: Number(f.get("amount")),
      category: f.get("category"),
      note: f.get("note") || undefined,
      date: f.get("date"),
      ...(walletValue ? { walletId: Number(walletValue) } : {}),
    }, form, "Gagal menyimpan transaksi");
  }

  function addWallet(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void submitForm("/api/wallets", { name: f.get("name"), initialBalance: Number(f.get("initialBalance") || 0) }, form, "Gagal menyimpan dompet");
  }

  function addCategory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void submitForm("/api/categories", { name: f.get("name"), type: f.get("type") }, form, "Gagal menyimpan kategori");
  }

  function addBudget(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void submitForm("/api/budgets", { categoryId: Number(f.get("categoryId")), month, limit: Number(f.get("limit")) }, form, "Gagal menyimpan anggaran");
  }

  async function remove(id: number) {
    if (!window.confirm("Hapus transaksi ini?")) return;
    const r = await api(`/api/transactions/${id}`, "DELETE");
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menghapus transaksi");
    refresh();
  }

  function readAmount(label: string, value: string): number | null {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      setMsg(`${label} harus bilangan bulat non-negatif.`);
      return null;
    }
    return amount;
  }

  async function patchAndRefresh(url: string, body: unknown, errorText: string) {
    const r = await api(url, "PATCH", body);
    if (!r.ok) return setMsg(r.d.error ?? errorText);
    setMsg("");
    refresh();
  }

  async function deleteAndRefresh(url: string, confirmText: string, errorText: string) {
    if (!window.confirm(confirmText)) return;
    const r = await api(url, "DELETE");
    if (!r.ok) return setMsg(r.d.error ?? errorText);
    setMsg("");
    refresh();
  }

  function editWallet(wallet: Wallet) {
    const name = window.prompt("Nama dompet", wallet.name);
    if (name === null) return;
    const raw = window.prompt("Saldo awal", String(wallet.initialBalance));
    if (raw === null) return;
    const initialBalance = readAmount("Saldo awal", raw);
    if (initialBalance !== null) void patchAndRefresh(`/api/wallets/${wallet.id}`, { name: name.trim(), initialBalance }, "Gagal memperbarui dompet");
  }

  function removeWallet(wallet: Wallet) {
    void deleteAndRefresh(`/api/wallets/${wallet.id}`, `Hapus dompet "${wallet.name}"? Transaksinya tidak ikut terhapus.`, "Gagal menghapus dompet");
  }

  function editCategory(category: Category) {
    const name = window.prompt("Nama kategori", category.name);
    if (name === null) return;
    const rawType = window.prompt('Tipe (masuk / keluar)', category.type === "INCOME" ? "masuk" : "keluar");
    if (rawType === null) return;
    const normalized = rawType.trim().toLowerCase();
    const type = normalized.startsWith("m") ? "INCOME" : normalized.startsWith("k") ? "EXPENSE" : null;
    if (!type) return setMsg('Tipe harus "masuk" atau "keluar".');
    void patchAndRefresh(`/api/categories/${category.id}`, { name: name.trim(), type }, "Gagal memperbarui kategori");
  }

  function removeCategory(category: Category) {
    void deleteAndRefresh(`/api/categories/${category.id}`, `Hapus kategori "${category.name}"? Anggarannya juga hilang.`, "Gagal menghapus kategori");
  }

  function editBudget(budget: Budget) {
    const raw = window.prompt(`Batas anggaran ${budget.category.name}`, String(budget.limit));
    if (raw === null) return;
    const limit = readAmount("Batas anggaran", raw);
    if (limit === null) return;
    if (limit === 0) return setMsg("Batas anggaran harus lebih dari 0.");
    void patchAndRefresh(`/api/budgets/${budget.id}`, { limit }, "Gagal memperbarui anggaran");
  }

  function removeBudget(budget: Budget) {
    void deleteAndRefresh(`/api/budgets/${budget.id}`, `Hapus anggaran ${budget.category.name}?`, "Gagal menghapus anggaran");
  }

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
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

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await api<{ profile: Profile }>("/api/profile", "PATCH", profileForm);
    if (!r.ok) return setMsg(r.d.error ?? "Gagal menyimpan profil");
    const p = r.d.profile;
    setProfile(p);
    setMonth(dateKeyInZone(new Date(), p.timezone).slice(0, 7));
    setMsg("Profil berhasil disimpan.");
    refresh();
  }

  async function revokeSession(item: SessionInfo) {
    if (!window.confirm(`Cabut akses perangkat "${item.label}"?`)) return;
    const r = await api<{ current?: boolean }>(`/api/sessions/${item.id}`, "DELETE");
    if (!r.ok) return setMsg(r.d.error ?? "Gagal mencabut sesi");
    setSessions((prev) => prev.filter((s) => s.id !== item.id));
    setMsg(r.d.current ? "Sesi perangkat ini dicabut." : "Perangkat berhasil dicabut.");
    if (r.d.current) void logout();
  }

  async function revokeOtherSessions() {
    if (!window.confirm("Cabut semua perangkat lain?")) return;
    const r = await api<{ revoked?: number }>("/api/sessions", "DELETE");
    if (!r.ok) return setMsg(r.d.error ?? "Gagal mencabut sesi");
    void loadSessions();
    setMsg(`${r.d.revoked ?? 0} perangkat lain berhasil dicabut.`);
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
    setMsg("");
    setLoadError("");
  }

  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));

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
      />
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
              onClick={() => {
                setActiveSection(item.key);
                document.getElementById(item.target)?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="logout-button" type="button" onClick={() => logout()}>
          <span>↪</span> Keluar
        </button>
      </aside>

      <section className="dashboard">
        <header className="dashboard-header" id="summary">
          <div>
            <p className="header-kicker">Buku kas · {monthLabel}</p>
            <h1>Halo, {profile?.name ?? "kamu"}.</h1>
          </div>
          <div className="header-actions">
            <div className="month-pill">{monthLabel}</div>
            <a className="export-button" href={`/api/transactions/export?month=${month}`}>↓ Ekspor CSV</a>
          </div>
        </header>

        {msg && <p className={/berhasil|dibuat|terkirim|diproses|aktif/i.test(msg) ? "success" : "err"}>{msg}</p>}
        {loadError && <p className="err">{loadError}</p>}

        <div className="summary-grid">
          <article className="summary-card balance-card">
            <div className="summary-icon">◈</div>
            <div><span>Saldo saat ini</span><strong>{rp(sum?.balance ?? 0)}</strong></div>
          </article>
          <article className="summary-card">
            <div className="summary-icon income-icon">↙</div>
            <div><span>Pemasukan</span><strong className="income-text">{rp(sum?.income ?? 0)}</strong></div>
          </article>
          <article className="summary-card">
            <div className="summary-icon expense-icon">↗</div>
            <div><span>Pengeluaran</span><strong className="expense-text">{rp(sum?.expense ?? 0)}</strong></div>
          </article>
        </div>

        <div className="content-grid">
          <section className="panel transaction-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">Catatan baru</p><h2>Tambah transaksi</h2></div>
            </div>
            <form className="transaction-form" onSubmit={addTx}>
              <label>Tipe
                <select name="type"><option value="EXPENSE">Pengeluaran</option><option value="INCOME">Pemasukan</option></select>
              </label>
              <label>Jumlah
                <input name="amount" type="number" min={1} placeholder="0" required />
              </label>
              <label>Kategori
                {categories.length > 0 ? (
                  <select name="category" required>
                    <option value="">Pilih kategori</option>
                    {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                  </select>
                ) : <input name="category" placeholder="Contoh: Makanan" required />}
              </label>
              <label>Tanggal
                <input name="date" type="date" defaultValue={todayInput} required />
              </label>
              <label>Dompet
                {wallets.length > 0 ? (
                  <select name="walletId">
                    <option value="">Tanpa dompet</option>
                    {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
                  </select>
                ) : <input value="Buat dompet di bawah" readOnly />}
              </label>
              <label className="full-field">Catatan
                <input name="note" placeholder="Keterangan opsional" />
              </label>
              <button className="primary-button full-field" type="submit">Simpan transaksi</button>
            </form>
          </section>

          <section className="panel category-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">Analisis</p><h2>Pengeluaran per kategori</h2></div>
            </div>
            {sum && sum.byCategory.length > 0 ? (
              <div className="category-list">
                {sum.byCategory.slice(0, 5).map((c, index) => {
                  const width = sum.expense ? Math.max(8, Math.round(c.total / sum.expense * 100)) : 0;
                  return (
                    <div className="category-row" key={c.category}>
                      <div className="category-meta">
                        <span><i className={`category-dot dot-${index % 5}`} />{c.category}</span>
                        <strong>{rp(c.total)}</strong>
                      </div>
                      <div className="category-track"><div className={`category-fill dot-${index % 5}`} style={{ width: `${width}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            ) : <div className="empty-small"><span>◫</span><p>Belum ada pengeluaran bulan ini.</p></div>}
          </section>
        </div>

        <div className="management-grid">
          <section className="panel management-panel">
            <div className="panel-heading"><div><p className="panel-kicker">Tempat uang</p><h2>Dompet</h2></div></div>
            <div className="wallet-list">
              {wallets.length === 0 ? <p className="muted-copy">Belum ada dompet.</p> : wallets.map((wallet) => (
                <div className="wallet-chip" key={wallet.id}>
                  <span>{wallet.name}<small>Saldo awal {rp(wallet.initialBalance)}</small></span>
                  <strong>{rp(wallet.balance)}</strong>
                  <span className="mini-actions">
                    <button type="button" className="icon-button" title="Ubah dompet" onClick={() => editWallet(wallet)}>✎</button>
                    <button type="button" className="icon-button danger" title="Hapus dompet" onClick={() => removeWallet(wallet)}>×</button>
                  </span>
                </div>
              ))}
            </div>
            <form className="compact-form" onSubmit={addWallet}>
              <input name="name" placeholder="Nama dompet" required />
              <input name="initialBalance" type="number" min={0} placeholder={`Saldo awal (${profile?.currency ?? "IDR"})`} />
              <button type="submit">Tambah</button>
            </form>
          </section>

          <section className="panel management-panel">
            <div className="panel-heading"><div><p className="panel-kicker">Pengelompokan</p><h2>Kategori</h2></div></div>
            <div className="category-tags">
              {categories.length === 0 ? <p className="muted-copy">Belum ada kategori.</p> : categories.map((category) => (
                <span key={category.id}>
                  {category.name}<i>{category.type === "INCOME" ? "Masuk" : "Keluar"}</i>
                  <button type="button" className="icon-button" title="Ubah kategori" onClick={() => editCategory(category)}>✎</button>
                  <button type="button" className="icon-button danger" title="Hapus kategori" onClick={() => removeCategory(category)}>×</button>
                </span>
              ))}
            </div>
            <form className="compact-form" onSubmit={addCategory}>
              <input name="name" placeholder="Nama kategori" required />
              <select name="type"><option value="EXPENSE">Pengeluaran</option><option value="INCOME">Pemasukan</option></select>
              <button type="submit">Tambah</button>
            </form>
          </section>

          <section className="panel management-panel">
            <div className="panel-heading"><div><p className="panel-kicker">Batas bulanan</p><h2>Anggaran</h2></div></div>
            <div className="budget-list">
              {budgets.length === 0 ? <p className="muted-copy">Belum ada anggaran bulan ini.</p> : budgets.map((budget) => {
                const spent = sum?.byCategory.find((item) =>
                  budget.categoryId != null && item.categoryId != null
                    ? item.categoryId === budget.categoryId
                    : item.category === budget.category.name,
                )?.total ?? 0;
                const percent = Math.min(100, budget.limit ? Math.round(spent / budget.limit * 100) : 0);
                return (
                  <div className={`budget-row ${percent >= 100 ? "over" : percent >= 80 ? "near" : ""}`} key={budget.id}>
                    <div>
                      <span>{budget.category.name}</span>
                      <strong>{rp(spent)} / {rp(budget.limit)}</strong>
                      <span className="mini-actions">
                        <button type="button" className="icon-button" title="Ubah batas" onClick={() => editBudget(budget)}>✎</button>
                        <button type="button" className="icon-button danger" title="Hapus anggaran" onClick={() => removeBudget(budget)}>×</button>
                      </span>
                    </div>
                    <div className="category-track"><div className={percent >= 100 ? "category-fill dot-1" : "category-fill dot-0"} style={{ width: `${percent}%` }} /></div>
                    {percent >= 100 && <small className="budget-badge over">Melewati batas</small>}
                    {percent >= 80 && percent < 100 && <small className="budget-badge">Hampir habis</small>}
                  </div>
                );
              })}
            </div>
            <form className="compact-form" onSubmit={addBudget}>
              <select name="categoryId" required>
                <option value="">Kategori</option>
                {categories.filter((category) => category.type === "EXPENSE").map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              <input name="limit" type="number" min={1} placeholder={`Batas (${profile?.currency ?? "IDR"})`} required />
              <button type="submit">Atur</button>
            </form>
          </section>
        </div>

        <section className="panel profile-panel" id="profile">
          <div className="panel-heading">
            <div><p className="panel-kicker">Preferensi akun</p><h2>Profil</h2></div>
            <span className="transaction-count">{profile?.email ?? ""}</span>
          </div>
          <form className="profile-form" onSubmit={saveProfile}>
            <label>Nama
              <input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} minLength={2} maxLength={60} required />
            </label>
            <label>Zona waktu
              <select value={profileForm.timezone} onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}>
                {TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
              </select>
            </label>
            <label>Mata uang
              <select value={profileForm.currency} onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit">Simpan profil</button>
          </form>
          <p className="muted-copy">Tanggal yang sudah tercatat tidak berubah saat zona waktu diganti.</p>
        </section>

        <section className="panel sessions-panel" id="sessions">
          <div className="panel-heading">
            <div><p className="panel-kicker">Keamanan akun</p><h2>Perangkat aktif</h2></div>
            <button className="text-button" type="button" onClick={revokeOtherSessions}>Cabut perangkat lain</button>
          </div>
          {sessions.length === 0 ? (
            <p className="muted-copy">Belum ada sesi yang tercatat.</p>
          ) : (
            <div className="session-list">
              {sessions.map((item) => (
                <div className="session-row" key={item.id}>
                  <div className="session-detail">
                    <strong>{item.label}</strong>
                    <span>{item.current ? "Perangkat ini · " : ""}{item.ip ? `${item.ip} · ` : ""}terakhir dipakai {fmtDateTime(item.lastUsedAt)}</span>
                    <small>Masuk {fmtDateTime(item.createdAt)} · berlaku sampai {fmtDateTime(item.expiresAt)}</small>
                  </div>
                  {item.current ? (
                    <button className="text-button" type="button" onClick={() => logout()}>Keluar</button>
                  ) : (
                    <button className="text-button" type="button" onClick={() => revokeSession(item)}>Cabut</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="muted-copy">Login dari perangkat baru otomatis dikirimi notifikasi ke email kamu.</p>
        </section>

        <section className="panel history-panel" id="transaction-history">
          <div className="panel-heading">
            <div><p className="panel-kicker">Aktivitas terbaru</p><h2>Riwayat transaksi</h2></div>
            <span className="transaction-count">Menampilkan {txs.length} dari {txTotal} transaksi</span>
          </div>
          <form className="filter-bar" onSubmit={applyFilters}>
            <input aria-label="Cari transaksi" placeholder="Cari kategori atau catatan…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            <select aria-label="Filter kategori" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">Semua kategori</option>
              {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
            </select>
            <input aria-label="Dari tanggal" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <input aria-label="Sampai tanggal" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            <button type="submit">Terapkan</button>
            <button type="button" className="ghost-button" onClick={resetFilters}>Reset</button>
          </form>
          {txs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⇄</div>
              <h3>Belum ada transaksi</h3>
              <p>Tambahkan transaksi pertamamu untuk memulai pencatatan.</p>
            </div>
          ) : (
            <div className="transaction-list">
              {txs.map((t) => (
                <article className="transaction-row" key={t.id}>
                  <div className={`transaction-icon ${t.type === "INCOME" ? "income-icon" : "expense-icon"}`}>
                    {t.type === "INCOME" ? "↙" : "↗"}
                  </div>
                  <div className="transaction-info">
                    <strong>{t.category}</strong>
                    <span>{t.note || "Tanpa catatan"} · {displayDate(t.dateKey ?? t.date.slice(0, 10))}</span>
                  </div>
                  <strong className={t.type === "INCOME" ? "income-text" : "expense-text"}>
                    {t.type === "INCOME" ? "+" : "−"}{rp(t.amount)}
                  </strong>
                  <button className="delete-button" type="button" title="Hapus transaksi" onClick={() => remove(t.id)}>×</button>
                </article>
              ))}
            </div>
          )}
          {txs.length < txTotal && (
            <button className="text-button" type="button" onClick={loadMore} style={{ marginTop: 12 }}>Muat lebih banyak</button>
          )}
        </section>
      </section>
    </main>
  );
}
