// @ts-nocheck
// File ini adalah TEMPLATE untuk project Expo terpisah. Dependensi aslinya
// (react-native, expo-secure-store) tidak dipasang di workspace Next.js ini,
// jadi pemeriksaan tipe dinonaktifkan di sini agar editor tidak merah.
// Saat disalin ke project Expo asli, hapus baris @ts-nocheck ini.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Button,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";

function getApiBaseUrl() {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!value) throw new Error("Atur EXPO_PUBLIC_API_URL ke alamat API HTTPS di file .env aplikasi Expo.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL harus berupa alamat HTTPS yang valid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("EXPO_PUBLIC_API_URL wajib memakai HTTPS dan tidak boleh berisi kredensial.");
  }

  return url.toString().replace(/\/$/, "");
}

let API: string;
let configError: string | null = null;
try {
  API = getApiBaseUrl();
} catch (error) {
  API = "";
  configError = error instanceof Error ? error.message : "Konfigurasi API tidak valid.";
}

type Tx = {
  id: number;
  type: "INCOME" | "EXPENSE";
  amount: number;
  category: string;
  note?: string | null;
  date: string;
  dateKey?: string;
  walletId?: number | null;
};
type Wallet = { id: number; name: string; balance: number };
type Profile = { name: string; email: string; timezone: string; currency: string };
type SessionInfo = { id: number; label: string; ip: string | null; lastUsedAt: string; current: boolean };
type Form = {
  type: "INCOME" | "EXPENSE";
  amount: string;
  category: string;
  note: string;
  date: string;
  walletId: number | null;
};

const TOKEN_KEY = "finwise.auth.token";
const REFRESH_KEY = "finwise.auth.refresh";

function formatMoney(amount: number, currency = "IDR") {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return new Intl.NumberFormat("id-ID").format(amount);
  }
}

function localDate(timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const emptyForm = (timeZone = "UTC"): Form => ({
  type: "EXPENSE", amount: "", category: "", note: "", date: localDate(timeZone), walletId: null,
});

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

let refreshInFlight: Promise<{ token: string; refreshToken: string } | null> | null = null;

async function refreshSession(onRefreshed?: (token: string) => void) {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const saved = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!saved) return null;
      const r = await call("/api/auth/refresh", "POST", { refreshToken: saved });
      if (!r.ok || !r.d.token || !r.d.refreshToken) return null;
      await SecureStore.setItemAsync(TOKEN_KEY, r.d.token);
      await SecureStore.setItemAsync(REFRESH_KEY, r.d.refreshToken);
      return { token: r.d.token, refreshToken: r.d.refreshToken };
    })()
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  const fresh = await refreshInFlight;
  if (fresh) onRefreshed?.(fresh.token);
  return fresh;
}

async function call(
  path: string,
  method = "GET",
  body?: unknown,
  t?: string | null,
  onRefreshed?: (token: string) => void,
) {
  if (!API) return { ok: false, status: 0, d: { error: configError ?? "Konfigurasi API tidak valid." } };
  const r = await fetch(API + path, {
    method,
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Finwise-Client": "native",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && t && !path.startsWith("/api/auth/")) {
    const fresh = await refreshSession(onRefreshed);
    if (fresh) {
      const retry = await fetch(API + path, {
        method,
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Finwise-Client": "native",
          Authorization: `Bearer ${fresh.token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { ok: retry.ok, status: retry.status, d: await retry.json().catch(() => ({})) };
    }
  }
  return { ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) };
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#78857e" },
  box: { borderWidth: 1, borderColor: "#d9e2dc", borderRadius: 8, padding: 10, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center" },
  chip: { borderWidth: 1, borderColor: "#cbd5ce", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  chipActive: { backgroundColor: "#1f7a5a", borderColor: "#1f7a5a" },
  chipTextActive: { color: "#fff" },
  monthButton: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "#cbd5ce", borderRadius: 8, marginRight: 8 },
  monthLabel: { fontSize: 16, fontWeight: "700", marginRight: 8 },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  itemAction: { paddingHorizontal: 8, paddingVertical: 4 },
  section: { fontWeight: "700", marginTop: 8, marginBottom: 6 },
  summary: { fontSize: 13, marginTop: 4, marginBottom: 8 },
  muted: { fontSize: 12, color: "#78857e" },
});

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [challenge, setChallenge] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [setupChallenge, setSetupChallenge] = useState<{
    challengeToken: string;
    secret: string;
    recoveryCodes: string[];
  } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [items, setItems] = useState<Tx[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [refreshing, setRefreshing] = useState(false);
  const profileLoadedRef = useRef(false);

  const rp = (n: number) => formatMoney(n, profile?.currency ?? "IDR");

  const logoutLocal = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {});
    setToken(null);
    setItems([]);
    setWallets([]);
    setProfile(null);
    setSessions([]);
    setEditingId(null);
    setForm(emptyForm());
    setMonth(localDate().slice(0, 7));
    profileLoadedRef.current = false;
  }, []);

  const authedCall = useCallback(
    (path: string, method = "GET", body?: unknown) => call(path, method, body, token, setToken),
    [token],
  );

  // Satu sumber data: transaksi + dompet diambil bersamaan supaya saldo selalu segar.
  const load = useCallback(
    async (t: string | null, m: string) => {
      if (!t) return;
      const [txRes, walletRes, profileRes, sessionRes] = await Promise.all([
        authedCall(`/api/transactions?month=${m}&limit=200`),
        authedCall("/api/wallets"),
        authedCall("/api/profile"),
        authedCall("/api/sessions"),
      ]);
      if ([txRes, walletRes, profileRes, sessionRes].some((r) => r.status === 401)) {
        await logoutLocal();
        return;
      }
      if (txRes.ok && Array.isArray(txRes.d.items)) setItems(txRes.d.items);
      if (walletRes.ok && Array.isArray(walletRes.d.items)) setWallets(walletRes.d.items);
      if (sessionRes.ok && Array.isArray(sessionRes.d.items)) setSessions(sessionRes.d.items);
      if (profileRes.ok && profileRes.d.profile) {
        const p = profileRes.d.profile as Profile;
        setProfile(p);
        if (!profileLoadedRef.current) {
          profileLoadedRef.current = true;
          setMonth(localDate(p.timezone).slice(0, 7));
          setForm(emptyForm(p.timezone));
        }
      }
    },
    [authedCall, logoutLocal],
  );

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((saved: string | null) => {
        if (!alive) return;
        if (saved) setToken(saved);
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => { alive = false; };
  }, []);

  // Token berubah (login/logout) atau bulan berubah -> muat ulang otomatis.
  useEffect(() => { if (token) void load(token, month); }, [token, month, load]);

  // Sinkron dari web: refresh tiap kali aplikasi kembali ke foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: string) => {
      if (state === "active" && token) void load(token, month);
    });
    return () => sub.remove();
  }, [token, month, load]);

  const setAuth = (k: keyof typeof authForm) => (v: string) => setAuthForm({ ...authForm, [k]: v });
  const set = (k: keyof Form) => (v: string | number | null) => setForm((prev) => ({ ...prev, [k]: v }));

  async function saveSession(tokenValue: string, refreshToken: string) {
    await SecureStore.setItemAsync(TOKEN_KEY, tokenValue);
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    setToken(tokenValue);
    setAuthForm((prev) => ({ ...prev, password: "" }));
  }

  async function auth() {
    const path = mode === "login" ? "/api/auth/mobile-login" : "/api/auth/register";
    const r = await call(path, "POST", { name: authForm.name, email: authForm.email, password: authForm.password });
    if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Coba lagi");
    if (mode === "register") {
      setMode("login");
      return Alert.alert("Berhasil", r.d.message ?? r.d.warning ?? "Cek email untuk verifikasi sebelum masuk.");
    }
    if (r.d.twoFactorSetupRequired && typeof r.d.challengeToken === "string") {
      const setup = await call("/api/auth/2fa/setup", "POST", { challengeToken: r.d.challengeToken });
      if (!setup.ok) return Alert.alert("Gagal", setup.d.error ?? "Gagal menyiapkan 2FA.");
      setSetupCode("");
      setSetupChallenge({
        challengeToken: r.d.challengeToken,
        secret: setup.d.secret,
        recoveryCodes: setup.d.recoveryCodes ?? [],
      });
      return;
    }
    if (r.d.twoFactorRequired && typeof r.d.challengeToken === "string") {
      setTwoFactorCode("");
      setChallenge(r.d.challengeToken);
      return;
    }
    await saveSession(r.d.token, r.d.refreshToken);
  }

  async function verifyForcedSetup() {
    if (!setupChallenge || !setupCode.trim()) return;
    const r = await call("/api/auth/2fa/enable", "POST", {
      challengeToken: setupChallenge.challengeToken,
      code: setupCode.trim(),
      recoveryCodes: setupChallenge.recoveryCodes,
    });
    if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Kode tidak cocok.");
    setSetupChallenge(null);
    await saveSession(r.d.token, r.d.refreshToken);
  }

  async function verifyTwoFactor() {
    if (!challenge || !twoFactorCode.trim()) return;
    const r = await call("/api/auth/2fa/verify-login", "POST", {
      challengeToken: challenge,
      code: twoFactorCode.trim(),
    });
    if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Kode tidak cocok.");
    setChallenge("");
    await saveSession(r.d.token, r.d.refreshToken);
  }

  async function sendAuthEmail(kind: "forgot-password" | "resend-verification") {
    if (!authForm.email.trim()) return Alert.alert("Gagal", "Isi alamat email terlebih dahulu.");
    const r = await call(`/api/auth/${kind}`, "POST", { email: authForm.email.trim() });
    Alert.alert("Permintaan diproses", r.d.message ?? r.d.error ?? "Coba lagi nanti.");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(profile?.timezone));
  }

  function edit(item: Tx) {
    setEditingId(item.id);
    setForm({
      type: item.type,
      amount: String(item.amount),
      category: item.category,
      note: item.note ?? "",
      date: (item.dateKey ?? item.date).slice(0, 10),
      walletId: item.walletId ?? null,
    });
  }

  async function remove(item: Tx) {
    Alert.alert("Hapus transaksi", `Yakin hapus ${item.category} · ${rp(item.amount)}?`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: async () => {
          const r = await authedCall(`/api/transactions/${item.id}`, "DELETE");
          if (r.status === 401) return logoutLocal();
          if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Coba lagi");
          if (editingId === item.id) cancelEdit();
          await load(token, month);
        },
      },
    ]);
  }

  async function save() {
    const amount = Number(form.amount);
    const category = form.category.trim();
    if (!Number.isFinite(amount) || amount <= 0) return Alert.alert("Gagal", "Jumlah harus lebih dari 0.");
    if (!category) return Alert.alert("Gagal", "Kategori wajib diisi.");
    if (!isValidDate(form.date)) return Alert.alert("Gagal", "Tanggal tidak valid (YYYY-MM-DD).");

    const payload = {
      type: form.type,
      amount: Math.round(amount),
      category,
      note: form.note.trim() || undefined,
      date: form.date,
      ...(form.walletId ? { walletId: form.walletId } : {}),
    };
    const r = editingId
      ? await authedCall(`/api/transactions/${editingId}`, "PATCH", payload)
      : await authedCall("/api/transactions", "POST", payload);
    if (r.status === 401) return logoutLocal();
    if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Coba lagi");
    cancelEdit();
    await load(token, month);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load(token, month);
    } finally {
      setRefreshing(false);
    }
  }

  async function signOut() {
    // Cabut sesi perangkat ini di server, bukan hanya hapus di perangkat.
    await authedCall("/api/auth/logout", "POST");
    await logoutLocal();
  }

  async function revokeSession(item: SessionInfo) {
    Alert.alert("Cabut perangkat", `Cabut akses "${item.label}"?`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Cabut",
        style: "destructive",
        onPress: async () => {
          const r = await authedCall(`/api/sessions/${item.id}`, "DELETE");
          if (r.status === 401) return logoutLocal();
          if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Coba lagi");
          if (r.d.current) return logoutLocal();
          await load(token, month);
        },
      },
    ]);
  }

  async function revokeOthers() {
    Alert.alert("Cabut perangkat lain", "Perangkat yang sedang dipakai tetap aktif.", [
      { text: "Batal", style: "cancel" },
      {
        text: "Cabut",
        style: "destructive",
        onPress: async () => {
          const r = await authedCall("/api/sessions", "DELETE");
          if (r.status === 401) return logoutLocal();
          if (!r.ok) return Alert.alert("Gagal", r.d.error ?? "Coba lagi");
          Alert.alert("Berhasil", `${r.d.revoked ?? 0} perangkat lain dicabut.`);
          await load(token, month);
        },
      },
    ]);
  }

  if (configError)
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Konfigurasi aplikasi belum benar</Text>
        <Text>{configError}</Text>
      </SafeAreaView>
    );

  if (!ready) return <SafeAreaView style={styles.screen}><Text>Memuat…</Text></SafeAreaView>;

  if (setupChallenge && !token)
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Pasang authenticator</Text>
        <Text style={styles.muted}>Wajib untuk akun ini. Masukkan kunci berikut di aplikasi authenticator.</Text>
        <Text style={styles.box} selectable>{setupChallenge.secret}</Text>
        <Text style={styles.muted}>Simpan kode pemulihan ini (hanya muncul sekali):</Text>
        <Text style={styles.box} selectable>{setupChallenge.recoveryCodes.join("\n")}</Text>
        <TextInput
          placeholder="Kode 6 digit"
          autoComplete="sms-otp"
          value={setupCode}
          onChangeText={setSetupCode}
          style={styles.box}
        />
        <Button title="Aktifkan 2FA & masuk" onPress={verifyForcedSetup} />
        <View style={{ marginTop: 10 }}>
          <Button title="Kembali" onPress={() => { setSetupChallenge(null); setSetupCode(""); }} />
        </View>
      </SafeAreaView>
    );

  if (challenge && !token)
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Verifikasi dua faktor</Text>
        <Text style={styles.muted}>Masukkan kode 6 digit dari authenticator atau salah satu kode pemulihanmu.</Text>
        <TextInput
          placeholder="123456 atau ABCD12-EF34"
          autoComplete="sms-otp"
          autoCapitalize="characters"
          value={twoFactorCode}
          onChangeText={setTwoFactorCode}
          style={styles.box}
        />
        <Button title="Verifikasi" onPress={verifyTwoFactor} />
        <View style={{ marginTop: 10 }}>
          <Button title="Kembali" onPress={() => { setChallenge(""); setTwoFactorCode(""); }} />
        </View>
      </SafeAreaView>
    );

  if (!token)
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>{mode === "login" ? "Masuk" : "Buat akun"}</Text>
        {mode === "register" && (
          <TextInput placeholder="Nama" value={authForm.name} onChangeText={setAuth("name")} style={styles.box} />
        )}
        <TextInput placeholder="Email" autoCapitalize="none" value={authForm.email} onChangeText={setAuth("email")} style={styles.box} />
        <TextInput placeholder="Password" secureTextEntry value={authForm.password} onChangeText={setAuth("password")} style={styles.box} />
        <Button title={mode === "login" ? "Masuk" : "Daftar"} onPress={auth} />
        {mode === "login" && (
          <View style={{ marginTop: 10 }}>
            <Button title="Lupa password?" onPress={() => sendAuthEmail("forgot-password")} />
            <Button title="Kirim ulang verifikasi" onPress={() => sendAuthEmail("resend-verification")} />
          </View>
        )}
        <View style={{ marginTop: 10 }}>
          <Button
            title={mode === "login" ? "Belum punya akun?" : "Sudah punya akun?"}
            onPress={() => setMode(mode === "login" ? "register" : "login")}
          />
        </View>
      </SafeAreaView>
    );

  const income = items.filter((i) => i.type === "INCOME").reduce((s, i) => s + i.amount, 0);
  const expense = items.filter((i) => i.type === "EXPENSE").reduce((s, i) => s + i.amount, 0);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.row}>
        <TouchableOpacity style={styles.monthButton} onPress={() => setMonth(shiftMonth(month, -1))}>
          <Text>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{month}</Text>
        <TouchableOpacity style={styles.monthButton} onPress={() => setMonth(shiftMonth(month, 1))}>
          <Text>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.summary}>Masuk {rp(income)} · Keluar {rp(expense)}</Text>

      <Text style={styles.section}>{editingId ? "Ubah transaksi" : "Catat transaksi"}</Text>
      <View style={[styles.row, { marginBottom: 8 }]}>
        <TouchableOpacity
          style={[styles.chip, form.type === "EXPENSE" && styles.chipActive]}
          onPress={() => set("type")("EXPENSE")}
        >
          <Text style={form.type === "EXPENSE" && styles.chipTextActive}>Keluar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, form.type === "INCOME" && styles.chipActive]}
          onPress={() => set("type")("INCOME")}
        >
          <Text style={form.type === "INCOME" && styles.chipTextActive}>Masuk</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        placeholder="Jumlah (Rp)"
        keyboardType="numeric"
        value={form.amount}
        onChangeText={set("amount")}
        style={styles.box}
      />
      <TextInput placeholder="Kategori" value={form.category} onChangeText={set("category")} style={styles.box} />
      <TextInput placeholder="Catatan (opsional)" value={form.note} onChangeText={set("note")} style={styles.box} />
      <TextInput
        placeholder="Tanggal (YYYY-MM-DD)"
        value={form.date}
        onChangeText={set("date")}
        style={styles.box}
      />
      <Text style={styles.subtitle}>Dompet</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        <TouchableOpacity
          style={[styles.chip, form.walletId === null && styles.chipActive]}
          onPress={() => set("walletId")(null)}
        >
          <Text style={form.walletId === null && styles.chipTextActive}>Tanpa dompet</Text>
        </TouchableOpacity>
        {wallets.map((w) => (
          <TouchableOpacity
            key={w.id}
            style={[styles.chip, form.walletId === w.id && styles.chipActive]}
            onPress={() => set("walletId")(w.id)}
          >
            <Text style={form.walletId === w.id && styles.chipTextActive}>{w.name} · {rp(w.balance)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.row}>
        <Button title={editingId ? "Simpan perubahan" : "Simpan"} onPress={save} />
        {editingId && <Button title="Batal" onPress={cancelEdit} />}
      </View>

      <FlatList
        data={items}
        keyExtractor={(t: Tx) => String(t.id)}
        style={{ marginTop: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.subtitle}>Belum ada transaksi bulan ini.</Text>}
        renderItem={({ item }: { item: Tx }) => (
          <View style={styles.item}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text>{(item.dateKey ?? item.date).slice(0, 10)} · {item.category}</Text>
              {!!item.note && <Text style={styles.muted}>{item.note}</Text>}
              <Text style={[styles.muted, { color: item.type === "INCOME" ? "#1f7a5a" : "#b42318" }]}>
                {item.type === "INCOME" ? "+" : "−"}{rp(item.amount)}
              </Text>
            </View>
            <TouchableOpacity style={styles.itemAction} onPress={() => edit(item)}><Text>Ubah</Text></TouchableOpacity>
            <TouchableOpacity style={styles.itemAction} onPress={() => remove(item)}><Text>Hapus</Text></TouchableOpacity>
          </View>
        )}
      />
      <Text style={styles.section}>Perangkat aktif</Text>
      {sessions.length === 0 ? (
        <Text style={styles.muted}>Belum ada sesi yang tercatat.</Text>
      ) : (
        sessions.map((s) => (
          <View style={styles.item} key={s.id}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text>{s.label}{s.current ? " · perangkat ini" : ""}</Text>
              <Text style={styles.muted}>{s.ip ? `${s.ip} · ` : ""}{s.lastUsedAt.slice(0, 16).replace("T", " ")}</Text>
            </View>
            {!s.current && (
              <TouchableOpacity style={styles.itemAction} onPress={() => revokeSession(s)}>
                <Text>Cabut</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
      <Button title="Cabut perangkat lain" onPress={revokeOthers} />
      <Button title="Keluar" onPress={signOut} />
    </SafeAreaView>
  );
}
