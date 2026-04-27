import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Capability, UserRole } from '@ems/db'

/**
 * Role gate. Use sparingly — prefer requireCapabilities for fine-grained control.
 * ADMIN always passes.
 */
export function requireRoles(allowed: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const role = request.user?.role as UserRole | undefined
    if (!role) return reply.status(403).send({ success: false, error: 'Forbidden' })
    if (role === 'ADMIN') return
    if (!allowed.includes(role)) {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
  }
}

/**
 * Capability gate. ADMIN bypasses. MERCHANT bypasses for routes scoped to own
 * resources (the route handler is responsible for ownerUserId scoping).
 * WAREHOUSE_STAFF must hold all listed capabilities.
 */
export function requireCapabilities(required: Capability[], opts: { allowMerchant?: boolean } = {}) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const u = request.user
    if (!u) return reply.status(401).send({ success: false, error: 'Unauthorized' })
    if (u.role === 'ADMIN') return
    if (u.role === 'MERCHANT') {
      if (opts.allowMerchant) return
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    // WAREHOUSE_STAFF
    const caps = u.capabilities ?? []
    const missing = required.filter(r => !caps.includes(r))
    if (missing.length > 0) {
      return reply.status(403).send({
        success: false,
        error: 'Forbidden',
        missingCapabilities: missing,
      })
    }
  }
}

/** Reject MERCHANT users (admin-only or warehouse-only route). */
export function denyMerchant() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (request.user?.role === 'MERCHANT') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
  }
}
