import { NextRequest } from "next/server";
import { handleLogin } from "@/lib/login";
import { forbidden, isSameOrigin } from "@/lib/security";

// Web: token hanya disimpan di cookie httpOnly.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return forbidden();
  return handleLogin(req, false);
}
