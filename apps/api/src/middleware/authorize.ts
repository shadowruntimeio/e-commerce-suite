import type { FastifyRequest, FastifyReply } from 'fastify'

type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'

export function requireRoles(allowed: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const role = request.user?.role as Role | undefined
    if (!role || !allowed.includes(role)) {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
  }
}
