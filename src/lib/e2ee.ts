// src/lib/e2ee.ts
import * as nacl from "tweetnacl";

// Detect a real Node.js environment vs browser-with-Buffer-polyfill
const isNode =
  typeof process !== "undefined" &&
  !!(process as any).versions &&
  !!(process as any).versions.node;

export function u8ToB64(u8: Uint8Array): string {
  if (isNode) {
    // True Node.js path
    return Buffer.from(u8).toString("base64");
  }
  // Browser-safe path using btoa
  let s = "";
  for (let i = 0; i < u8.length; i++) {
    s += String.fromCharCode(u8[i]);
  }
  return btoa(s);
}

export function b64ToU8(b64: string): Uint8Array {
  if (isNode) {
    // True Node.js path
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // Browser-safe path using atob
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    u8[i] = bin.charCodeAt(i);
  }
  return u8;
}

// Storage key for local E2EE keypair
const LS = "cps.encKeypair.v1";

/**
 * Convert BigInt to Uint8Array (little-endian, fixed 32 bytes)
 */
function bigIntToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining = remaining >> 8n;
  }
  return bytes;
}

/**
 * Derive a deterministic encryption keypair from CipherPay identity
 * This ensures the same identity always generates the same encryption keypair
 */
function deriveKeypairFromIdentity(privKey: bigint): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  // Convert private key to 32 bytes (little-endian)
  // Take modulo to ensure it fits in 32 bytes
  const max32Bytes = BigInt('0x' + 'ff'.repeat(32));
  const normalizedPrivKey = privKey % max32Bytes;
  const seedBytes = bigIntToBytes32(normalizedPrivKey);
  
  // Use nacl's keyPair.fromSecretKey() which is deterministic
  // This creates a Curve25519 keypair from the seed
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  
  return {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };
}

/**
 * Get CipherPay identity from localStorage
 */
function getCipherPayIdentity(): { privKey: bigint } | null {
  try {
    const storedIdentity = localStorage.getItem('cipherpay_identity');
    if (!storedIdentity) return null;
    
    const parsed = JSON.parse(storedIdentity);
    const keypair = parsed?.keypair;
    if (!keypair || !keypair.privKey) return null;
    
    // Convert privKey to BigInt
    const toBigInt = (val: any): bigint => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'string') {
        if (val.startsWith('0x')) return BigInt(val);
        if (/^-?\d+$/.test(val)) return BigInt(val);
      }
      if (typeof val === 'number') return BigInt(val);
      return BigInt(0);
    };
    
    return { privKey: toBigInt(keypair.privKey) };
  } catch (e) {
    console.warn('[e2ee] Failed to get CipherPay identity:', e);
    return null;
  }
}

// Helper to validate and recreate keypair if corrupted
export function ensureValidKeypair(): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  // First, try to use any existing keypair
  try {
    const existing = localStorage.getItem(LS);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed && parsed.publicKeyB64 && parsed.secretKeyB64) {
          try {
            const decodedPub = b64ToU8(parsed.publicKeyB64);
            const decodedSec = b64ToU8(parsed.secretKeyB64);
            if (decodedPub.length === 32 && decodedSec.length === 32) {
              // Valid keypair, return it
              return parsed;
            } else {
              console.warn("[e2ee] Stored keypair lengths invalid, regenerating...", {
                pubLen: decodedPub.length,
                secLen: decodedSec.length,
              });
            }
          } catch (e) {
            console.warn("[e2ee] Corrupted keypair detected, clearing...", e);
            localStorage.removeItem(LS);
          }
        } else {
          // Parsed but not in expected shape
          localStorage.removeItem(LS);
        }
      } catch (e) {
        // Invalid JSON, clear it
        localStorage.removeItem(LS);
      }
    }
  } catch (e) {
    // Error accessing localStorage; we'll just fall back to creating a new keypair
  }

  // Try to derive from CipherPay identity (deterministic)
  const identity = getCipherPayIdentity();
  if (identity && identity.privKey) {
    console.log("[e2ee] Deriving deterministic encryption keypair from CipherPay identity...");
    try {
      const derived = deriveKeypairFromIdentity(identity.privKey);
      
      // Verify the encoding worked correctly
      const verifyPub = b64ToU8(derived.publicKeyB64);
      const verifySec = b64ToU8(derived.secretKeyB64);
      if (verifyPub.length === 32 && verifySec.length === 32) {
        // Store for future use
        localStorage.setItem(LS, JSON.stringify(derived));
        console.log("[e2ee] Deterministic keypair derived and stored successfully");
        return derived;
      } else {
        console.error("[e2ee] Derived keypair has invalid lengths:", {
          pubLen: verifyPub.length,
          secLen: verifySec.length,
        });
      }
    } catch (e) {
      console.error("[e2ee] Failed to derive keypair from identity:", e);
    }
  } else {
    console.warn("[e2ee] No CipherPay identity found, cannot derive deterministic keypair");
  }

  // Fallback: Create a completely fresh keypair (non-deterministic)
  // This should only happen if identity is not available
  console.warn("[e2ee] Creating non-deterministic encryption keypair (identity not available)");
  localStorage.removeItem(LS); // Ensure it's cleared

  const kp = nacl.box.keyPair();
  const fresh = {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };

  // Verify the encoding worked correctly
  try {
    const verifyPub = b64ToU8(fresh.publicKeyB64);
    const verifySec = b64ToU8(fresh.secretKeyB64);
    if (verifyPub.length !== 32 || verifySec.length !== 32) {
      console.error("[e2ee] Key lengths after round-trip:", {
        pubLen: verifyPub.length,
        secLen: verifySec.length,
      });
      throw new Error(
        `Encoding verification failed: pub=${verifyPub.length}, sec=${verifySec.length}`,
      );
    }
  } catch (e) {
    console.error("[e2ee] Critical: Base64 encoding/decoding is broken!", e);
    throw e;
  }

  localStorage.setItem(LS, JSON.stringify(fresh));
  console.log("[e2ee] Fresh keypair created and stored successfully");
  return fresh;
}

export function getOrCreateLocalEncKeypair(): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  return ensureValidKeypair();
}

export function getLocalEncPublicKeyB64(): string {
  return ensureValidKeypair().publicKeyB64;
}

export function encryptForRecipient(recipientPubB64: string, obj: unknown): string {
  const recipientPk = b64ToU8(recipientPubB64);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = nacl.box(pt, nonce, recipientPk, eph.secretKey);
  const envelope = {
    v: 1,
    epk: u8ToB64(eph.publicKey),
    n: u8ToB64(nonce),
    ct: u8ToB64(ct),
  };
  return btoa(JSON.stringify(envelope));
}

export function decryptFromSenderForMe(ciphertextB64: string): any | null {
  try {
    console.log('[e2ee] decryptFromSenderForMe: Starting decryption');
    console.log('[e2ee] CiphertextB64 type:', typeof ciphertextB64, 'length:', ciphertextB64?.length);
    console.log('[e2ee] CiphertextB64 preview:', ciphertextB64?.substring(0, 100));
    
    const decoded = atob(ciphertextB64);
    console.log('[e2ee] Decoded envelope length:', decoded.length);
    
    const env = JSON.parse(decoded) as {
      v: number;
      epk: string;
      n: string;
      ct: string;
    };
    
    console.log('[e2ee] Envelope version:', env.v);
    if (!env || env.v !== 1) {
      console.warn('[e2ee] Invalid envelope version or missing envelope');
      return null;
    }

    const epk = b64ToU8(env.epk);
    const nonce = b64ToU8(env.n);
    const ct = b64ToU8(env.ct);
    
    console.log('[e2ee] Ephemeral public key length:', epk.length);
    console.log('[e2ee] Nonce length:', nonce.length);
    console.log('[e2ee] Ciphertext length:', ct.length);

    const keypair = getOrCreateLocalEncKeypair();
    const skB64 = keypair.secretKeyB64;
    const sk = b64ToU8(skB64);
    console.log('[e2ee] Secret key length:', sk.length);
    
    const pt = nacl.box.open(ct, nonce, epk, sk);
    if (!pt) {
      console.error('[e2ee] nacl.box.open returned null - decryption failed');
      return null;
    }

    console.log('[e2ee] Decryption successful, plaintext length:', pt.length);
    const result = JSON.parse(new TextDecoder().decode(pt));
    console.log('[e2ee] Parsed JSON keys:', Object.keys(result));
    return result;
  } catch (error) {
    console.error('[e2ee] Error during decryption:', error);
    console.error('[e2ee] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return null;
  }
}
