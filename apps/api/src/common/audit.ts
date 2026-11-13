import type { Tx } from './infra';
import type { AuthUser } from './auth';

/** FR-ADM-04 / TDD 5.14: pencatatan tindakan sensitif (append-only, dijaga trigger). */
export async function audit(c: Tx, actor: AuthUser | null, action: string, entityType: string, entityId: string | null,
  before: unknown, after: unknown, reason: string | null) {
  await c.query(
    `INSERT INTO audit_logs (actor_id, actor_roles, action, entity_type, entity_id, before_data, after_data, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor?.id ?? null, actor?.roles ?? [], action, entityType, entityId, before === null ? null : JSON.stringify(before),
     after === null ? null : JSON.stringify(after), reason]);
}
