import crypto from 'crypto';
import { SignatureError } from './errors';

/**
 * A robust, recursive function for creating a consistent, sorted string from an object.
 * This ensures that the same object will always produce the same string for signing,
 * regardless of key order in nested objects.
 */
function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((result: any, key: string) => {
        result[key] = sortKeys(obj[key]);
        return result;
      }, {});
  }
  return obj;
}

/**
 * Signs a payload using the provided RSA private key.
 * @param payload The object or string to sign.
 * @param privateKeyPem The PEM-formatted RSA private key.
 * @returns A Base64-encoded signature.
 */
export function signPayload(payload: object | string, privateKeyPem: string): string {
  // Use the robust sortKeys for canonicalization
  const canonical = typeof payload === 'string' ? payload : JSON.stringify(sortKeys(payload));
  
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonical);
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

/**
 * Verifies a payload's signature using a public key.
 */
export function verifySignature(payload: object | string, signature: string, publicKey: string): boolean {
  try {
    const canonical = typeof payload === 'string' ? payload : JSON.stringify(sortKeys(payload));
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonical);
    verifier.end();
    // The library expects the public key to be in PEM format.
    // If it's Base64, it should be decoded before being passed here.
    // However, this client only signs, so we assume the verifier (your backend) handles this.
    return verifier.verify(publicKey, signature, 'base64');
  } catch (error) {
    console.error("Signature verification failed within SDK:", error);
    return false;
  }
}

/** Simple async delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
