import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../lib/jwt'

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Unauthorized' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = verifyAccessToken(token)
    request.user = payload
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' })
  }
}

// Augment FastifyRequest type
declare module 'fastify' {
  interface FastifyRequest {
    user: import('@ems/shared').JwtPayload
  }
}
