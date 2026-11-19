import { NextRequest } from "next/server";
import { handleLogin } from "@/lib/login";

// Klien native Expo tidak bisa memakai cookie lintas origin, jadi token
// dikembalikan di body secara eksplisit pada endpoint khusus ini.
export async function POST(req: NextRequest) {
  return handleLogin(req, true);
}
