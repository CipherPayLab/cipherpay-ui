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
 * Derive Curve25519 keypair directly from wallet signature seed
 * This is the SECURE approach: seed is never stored, only the derived public key is stored in DB
 * 
 * @param seed - The wallet signature seed (BigInt)
 * @returns Curve25519 keypair (public + secret, base64 encoded)
 */
export function deriveCurve25519KeypairFromSeed(seed: bigint): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  // Convert seed to 32 bytes (little-endian) for use as Curve25519 seed
  const max32Bytes = BigInt('0x' + 'ff'.repeat(32));
  const normalizedSeed = seed % max32Bytes;
  const seedBytes = bigIntToBytes32(normalizedSeed);
  
  // Use nacl's keyPair.fromSecretKey() which is deterministic
  // This creates a Curve25519 keypair from the seed
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  
  return {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };
}

// Use SDK functions if available, otherwise fallback to local implementation
function getSDKFunction(name: string): any {
  if (typeof window !== 'undefined' && (window as any).CipherPaySDK) {
    return (window as any).CipherPaySDK[name];
  }
  return null;
}

/**
 * Derive encryption keypair from note encryption public key (for sender/encryption)
 * Uses SDK function if available, otherwise falls back to local implementation
 */
function deriveKeypairFromIdentityPubKey(noteEncPubKey: bigint | string): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  const sdkFn = getSDKFunction('deriveKeypairFromNoteEncPubKey');
  if (sdkFn) {
    return sdkFn(noteEncPubKey);
  }
  
  // Fallback to local implementation (for backward compatibility)
  const pubKeyBI = typeof noteEncPubKey === 'string' 
    ? BigInt(noteEncPubKey.startsWith('0x') ? noteEncPubKey : `0x${noteEncPubKey}`)
    : noteEncPubKey;
  
  const max32Bytes = BigInt('0x' + 'ff'.repeat(32));
  const normalizedPubKey = pubKeyBI % max32Bytes;
  const seedBytes = bigIntToBytes32(normalizedPubKey);
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  
  return {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };
}

/**
 * Derive encryption keypair from identity privKey (for recipient/decryption)
 * Uses SDK function if available, otherwise falls back to local implementation
 */
function deriveKeypairFromIdentityPrivKey(identityPrivKey: bigint): {
  publicKeyB64: string;
  secretKeyB64: string;
} {
  const sdkFn = getSDKFunction('deriveKeypairFromIdentityPrivKey');
  if (sdkFn) {
    return sdkFn(identityPrivKey);
  }
  
  // Fallback to local implementation (for backward compatibility)
  const max32Bytes = BigInt('0x' + 'ff'.repeat(32));
  const normalizedPrivKey = identityPrivKey % max32Bytes;
  const seedBytes = bigIntToBytes32(normalizedPrivKey);
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  
  return {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };
}

/**
 * Derive encryption public key from note encryption public key (for sender)
 * Uses SDK function if available, otherwise falls back to local implementation
 */
export function deriveEncPublicKeyFromIdentityPubKey(noteEncPubKey: bigint | string): string {
  const sdkFn = getSDKFunction('deriveEncPublicKeyFromNoteEncPubKey');
  if (sdkFn) {
    return sdkFn(noteEncPubKey);
  }
  
  // Fallback to local implementation
  const keypair = deriveKeypairFromIdentityPubKey(noteEncPubKey);
  return keypair.publicKeyB64;
}

/**
 * Get CipherPay identity's private key (privKey) from localStorage
 * This is used to derive the encryption keypair (only recipient can do this)
 * 
 * Returns the privKey from the identity keypair, which is derived
 * from the wallet signature (not the actual wallet private key).
 * 
 * SECURITY: Only the recipient can compute their privKey (requires wallet signature).
 * This privKey is used to derive the encryption secret key for decryption.
 */
/**
 * Get CipherPay identity's public key (pubKey) from localStorage
 * This is used to derive the encryption keypair (matches what sender uses from DB)
 * 
 * Returns the pubKey from the identity keypair, which is derived
 * from the wallet signature (not the actual wallet private key).
 * 
 * This pubKey is stored in the DB as note_enc_pub_key and used by senders
 * to derive the encryption public key. Recipients use the same pubKey
 * to derive the matching encryption keypair (including secret key for decryption).
 * 
 * Both sender and recipient derive from the same pubKey (which comes from the same seed),
 * ensuring they get the same encryption keypair.
 */
function getCipherPayPubKey(): bigint | null {
  try {
    const storedIdentity = localStorage.getItem('cipherpay_identity');
    if (!storedIdentity) {
      console.log("[e2ee] No identity found in localStorage under key 'cipherpay_identity'");
      return null;
    }
    
    const parsed = JSON.parse(storedIdentity);
    const keypair = parsed?.keypair;
    if (!keypair || !keypair.pubKey) {
      console.warn("[e2ee] Identity found but missing keypair or pubKey:", {
        hasKeypair: !!keypair,
        hasPubKey: !!keypair?.pubKey,
      });
      return null;
    }
    
    // Convert to BigInt
    const toBigInt = (val: any): bigint => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'string') {
        if (val.startsWith('0x')) return BigInt(val);
        if (/^-?\d+$/.test(val)) return BigInt(val);
      }
      if (typeof val === 'number') return BigInt(val);
      return BigInt(0);
    };
    
    const pubKey = toBigInt(keypair.pubKey);
    console.log("[e2ee] Retrieved identity pubKey from localStorage");
    return pubKey;
  } catch (e) {
    console.warn('[e2ee] Failed to get CipherPay identity pubKey:', e);
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

  // Try to get Curve25519 keypair from identity (stored when derived from wallet signature)
  // This is the secure approach: keypair is derived from wallet signature seed and stored in identity
  // Sender uses Curve25519 public key directly from DB (note_enc_pub_key)
  // Recipient uses Curve25519 keypair from identity (derived from same wallet signature seed)
  let identity: any = null;
  try {
    const storedIdentity = localStorage.getItem('cipherpay_identity');
    if (storedIdentity) {
      identity = JSON.parse(storedIdentity);
    }
  } catch (e) {
    // Ignore errors
  }
  
  if (identity?.curve25519EncPubKey) {
    console.log("[e2ee] Checking for stored Curve25519 keypair in identity...");
    try {
      // Check if we have the full keypair stored (it should be stored when identity is created)
      // The keypair is deterministic from wallet signature, so it's safe to store
      const storedKeypair = localStorage.getItem(LS);
      if (storedKeypair) {
        try {
          const parsed = JSON.parse(storedKeypair);
          if (parsed?.publicKeyB64 && parsed?.secretKeyB64) {
            const verifyPub = b64ToU8(parsed.publicKeyB64);
            const verifySec = b64ToU8(parsed.secretKeyB64);
            if (verifyPub.length === 32 && verifySec.length === 32) {
              // Verify it matches the public key in identity
              if (parsed.publicKeyB64 === identity.curve25519EncPubKey) {
                console.log("[e2ee] Using stored Curve25519 keypair (matches identity public key)");
                return parsed;
              } else {
                console.warn("[e2ee] Stored keypair doesn't match identity public key, will regenerate");
              }
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }
      
      // If we have the public key but not the full keypair, we need to re-derive
      // This requires wallet signature - for now, we'll need to prompt for re-authentication
      console.warn("[e2ee] Curve25519 public key found but keypair not available. Need to re-authenticate to derive keypair.");
    } catch (e) {
      console.error("[e2ee] Failed to get Curve25519 keypair from identity:", e);
    }
  }
  
  // Fallback: Try to get Curve25519 keypair from identity if available
  // The identity should have curve25519EncKeypair stored when derived from wallet signature
  const identityPubKey = getCipherPayPubKey();
  if (identityPubKey) {
    console.log("[e2ee] Fallback: Checking for Curve25519 keypair in identity...");
    try {
      // Try to get from identity's curve25519EncKeypair
      let identity: any = null;
      try {
        const storedIdentity = localStorage.getItem('cipherpay_identity');
        if (storedIdentity) {
          identity = JSON.parse(storedIdentity);
          if (identity?.curve25519EncKeypair) {
            const keypair = identity.curve25519EncKeypair;
            const verifyPub = b64ToU8(keypair.publicKeyB64);
            const verifySec = b64ToU8(keypair.secretKeyB64);
            if (verifyPub.length === 32 && verifySec.length === 32) {
              console.log("[e2ee] Using Curve25519 keypair from identity");
              localStorage.setItem(LS, JSON.stringify(keypair));
              return keypair;
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
      
      // Last resort: Use local fallback derivation (for legacy support)
      const derived = deriveKeypairFromIdentityPubKey(identityPubKey);
      
      // Verify the encoding worked correctly
      const verifyPub = b64ToU8(derived.publicKeyB64);
      const verifySec = b64ToU8(derived.secretKeyB64);
      if (verifyPub.length === 32 && verifySec.length === 32) {
        // Check if there's an existing keypair and if it matches
        try {
          const existing = localStorage.getItem(LS);
          if (existing) {
            const parsed = JSON.parse(existing);
            if (parsed && parsed.publicKeyB64 === derived.publicKeyB64) {
              // Existing keypair matches derived one, use it
              console.log("[e2ee] Stored keypair matches deterministic keypair");
              return parsed;
            } else {
              // Existing keypair doesn't match, replace it
              console.log("[e2ee] Stored keypair doesn't match deterministic one, replacing...");
            }
          }
        } catch (e) {
          // Ignore errors reading existing keypair
        }
        
        // Store the deterministic keypair for future use
        localStorage.setItem(LS, JSON.stringify(derived));
        console.log("[e2ee] Deterministic keypair derived from pubKey and stored successfully");
        return derived;
      } else {
        console.error("[e2ee] Derived keypair has invalid lengths:", {
          pubLen: verifyPub.length,
          secLen: verifySec.length,
        });
      }
    } catch (e) {
      console.error("[e2ee] Failed to derive keypair from identity pubKey:", e);
    }
  } else {
    console.warn("[e2ee] Cannot get identity pubKey, cannot derive deterministic keypair");
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
