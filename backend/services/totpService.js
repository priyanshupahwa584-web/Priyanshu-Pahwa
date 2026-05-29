import crypto from 'node:crypto';
import { config } from '../config.js';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const codeLength = 6;
const stepSeconds = 30;

function normalizeBase32(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function decodeBase32(secret) {
  let bits = '';
  for (const char of normalizeBase32(secret)) {
    const value = base32Alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function counterBuffer(counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

function hotp(secret, counter) {
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** codeLength).padStart(codeLength, '0');
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest();
}

export function generateTotpSecret() {
  return Array.from({ length: 32 }, () => base32Alphabet[crypto.randomInt(base32Alphabet.length)]).join('');
}

export function totpUri({ username, secret }) {
  const issuer = 'Broadreach Operations Platform';
  const label = `${issuer}:${username}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${codeLength}&period=${stepSeconds}`;
}

export function verifyTotp(secret, token, window = 1) {
  const cleanToken = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanToken) || !secret) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, currentCounter + offset) === cleanToken) return true;
  }
  return false;
}

export function encryptSecret(secret) {
  if (!secret) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptSecret(value) {
  if (!value) return '';
  if (!String(value).startsWith('enc:')) return value;
  const payload = Buffer.from(String(value).slice(4), 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const first = crypto.randomBytes(3).toString('hex').toUpperCase();
    const second = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${first}-${second}`;
  });
}
