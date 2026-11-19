import { NextResponse } from "next/server";
import { assertProdEnv } from "@/lib/env";

export function proxy() {
  try {
    assertProdEnv();
    return NextResponse.next();
  } catch (error) {
    console.error("Environment check failed:", error);
    return NextResponse.json({ error: "Server belum dikonfigurasi dengan benar." }, { status: 503 });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
