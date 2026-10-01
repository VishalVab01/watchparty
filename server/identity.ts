import { createHash, randomBytes } from 'node:crypto';

export function makeId(bytes = 12) {
  return randomBytes(bytes).toString('base64url');
}

export function makeToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
}
