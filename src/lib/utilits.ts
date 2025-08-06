import crypto from 'crypto';

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((result: any, key: string) => {
      result[key] = sortKeys(obj[key]);
      return result;
    }, {});
  }
  return obj;
}

export function signPayload(payload: object | string, privateKeyPem: string): string {
  const canonical = typeof payload === 'string' ? payload : JSON.stringify(sortKeys(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonical);
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

export function verifySignature(payload: object | string, signature: string, publicKey: string): boolean {
  try {
    const canonical = typeof payload === 'string' ? payload : JSON.stringify(sortKeys(payload));
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonical);
    verifier.end();
    // This function expects a PLAIN PEM public key, NOT Base64.
    return verifier.verify(publicKey, signature, 'base64');
  } catch (error) {
    return false;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
