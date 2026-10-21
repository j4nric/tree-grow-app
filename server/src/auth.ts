/**
 * Passwörter, Benutzernamen und Sitzungstoken – nur node:crypto.
 *
 * Passwort-Hash: scrypt mit zufälligem Salt, gespeichert als
 * `scrypt$N$r$p$<salt base64>$<hash base64>`; Prüfung mit timingSafeEqual.
 * Sitzungstoken: 32 Zufallsbytes (base64url); in der Datenbank steht nur ihr SHA-256.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** N = 2^15 (32 MB Speicher je Rechnung). Die Parameter stehen im Hash – ältere bleiben prüfbar. */
export const SCRYPT = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;
/** Höchstens so viele scrypt-Rechnungen gleichzeitig (Speicherlimit des Containers: 256 MB). */
const MAX_PARALLEL = 2;

let active = 0;
const waiting: (() => void)[] = [];

async function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  // Freier Platz: belegen. Sonst warten – der Platz wird beim Freigeben direkt übergeben.
  if (active < MAX_PARALLEL) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await new Promise((resolve, reject) => {
      scryptCb(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/**
 * Benutzername normalisiert (klein, ohne Rand-Leerraum) oder null, wenn er die Regeln
 * verletzt: 3–32 Zeichen, a–z, 0–9, „_“, „-“, „.“, beginnt mit Buchstabe oder Ziffer.
 */
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return null;
  return /^[a-z0-9][a-z0-9_.-]*$/.test(name) ? name : null;
}

/** Passwort in den erlaubten Längen (Zeichen, nicht Bytes). */
export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && [...value].length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...SCRYPT, maxmem: MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Prüft ein Passwort gegen einen gespeicherten Hash (zeitlich gleichmäßig). Kaputter Hash → false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (expected.length === 0) return false;
  try {
    const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Hash für unbekannte Benutzer: dieselbe Rechenzeit wie bei einem echten Konto. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
