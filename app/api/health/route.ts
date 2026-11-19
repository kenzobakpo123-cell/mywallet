import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1 AS ok`;
    return NextResponse.json({ status: "ok", db: "up", time: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
