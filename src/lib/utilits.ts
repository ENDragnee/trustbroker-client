import {
  createSign,
  createVerify,
  KeyObject,
} from 'crypto';
import { SignatureError } from './errors';

/**
 * Canonicalizes an object for consistent cryptographic signing.
 * Sorts keys recursively to ensure deterministic output.
 */
export function canonicalizeBody(data: any): string {
  if (data === null || typeof data !== 'object') return JSON.stringify(data);
  if (Array.isArray(data)) return `[${data.map(canonicalizeBody).join(',')}]`;

  const sortedKeys = Object.keys(data).sort();
  const entries = sortedKeys.map((key) => {
    return `"${key}":${canonicalizeBody(data[key])}`;
  });

  return `{${entries.join(',')}}`;
}

/**
 * Convert any payload into a canonical Buffer.
 * Uses sorted keys to ensure deterministic signature input.
 */
export function toBuffer(payload: object | string | Buffer): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  const canonical = canonicalizeBody(payload);
  return Buffer.from(canonical, 'utf8');
}

/** Simple async delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Signs a payload using a private key.
 * Returns the Base64-encoded signature.
 */
export function signPayload(
  privateKey: KeyObject,
  payload: object | string | Buffer
): string {
  try {
    const buffer = toBuffer(payload);
    const signer = createSign('SHA256');
    signer.update(buffer);
    return signer.sign(privateKey, 'base64');
  } catch (err) {
    throw new SignatureError('SIGNING_FAILED', (err as Error).message);
  }
}

/**
 * Verifies a payload's signature using a public key.
 */
export function verifySignature(
  publicKey: KeyObject,
  payload: object | string | Buffer,
  signature: string
): boolean {
  try {
    const buffer = toBuffer(payload);
    const verifier = createVerify('SHA256');
    verifier.update(buffer);
    return verifier.verify(publicKey, signature, 'base64');
  } catch (err) {
    throw new SignatureError('VERIFICATION_FAILED', (err as Error).message);
  }
}
