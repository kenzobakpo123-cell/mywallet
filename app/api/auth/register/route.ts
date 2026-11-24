import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authSchema } from "@/lib/schemas";
import { protectArcjet } from "@/lib/arcjet";
import { hashToken, newToken } from "@/lib/tokens";
import { sendMail, verificationEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const p = authSchema.safeParse(await req.json().catch(() => null));
  if (!p.success || !p.data.name) {
    return NextResponse.json({ error: "Nama, email, dan password (min. 8 karakter, maks. 72 byte) wajib diisi" }, { status: 400 });
  }

  const guard = await protectArcjet(req, "register", p.data.email);
  if (guard.denied) {
    const headers = guard.retryAfter ? { "Retry-After": String(guard.retryAfter) } : undefined;
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers });
  }

  const { name, email, password } = p.data;
  const rawToken = newToken();
  let createdId = 0;
  try {
    // Mengandalkan constraint UNIQUE, bukan findUnique + create (TOCTOU).
    const created = await db.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        verificationToken: hashToken(rawToken),
        verificationExpires: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    createdId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Email tidak dapat digunakan" }, { status: 409 });
    }
    console.error("Gagal mendaftarkan user:", error);
    return NextResponse.json({ error: "Pendaftaran gagal. Silakan coba lagi." }, { status: 500 });
  }

  void audit({ action: "REGISTER", userId: createdId, entity: "User", entityId: createdId, req });

  const link = `${req.nextUrl.origin}/api/auth/verify-email?token=${rawToken}`;
  try {
    await sendMail({ to: email, subject: "Verifikasi email Finwise", html: verificationEmail(link) });
    return NextResponse.json({ ok: true, message: "Akun dibuat. Cek email untuk verifikasi." }, { status: 201 });
  } catch (error) {
    console.error("Gagal mengirim email verifikasi:", error);
    return NextResponse.json(
      { ok: true, warning: "Akun dibuat, tapi email verifikasi gagal dikirim. Gunakan menu Kirim ulang verifikasi." },
      { status: 201 },
    );
  }
}
