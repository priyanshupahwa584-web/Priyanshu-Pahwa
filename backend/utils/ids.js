import crypto from 'node:crypto';

export function id(prefix = 'row') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
