import type { NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { verifyTwoFactorSetupChallenge } from "@/lib/two-factor";

export type TwoFactorActor = {
  uid: number;
  /** Klien native perlu token di body; web cukup cookie httpOnly. */
  issueToken: boolean;
  /** true bila akun diwajibkan 2FA dan belum punya sesi. */
  forced: boolean;
};

/**
 * Setup/enable 2FA boleh dijalankan oleh sesi yang sudah login, atau oleh
 * challenge 5 menit yang diberikan setelah password benar untuk akun wajib 2FA.
 */
export async function twoFactorActor(req: NextRequest, body: unknown): Promise<TwoFactorActor | null> {
  const raw = (body as { challengeToken?: unknown } | null)?.challengeToken;
  if (typeof raw === "string" && raw.length > 20) {
    const challenge = await verifyTwoFactorSetupChallenge(raw);
    return challenge ? { uid: challenge.uid, issueToken: challenge.issueToken, forced: true } : null;
  }

  const viewer = await getViewer(req);
  return viewer ? { uid: viewer.uid, issueToken: false, forced: false } : null;
}
