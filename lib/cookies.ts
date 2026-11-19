import type { NextResponse } from "next/server";
import { ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE } from "@/lib/auth";

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** Web menyimpan dua cookie httpOnly: akses singkat + refresh panjang. */
export function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string): void {
  res.cookies.set("token", accessToken, { ...base, maxAge: ACCESS_TOKEN_MAX_AGE });
  res.cookies.set("refresh_token", refreshToken, { ...base, maxAge: REFRESH_TOKEN_MAX_AGE });
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set("token", "", { ...base, maxAge: 0 });
  res.cookies.set("refresh_token", "", { ...base, maxAge: 0 });
}
