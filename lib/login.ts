import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { REFRESH_TOKEN_MAX_AGE, signToken } from "@/lib/auth";
import { setAuthCookies } from "@/lib/cookies";
import { deviceLabel } from "@/lib/device";
import { authSchema } from "@/lib/schemas";
import { clientIp } from "@/lib/security";
import { dbRateLimit } from "@/lib/rate-limit-db";
import { hashToken, newToken } from "@/lib/tokens";
import { protectArcjet } from "@/lib/arcjet";
import { loginFailedEmail, loginNoticeEmail, securityLockoutEmail, sendMail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { publicOrigin } from "@/lib/origin";
import { requiresTwoFactor } from "@/lib/allowlist";
import { signTwoFactorChallenge, signTwoFactorSetupChallenge } from "@/lib/two-factor";

const WRONG = { error: "Email atau password salah" };

// Hash "palsu" dipakai supaya walltime saat email tidak ditemukan sama seperti
// saat email ditemukan -> tidak bisa dibedakan lewat timing.
const DUMMY_HASH = bcrypt.hashSync("finwise-dummy-password-for-constant-time", 12);

type LoginUser = {
  id: number;
  name: string;
  email: string;
  tokenVersion: number;
  twoFactorEnabled?: boolean;
};

async function notifyLockout(email: string, req: NextRequest): Promise<void> {
  // Maksimal satu email lockout per akun per 15 menit, tersimpan di database.
  const hit = await dbRateLimit(`login-lockout-mail:${email.trim().toLowerCase()}`, 1, 15 * 60_000);
  if (!hit.allowed) return;

  const link = `${publicOrigin()}/#security`;
  void sendMail({
    to: email,
    subject: "Aktivitas login mencurigakan di Finwise",
    html: securityLockoutEmail(link, deviceLabel(req.headers.get("user-agent")), clientIp(req) ?? ""),
  }).catch((error) => console.error("Gagal mengirim notifikasi penguncian:", error));
}

async function notifyFailedLogin(email: string, req: NextRequest): Promise<void> {
  // Satu notifikasi per email per 15 menit, tersimpan di database.
  const hit = await dbRateLimit(`login-fail-mail:${email.trim().toLowerCase()}`, 1, 15 * 60_000);
  if (!hit.allowed) return;

  const link = `${publicOrigin()}/#sessions`;
  void sendMail({
    to: email,
    subject: "Percobaan login gagal di Finwise",
    html: loginFailedEmail(link, deviceLabel(req.headers.get("user-agent")), clientIp(req) ?? ""),
  }).catch((error) => console.error("Gagal mengirim notifikasi login gagal:", error));
}

/** Dipanggil setelah password (dan 2FA, bila aktif) terverifikasi. */
export async function completeLogin(req: NextRequest, user: LoginUser, issueToken: boolean) {
  // Akun yang masuk dalam daftar wajib 2FA tidak boleh mendapat sesi sebelum
  // authenticator dipasang. Challenge ini hanya berlaku 5 menit.
  if (requiresTwoFactor(user.email) && !user.twoFactorEnabled) {
    const challengeToken = await signTwoFactorSetupChallenge({
      uid: user.id,
      tv: user.tokenVersion,
      issueToken,
    });
    void audit({ action: "TWO_FACTOR_SETUP_REQUIRED", userId: user.id, entity: "User", entityId: user.id, req });
    return NextResponse.json({ twoFactorSetupRequired: true, challengeToken });
  }

  void audit({ action: "LOGIN_SUCCESS", userId: user.id, entity: "User", entityId: user.id, req });

  const label = deviceLabel(req.headers.get("user-agent"));
  const ip = clientIp(req);
  const now = new Date();
  const refreshToken = newToken();

  // Deteksi perangkat baru sebelum membuat sesi, supaya notifikasi tidak
  // dikirim tiap kali perangkat yang sama masuk lagi.
  const known = await db.session.findFirst({
    where: { userId: user.id, label, ip: ip ?? null, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });

  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      label,
      ip,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_MAX_AGE * 1000),
    },
    select: { id: true },
  });
  const token = await signToken(user.id, user.tokenVersion, session.id);

  const body: Record<string, unknown> = { name: user.name };
  // Token HANYA dikembalikan untuk klien native yang memang membutuhkannya.
  // Web memakai cookie httpOnly agar token tidak bisa dibaca JavaScript.
  if (issueToken) {
    body.token = token;
    body.refreshToken = refreshToken;
  }

  const res = NextResponse.json(body);
  setAuthCookies(res, token, refreshToken);
  void audit({ action: "SESSION_CREATE", userId: user.id, entity: "Session", entityId: session.id, req });

  if (!known) {
    const link = `${publicOrigin()}/#sessions`;
    void sendMail({
      to: user.email,
      subject: "Login baru di Finwise",
      html: loginNoticeEmail(link, label, ip ?? ""),
    }).catch((error) => console.error("Gagal mengirim notifikasi login:", error));
  }
  return res;
}

export async function handleLogin(req: NextRequest, issueToken: boolean) {
  const guard = await protectArcjet(req, "login");
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const parsed = authSchema.omit({ name: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    await bcrypt.compare("invalid-password", DUMMY_HASH);
    return NextResponse.json(WRONG, { status: 401 });
  }

  const { email, password } = parsed.data;
  const byEmail = await dbRateLimit(`login-email:${email}`, 5, 15 * 60_000);
  if (!byEmail.allowed) {
    await bcrypt.compare(password, DUMMY_HASH);
    const headers = { "Retry-After": String(byEmail.retryAfter) };
    return NextResponse.json({ error: `Terlalu banyak percobaan untuk akun ini. Coba lagi ${byEmail.retryAfter} detik.` }, { status: 429, headers });
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      tokenVersion: true,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    void audit({ action: "LOGIN_FAILED", userId: user?.id ?? null, req });
    if (user) {
      // Setelah 3 kegagalan dalam jendela yang sama, cabut sesi aktif dan
      // beri tahu pemilik. Attacker tetap melihat pesan error yang sama.
      if ((byEmail.count ?? 1) >= 3) {
        // Cabut refresh session DAN token akses yang sedang berjalan.
        await db.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await db.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
        void audit({ action: "SUSPICIOUS_LOGIN_LOCKOUT", userId: user.id, entity: "User", entityId: user.id, req });
        await notifyLockout(user.email, req);
      } else {
        await notifyFailedLogin(user.email, req);
      }
    }
    return NextResponse.json(WRONG, { status: 401 });
  }
  if (!user.emailVerified) {
    void audit({ action: "LOGIN_UNVERIFIED", userId: user.id, entity: "User", entityId: user.id, req });
    return NextResponse.json(
      { error: "Email belum terverifikasi. Cek email kamu atau gunakan Kirim ulang verifikasi.", unverified: true },
      { status: 403 },
    );
  }

  if (user.twoFactorEnabled) {
    void audit({ action: "LOGIN_2FA_REQUIRED", userId: user.id, entity: "User", entityId: user.id, req });
    const challengeToken = await signTwoFactorChallenge({
      uid: user.id,
      tv: user.tokenVersion,
      issueToken,
    });
    return NextResponse.json({ twoFactorRequired: true, challengeToken });
  }

  return completeLogin(req, user, issueToken);
}
