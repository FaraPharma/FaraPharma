import { auditLog } from "@/db/schema";
import type { Tx } from "@/db";

export interface AuditEvent {
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

/**
 * ثبت یک عملیات حساس مدیر؛ داخل همان تراکنشِ خود عملیات (یا هر دو ثبت می‌شوند یا هیچ‌کدام).
 * هرگز رمز، کلید، کوکی یا مقدار حساس در detail نگذارید.
 */
export async function writeAudit(tx: Tx, actorUserId: string, e: AuditEvent): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    detail: e.detail ?? null,
  });
}
