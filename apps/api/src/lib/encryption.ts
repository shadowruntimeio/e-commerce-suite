import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) throw new Error('ENCRYPTION_KEY environment variable is not set')
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters)')
  return buf
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all hex).
 */
export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt a string produced by `encrypt`.
 * Expects format: iv:authTag:ciphertext (all hex).
 */
export function decrypt(encryptedString: string): string {
  const key = getKey()
  const parts = encryptedString.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted string format')
  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}
