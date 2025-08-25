
import crypto from 'crypto';
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

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    return Object.keys(obj).sort().reduce((acc: any, k) => {
      acc[k] = sortKeys(obj[k]);
      return acc;
    }, {});
  }
  return obj;
}
/**
 * Signs a payload using a private key.
 * Returns the Base64-encoded signature.
 */
export function signPayload(payload: object | string, privateKeyPem: string): string {
  const canonical = typeof payload === "string"
    ? payload
    : JSON.stringify(sortKeys(payload));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(canonical);
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}


/**
 * Verifies a payload's signature using a public key.
 */

export function verifySignature(
  payload: object | string,
  signature: string,
  publicKeyPem: string
): boolean {
  const canonical = typeof payload === "string"
    ? payload
    : JSON.stringify(sortKeys(payload));
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(canonical);
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}
