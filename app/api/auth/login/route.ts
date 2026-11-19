import { NextRequest } from "next/server";
import { handleLogin } from "@/lib/login";

// Web: token hanya disimpan di cookie httpOnly.
export async function POST(req: NextRequest) {
  return handleLogin(req, false);
}
