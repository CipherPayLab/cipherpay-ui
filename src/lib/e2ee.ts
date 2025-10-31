import * as nacl from "tweetnacl";

export function u8ToB64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s);
}
export function b64ToU8(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return u8;
}

const LS = "cps.encKeypair.v1";
export function getOrCreateLocalEncKeypair(): { publicKeyB64: string; secretKeyB64: string } {
  const s = localStorage.getItem(LS);
  if (s) return JSON.parse(s);
  const kp = nacl.box.keyPair();
  const created = { publicKeyB64: u8ToB64(kp.publicKey), secretKeyB64: u8ToB64(kp.secretKey) };
  localStorage.setItem(LS, JSON.stringify(created));
  return created;
}
export function getLocalEncPublicKeyB64(): string {
  return getOrCreateLocalEncKeypair().publicKeyB64;
}

export function encryptForRecipient(recipientPubB64: string, obj: unknown): string {
  const recipientPk = b64ToU8(recipientPubB64);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = nacl.box(pt, nonce, recipientPk, eph.secretKey);
  const envelope = { v: 1, epk: u8ToB64(eph.publicKey), n: u8ToB64(nonce), ct: u8ToB64(ct) };
  return btoa(JSON.stringify(envelope));
}

export function decryptFromSenderForMe(ciphertextB64: string): any | null {
  const env = JSON.parse(atob(ciphertextB64)) as { v: number; epk: string; n: string; ct: string };
  if (!env || env.v !== 1) return null;
  const epk = b64ToU8(env.epk); const nonce = b64ToU8(env.n); const ct = b64ToU8(env.ct);
  const skB64 = getOrCreateLocalEncKeypair().secretKeyB64;
  const sk = b64ToU8(skB64);
  const pt = nacl.box.open(ct, nonce, epk, sk);
  if (!pt) return null;
  return JSON.parse(new TextDecoder().decode(pt));
}
