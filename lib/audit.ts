import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { clientKey } from "@/lib/security";

type AuditInput = {
  action: string;
  userId?: number | null;
  entity?: string;
  entityId?: number;
  req: NextRequest;
};

/** Audit log bersifat best-effort: gagal menulis tidak boleh menggagal bisnis. */
export async function audit({ action, userId = null, entity, entityId, req }: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        userId,
        entity: entity ?? null,
        entityId: entityId ?? null,
        ip: clientKey(req, "audit").slice(0, 191),
      },
    });
  } catch (error) {
    console.error("Gagal menulis audit log:", error);
  }
}
