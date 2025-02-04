/**
 * Creates a random hex string for ephemeral topics.
 * Works in both Node.js and browser if properly bundled.
 */
export function randomHexString(byteLength: number): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);

    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    const nodeCrypto = require('crypto');
    const randomBuf = nodeCrypto.randomBytes(byteLength);

    return Array.from(randomBuf, (b: number) => b.toString(16).padStart(2, '0')).join('');
  }
}


export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
