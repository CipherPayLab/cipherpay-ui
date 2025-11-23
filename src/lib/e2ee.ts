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

  // Create a completely fresh keypair
  console.log("[e2ee] Creating fresh encryption keypair...");
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
  const env = JSON.parse(atob(ciphertextB64)) as {
    v: number;
    epk: string;
    n: string;
    ct: string;
  };
  if (!env || env.v !== 1) return null;

  const epk = b64ToU8(env.epk);
  const nonce = b64ToU8(env.n);
  const ct = b64ToU8(env.ct);

  const skB64 = getOrCreateLocalEncKeypair().secretKeyB64;
  const sk = b64ToU8(skB64);
  const pt = nacl.box.open(ct, nonce, epk, sk);
  if (!pt) return null;

  return JSON.parse(new TextDecoder().decode(pt));
}
