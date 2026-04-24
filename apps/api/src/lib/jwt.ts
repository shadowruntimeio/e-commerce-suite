import jwt from 'jsonwebtoken'
import type { JwtPayload } from '@ems/shared'

const ACCESS_SECRET = process.env.JWT_SECRET ?? 'dev-secret'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret'
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN ?? '30d'
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN ?? '30d'

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES } as jwt.SignOptions)
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES } as jwt.SignOptions)
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload
}
