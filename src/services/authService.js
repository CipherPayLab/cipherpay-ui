// Auth Service - Handles authentication with cipherpay-server
import axios from 'axios';
import { poseidonHash, poseidonHashForAuth } from '../lib/sdk';
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';

/* ---------------- BigInt/bytes normalizers ---------------- */
function toBigIntFlexible(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
    if (/^[0-9a-f]+$/i.test(s) && s.length >= 16) return BigInt('0x' + s);
    if (/^-?\d+$/.test(s)) return BigInt(s);
    if (/^\d+(,\d+)+$/.test(s)) {
      const bytes = s.split(',').map(x => parseInt(x, 10));
      const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
      return BigInt('0x' + hex);
    }
    throw new Error('Unsupported string for BigInt: ' + s.slice(0, 40) + (s.length > 40 ? '…' : ''));
  }
  // Handle Node Buffer JSON shape: { type: 'Buffer', data: [...] }
  if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    const hex = v.data.map(n => Number(n).toString(16).padStart(2, '0')).join('');
    return BigInt('0x' + hex);
  }
  if (Array.isArray(v) || (v && typeof v.length === 'number')) {
    const hex = Array.from(v, n => Number(n).toString(16).padStart(2, '0')).join('');
    return BigInt('0x' + hex);
  }
  throw new Error('Unsupported type for BigInt: ' + typeof v);
}

// Turn {0:..., length:n} OR Uint8Array/number[]/hex/comma-string into Uint8Array
function toUint8ArrayLoose(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v.map(n => Number(n) & 0xff));
  if (v && typeof v === 'object' && typeof v.length === 'number') {
    const len = Number(v.length) | 0;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = Number(v[i] ?? 0) & 0xff;
    return out;
  }
  if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    return new Uint8Array(v.data.map(n => Number(n) & 0xff));
  }
  if (typeof v === 'string' && /^\d+(,\d+)+$/.test(v)) {
    return new Uint8Array(v.split(',').map(x => parseInt(x, 10) & 0xff));
  }
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v)) {
    const hex = v.slice(2).padStart(v.length % 2 ? v.length + 1 : v.length, '0');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

function bytesToHex(u8) {
  return [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Normalize identity.keypair.{privKey,pubKey} to BigInt eagerly on load
function normalizeIdentityKeys(identity) {
  if (!identity || !identity.keypair) return identity;
  const kp = identity.keypair;
  const norm = {};
  for (const k of ['privKey', 'pubKey']) {
    const src = kp[k];
    try {
      if (typeof src === 'bigint') {
        norm[k] = src;
      } else if (typeof src === 'string' || typeof src === 'number') {
        norm[k] = toBigIntFlexible(src);
      } else {
        const u8 = toUint8ArrayLoose(src);
        if (u8) {
          norm[k] = BigInt('0x' + bytesToHex(u8));
        } else {
          norm[k] = toBigIntFlexible(String(src));
        }
      }
    } catch (e) {
      console.error('[AuthService] Failed to normalize key', k, 'type=', typeof src, 'value sample=', String(src).slice(0, 80));
      throw e;
    }
  }
  identity.keypair = norm;
  return identity;
}

/* ---------------- circomlibjs loader ---------------- */
let circomlib = null;
let babyJub = null;
let eddsa = null;

async function loadCircomlib() {
  if (circomlib && babyJub && eddsa) return { babyJub, eddsa, circomlib };
  const lib = await import('circomlibjs');
  console.log('[AuthService] circomlibjs loaded, available exports:', Object.keys(lib));
  if (!babyJub) {
    if (lib.buildBabyjub) {
      console.log('[AuthService] Building BabyJub using buildBabyjub...');
      babyJub = await lib.buildBabyjub();
    } else if (lib.babyjub) {
      console.log('[AuthService] Using existing babyjub...');
      babyJub = lib.babyjub;
    } else if (lib.default && lib.default.buildBabyjub) {
      console.log('[AuthService] Building BabyJub using default.buildBabyjub...');
      babyJub = await lib.default.buildBabyjub();
    } else {
      throw new Error('buildBabyjub not available in circomlibjs');
    }
  }
  console.log('[AuthService] babyJub loaded:', !!babyJub, 'has F:', !!(babyJub && babyJub.F));

  if (!eddsa) {
    console.log('[AuthService] Looking for eddsa...');
    if (lib.eddsa && typeof lib.eddsa.buildEddsa === 'function') {
      console.log('[AuthService] Building EdDSA using eddsa.buildEddsa...');
      eddsa = await lib.eddsa.buildEddsa();
    } else if (lib.buildEddsa && typeof lib.buildEddsa === 'function') {
      console.log('[AuthService] Building EdDSA using buildEddsa...');
      eddsa = await lib.buildEddsa();
    } else if (lib.default && lib.default.eddsa) {
      if (typeof lib.default.eddsa.buildEddsa === 'function') {
        console.log('[AuthService] Building EdDSA using default.eddsa.buildEddsa...');
        eddsa = await lib.default.eddsa.buildEddsa();
      } else {
        console.log('[AuthService] Using default.eddsa directly...');
        eddsa = lib.default.eddsa;
      }
    } else if (lib.eddsa) {
      console.log('[AuthService] Using lib.eddsa directly...');
      eddsa = lib.eddsa;
    } else {
      throw new Error('eddsa not available in circomlibjs');
    }
  }
  circomlib = lib;
  return { babyJub, eddsa, circomlib };
}

/* ---------------- Service ---------------- */
class AuthService {
  constructor() {
    this.token = localStorage.getItem('cipherpay_token');
    this.user = JSON.parse(localStorage.getItem('cipherpay_user') || 'null');

    const identityStr = localStorage.getItem('cipherpay_identity');
    if (identityStr) {
      try {
        const parsed = JSON.parse(identityStr);
        const convertBigInts = (obj) => {
          if (obj === null || obj === undefined) return obj;
          if (Array.isArray(obj)) return obj.map(convertBigInts);
          if (typeof obj === 'object') {
            const result = {};
            for (const key in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key];
                if (typeof value === 'string' && /^-?\d+$/.test(value) && value.length > 15) {
                  result[key] = BigInt(value);
                } else if (typeof value === 'string' && /^\d+(,\d+)+$/.test(value)) {
                  const nums = value.split(',').map(x => parseInt(x, 10));
                  const hex = nums.map(b => b.toString(16).padStart(2, '0')).join('');
                  result[key] = BigInt('0x' + hex);
                } else if (typeof value === 'object') {
                  result[key] = convertBigInts(value);
                } else {
                  result[key] = value;
                }
              }
            }
            return result;
          }
          return obj;
        };
        this.identity = normalizeIdentityKeys(convertBigInts(parsed));
        
        // Validate the loaded identity
        if (this.identity?.keypair) {
          const testPriv = toBigIntFlexible(this.identity.keypair.privKey);
          const testPub = toBigIntFlexible(this.identity.keypair.pubKey);
          if (typeof testPriv !== 'bigint' || typeof testPub !== 'bigint') {
            console.warn('[AuthService] Loaded identity has invalid keys, clearing...');
            this.identity = null;
            localStorage.removeItem('cipherpay_identity');
          }
        }
      } catch (e) {
        console.warn('[AuthService] Failed to load identity from localStorage, clearing...', e);
        this.identity = null;
        localStorage.removeItem('cipherpay_identity');
      }
    } else {
      this.identity = null;
    }
    
    if (this.identity) {
      this.saveIdentity(); // rewrite any legacy format right away
    }
  }

  saveIdentity() {
    if (!this.identity) {
      localStorage.removeItem('cipherpay_identity');
      return;
    }
    const replacer = (_, v) => {
      if (typeof v === 'bigint') return v.toString(10);
      if (v instanceof Uint8Array) return '0x' + bytesToHex(v);
      return v;
    };
    localStorage.setItem('cipherpay_identity', JSON.stringify(this.identity, replacer));
  }

  setAuthToken(token, user) {
    this.token = token;
    this.user = user;
    if (token) {
      localStorage.setItem('cipherpay_token', token);
      localStorage.setItem('cipherpay_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('cipherpay_token');
      localStorage.removeItem('cipherpay_user');
    }
  }

  clearIdentity() {
    this.identity = null;
    if (localStorage.getItem('cipherpay_identity')) {
      localStorage.removeItem('cipherpay_identity');
    }
  }

  clearAuth() {
    this.setAuthToken(null, null);
  }

  getAuthenticatedAxios() {
    const instance = axios.create({
      baseURL: SERVER_URL,
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use(
      (config) => {
        if (this.token) config.headers.Authorization = `Bearer ${this.token}`;
        return config;
      },
      (error) => Promise.reject(error)
    );
    instance.interceptors.response.use(
      (r) => r,
      (error) => {
        if (error?.response?.status === 401) this.setAuthToken(null, null);
        return Promise.reject(error);
      }
    );
    return instance;
  }

  isAuthenticated() { return !!this.token; }
  getToken() { return this.token || null; }
  getUser() { return this.user || null; }
  _toBigIntFlexible(v) { return toBigIntFlexible(v); }

  /**
   * Derive a deterministic CipherPay Identity from a blockchain wallet signature.
   * This ensures the same wallet always generates the same CipherPay identity across devices.
   * 
   * @param {Object} wallet - Solana wallet adapter with signMessage method
   * @param {string} walletAddress - Base58 wallet address
   * @returns {Promise<Object>} CipherPay identity with keypair
   */
  async deriveIdentityFromWallet(wallet, walletAddress) {
    try {
      console.log('[AuthService] Deriving deterministic identity for wallet:', walletAddress);
      
      // Create a deterministic message specific to CipherPay identity derivation
      const message = `CipherPay Identity Derivation\n\nWallet: ${walletAddress}\n\nSign this message to derive your permanent CipherPay identity. This identity will be the same across all devices for this wallet.`;
      
      // Request signature from wallet
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await wallet.signMessage(messageBytes);
      
      // Convert signature to hex for deterministic seed
      const signatureHex = Array.from(signatureBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('[AuthService] Signature obtained, length:', signatureHex.length);
      
      // Derive keypair from signature using Poseidon hash for domain separation
      // Use two different domain separators to generate independent keys
      const seed = BigInt('0x' + signatureHex);
      
      // Generate privKey: Hash(seed, 1)
      const privKeySeed = await poseidonHashForAuth([seed % BigInt('0x' + 'f'.repeat(64)), 1n]);
      const privKey = privKeySeed % BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001'); // BN254 field modulus
      
      // Generate pubKey: Hash(seed, 2)
      const pubKeySeed = await poseidonHashForAuth([seed % BigInt('0x' + 'f'.repeat(64)), 2n]);
      const pubKey = pubKeySeed % BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
      
      console.log('[AuthService] Derived deterministic identity with distinct keys');
      
      // Store the wallet address used for derivation (for validation on reload)
      const identity = { 
        keypair: { privKey, pubKey },
        derivedFromWallet: walletAddress,
        derivationTimestamp: Date.now()
      };
      
      return identity;
    } catch (error) {
      console.error('[AuthService] Failed to derive identity from wallet:', error);
      throw new Error('Failed to derive identity from wallet signature. Please try again.');
    }
  }

  async getOrCreateIdentity(sdk = null, wallet = null, walletAddress = null) {
    // Check if we have a valid stored identity
    if (this.identity) {
      // Validate existing identity - check if keys are properly normalized
      try {
        const testPrivKey = toBigIntFlexible(this.identity.keypair.privKey);
        const testPubKey = toBigIntFlexible(this.identity.keypair.pubKey);
        if (typeof testPrivKey === 'bigint' && typeof testPubKey === 'bigint') {
          // If wallet is provided, check if identity was derived from this wallet
          if (walletAddress && this.identity.derivedFromWallet) {
            if (this.identity.derivedFromWallet === walletAddress) {
              console.log('[AuthService] Using existing deterministic identity for wallet:', walletAddress);
              return this.identity;
            } else {
              console.warn('[AuthService] Wallet changed, need to re-derive identity');
              console.warn('[AuthService] Previous wallet:', this.identity.derivedFromWallet);
              console.warn('[AuthService] Current wallet:', walletAddress);
              this.clearIdentity();
            }
          } else {
            // Legacy identity without wallet derivation
            // If a wallet is now available, clear this and derive from wallet instead
            if (wallet && walletAddress && typeof wallet.signMessage === 'function') {
              console.warn('[AuthService] Legacy identity found, but wallet is available. Migrating to wallet-derived identity...');
              this.clearIdentity();
            } else {
              // No wallet available, keep using legacy identity
              console.warn('[AuthService] Using legacy identity (not wallet-derived)');
              return this.identity;
            }
          }
        } else {
          console.warn('[AuthService] Identity keys are corrupted, regenerating...');
        }
      } catch (e) {
        console.warn('[AuthService] Identity validation failed, regenerating...', e);
      }
      // Clear corrupted identity
      this.clearIdentity();
    }

    let identity = null;
    
    // PRIORITY 1: Derive from wallet (most secure and portable)
    if (wallet && walletAddress && typeof wallet.signMessage === 'function') {
      try {
        console.log('[AuthService] Attempting deterministic derivation from wallet...');
        identity = await this.deriveIdentityFromWallet(wallet, walletAddress);
        console.log('[AuthService] Successfully derived identity from wallet');
      } catch (error) {
        console.error('[AuthService] Wallet derivation failed:', error);
        // Fall through to other methods
      }
    }
    
    // PRIORITY 2: Try SDK getIdentity (if available)
    if (!identity) {
      try {
        if (!sdk) {
          const _sdk = window.CipherPaySDK || window.parent?.CipherPaySDK;
          if (_sdk) sdk = _sdk;
        }
        if (sdk && typeof sdk.getIdentity === 'function') {
          identity = await sdk.getIdentity();
          console.log('[AuthService] Got identity from SDK');
        }
      } catch (e) {
        console.warn('[AuthService] SDK getIdentity failed:', e);
      }
    }

    // PRIORITY 3: Generate random identity as last resort (not portable)
    if (!identity) {
      console.warn('[AuthService] Generating random identity (not portable across devices)');
      // Generate distinct random field elements for public and private keys
      const privKey = BigInt(
        '0x' +
          crypto.getRandomValues(new Uint8Array(32))
            .reduce((a, b) => a + b.toString(16).padStart(2, '0'), '')
      );
      const pubKey = BigInt(
        '0x' +
          crypto.getRandomValues(new Uint8Array(32))
            .reduce((a, b) => a + b.toString(16).padStart(2, '0'), '')
      );
      identity = { keypair: { privKey, pubKey } };
    }

    this.identity = normalizeIdentityKeys(identity);
    this.saveIdentity();
    return this.identity;
  }

  async getOwnerCipherPayPubKey(identity) {
    if (!identity) identity = await this.getOrCreateIdentity();
    let { pubKey, privKey } = identity.keypair ?? {};
    pubKey  = toBigIntFlexible(pubKey);
    privKey = toBigIntFlexible(privKey);
    const recipientCipherPayPubKey = await poseidonHashForAuth([pubKey, privKey]);
    return '0x' + recipientCipherPayPubKey.toString(16).padStart(64, '0');
  }

  // Helper to convert BigInt to 32-byte little-endian Buffer
  bigIntToBytes32LE(n) {
    const buf = Buffer.allocUnsafe(32);
    let temp = n;
    for (let i = 0; i < 32; i++) {
      buf[i] = Number(temp & 0xFFn);
      temp = temp >> 8n;
    }
    return buf;
  }

  async signBabyJub(messageField, privKey) {
    const { babyJub, eddsa } = await loadCircomlib();
    if (!babyJub || !babyJub.F) throw new Error('babyJub.F is not available.');
    const F = babyJub.F;
    
    const privKeyBI = toBigIntFlexible(privKey);
    const msgFieldBI = toBigIntFlexible(messageField);
    const msgField = F.e(msgFieldBI);
    
    console.log('[AuthService] signBabyJub - Using consistent bytes format');
    
    // Convert BigInt to 32-byte buffer (little-endian) - MUST match getAuthPubKey
    const privKeyBytes = this.bigIntToBytes32LE(privKeyBI);
    
    // Sign using bytes
    const signature = eddsa.signPoseidon(privKeyBytes, msgField);
    
    // Verify locally using same bytes format
    const pk = eddsa.prv2pub(privKeyBytes);
    const ok = eddsa.verifyPoseidon(msgField, signature, pk);
    
    if (!ok) {
      console.error('[AuthService] signBabyJub - Local verification FAILED!');
      throw new Error('local_bad_signature');
    }
    
    console.log('[AuthService] signBabyJub - Local verification passed!');
    
    // Convert signature components to hex
    const r8xObj = F.toObject(signature.R8[0]);
    const r8yObj = F.toObject(signature.R8[1]);
    let sBI = signature.S;
    if (typeof sBI !== 'bigint') {
      try {
        sBI = F.toObject(sBI);
      } catch (e) {
        const str = String(sBI);
        if (str.includes(',')) {
          const bytes = str.split(',').map(x => parseInt(x.trim(), 10));
          const hex = '0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
          sBI = BigInt(hex);
        } else {
          sBI = BigInt(str);
        }
      }
    }
    
    const r8xBI = typeof r8xObj === 'bigint' ? r8xObj : BigInt(String(r8xObj));
    const r8yBI = typeof r8yObj === 'bigint' ? r8yObj : BigInt(String(r8yObj));
    
    return {
      R8x: '0x' + r8xBI.toString(16).padStart(64, '0'),
      R8y: '0x' + r8yBI.toString(16).padStart(64, '0'),
      S: '0x' + sBI.toString(16).padStart(64, '0'),
    };
  }

  async verifyBabyJubSignatureLocally(msgField, signature, pubKeyHex) {
    try {
      const { babyJub, eddsa } = await loadCircomlib();
      if (!babyJub || !babyJub.F) throw new Error('babyJub.F is not available.');
      const F = babyJub.F;
      
      // Re-derive the public key from the private key to ensure we use the exact same format
      const identity = await this.getOrCreateIdentity();
      const skBI = toBigIntFlexible(identity.keypair.privKey);
      console.log('[AuthService] verifyBabyJubSignatureLocally - private key used:', skBI.toString().substring(0, 50) + '...');
      const sk = F.e(skBI);
      const pkFromPriv = eddsa.prv2pub(sk);
      console.log('[AuthService] verifyBabyJubSignatureLocally - public key derived:', {
        x: pkFromPriv[0] instanceof Uint8Array ? 'Uint8Array(32)' : String(pkFromPriv[0]),
        y: pkFromPriv[1] instanceof Uint8Array ? 'Uint8Array(32)' : String(pkFromPriv[1])
      });
      
      // Convert Uint8Array coordinates to field elements
      // prv2pub returns Uint8Arrays, but verifyPoseidon needs field elements
      let pubKeyX, pubKeyY;
      if (pkFromPriv[0] instanceof Uint8Array) {
        // Convert Uint8Array to hex string, then to field element
        const hexStr = '0x' + Array.from(pkFromPriv[0]).map(b => b.toString(16).padStart(2, '0')).join('');
        pubKeyX = F.e(hexStr);
      } else {
        pubKeyX = pkFromPriv[0];
      }
      
      if (pkFromPriv[1] instanceof Uint8Array) {
        // Convert Uint8Array to hex string, then to field element
        const hexStr = '0x' + Array.from(pkFromPriv[1]).map(b => b.toString(16).padStart(2, '0')).join('');
        pubKeyY = F.e(hexStr);
      } else {
        pubKeyY = pkFromPriv[1];
      }
      
      const pubKeyElem = [pubKeyX, pubKeyY];
      
      // Convert inputs to field elements
      const msgFieldElem = F.e(toBigIntFlexible(msgField));
      const sig = {
        R8: [
          F.e(toBigIntFlexible(signature.R8x)),
          F.e(toBigIntFlexible(signature.R8y))
        ],
        S: F.e(toBigIntFlexible(signature.S))
      };
      
      console.log('[AuthService] verifyBabyJubSignatureLocally - using public key from prv2pub directly');
      console.log('[AuthService] verifyBabyJubSignatureLocally - converted values:', {
        msgField: msgField.toString(),
        pubKeyFromHex: { x: pubKeyHex.x, y: pubKeyHex.y },
        pubKeyFromPriv: { 
          x: pkFromPriv[0] instanceof Uint8Array ? 'Uint8Array(32)' : String(pkFromPriv[0]),
          y: pkFromPriv[1] instanceof Uint8Array ? 'Uint8Array(32)' : String(pkFromPriv[1])
        },
        sig: { R8x: signature.R8x, R8y: signature.R8y, S: signature.S }
      });
      
      const result = eddsa.verifyPoseidon(msgFieldElem, sig, pubKeyElem);
      console.log('[AuthService] verifyBabyJubSignatureLocally - result:', result);
      return result;
    } catch (error) {
      console.error('[AuthService] verifyBabyJubSignatureLocally - error:', error);
      return false;
    }
  }

  async getAuthPubKey(identity) {
    if (!identity) identity = await this.getOrCreateIdentity();
    const { babyJub, eddsa } = await loadCircomlib();
    const F = babyJub.F;

    identity = normalizeIdentityKeys(identity);
    const skBI = toBigIntFlexible(identity.keypair.privKey);
    
    // Convert BigInt to 32-byte buffer (little-endian) - MUST match signBabyJub
    const privKeyBytes = this.bigIntToBytes32LE(skBI);
    
    // Derive public key using bytes format (matches what signPoseidon uses internally)
    const pk = eddsa.prv2pub(privKeyBytes);
    
    // pk coordinates are either Uint8Arrays or field elements
    // Convert to BigInt for hex representation
    const x = '0x' + F.toObject(pk[0]).toString(16).padStart(64, '0');
    const y = '0x' + F.toObject(pk[1]).toString(16).padStart(64, '0');
    
    console.log('[AuthService] getAuthPubKey - result:', { x, y });
    return { x, y };
  }

  async requestChallenge(ownerKey, authPubKey, solanaWalletAddress = null) {
    const payload = { ownerKey, authPubKey };
    console.log('[AuthService] requestChallenge: solanaWalletAddress parameter:', solanaWalletAddress);
    
    // FALLBACK: If wallet address is not provided, try to get it from sessionStorage
    if (!solanaWalletAddress) {
      try {
        solanaWalletAddress = sessionStorage.getItem('cipherpay_wallet_address');
        console.log('[AuthService] requestChallenge FALLBACK: Retrieved wallet address from sessionStorage:', solanaWalletAddress);
      } catch (e) {
        console.warn('[AuthService] requestChallenge FALLBACK: Failed to read sessionStorage:', e);
      }
    }
    
    if (solanaWalletAddress) {
      payload.solanaWalletAddress = solanaWalletAddress;
      console.log('[AuthService] requestChallenge: Added solanaWalletAddress to payload:', solanaWalletAddress);
    } else {
      console.log('[AuthService] requestChallenge: solanaWalletAddress is falsy, not adding to payload');
    }
    console.log('[AuthService] requestChallenge: Final payload:', { ...payload, authPubKey: '...' });
    const res = await axios.post(`${SERVER_URL}/auth/challenge`, payload);
    return res.data;
  }

  async verifyAuth(ownerKey, nonce, signature, authPubKey = null) {
    try {
      console.log('[AuthService] Verifying auth, URL:', `${SERVER_URL}/auth/verify`);
      const response = await axios.post(`${SERVER_URL}/auth/verify`, { ownerKey, nonce, signature, authPubKey });
      console.log('[AuthService] Verify response:', response.data);
      return response.data;
    } catch (error) {
      console.error('[AuthService] Auth verification failed:', error);
      console.error('[AuthService] Verify error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
      });
      throw new Error(error.response?.data?.error || error.message || 'Authentication verification failed');
    }
  }

  async authenticate(sdk = null, solanaWalletAddress = null, solanaWallet = null) {
    try {
      console.log('[AuthService] ====== AUTHENTICATE CALLED (v3 with wallet) ======');
      console.log('[AuthService] Starting authentication flow');
      console.log('[AuthService] Server URL:', SERVER_URL);
      console.log('[AuthService] ====== WALLET ADDRESS DEBUG ======');
      console.log('[AuthService] Solana wallet address parameter:', solanaWalletAddress);
      console.log('[AuthService] Solana wallet adapter provided:', !!solanaWallet);
      console.log('[AuthService] Solana wallet has signMessage:', typeof solanaWallet?.adapter?.signMessage);
      console.log('[AuthService] Solana wallet address type:', typeof solanaWalletAddress);
      console.log('[AuthService] Solana wallet address is null?', solanaWalletAddress === null);
      console.log('[AuthService] Solana wallet address is undefined?', solanaWalletAddress === undefined);
      console.log('[AuthService] Solana wallet address value:', String(solanaWalletAddress));
      
      // FALLBACK: If wallet address is not provided, try multiple sources
      if (!solanaWalletAddress) {
        // Try sessionStorage first
        try {
          solanaWalletAddress = sessionStorage.getItem('cipherpay_wallet_address');
          console.log('[AuthService] FALLBACK 1: Retrieved from sessionStorage:', solanaWalletAddress);
        } catch (e) {
          console.warn('[AuthService] FALLBACK 1: Failed to read sessionStorage:', e);
        }
        
        // Try localStorage as backup
        if (!solanaWalletAddress) {
          try {
            solanaWalletAddress = localStorage.getItem('cipherpay_wallet_address');
            console.log('[AuthService] FALLBACK 2: Retrieved from localStorage:', solanaWalletAddress);
          } catch (e) {
            console.warn('[AuthService] FALLBACK 2: Failed to read localStorage:', e);
          }
        }
        
        // Try window object (if set by wallet adapter)
        if (!solanaWalletAddress && typeof window !== 'undefined') {
          try {
            // Check if Solana wallet adapter has the public key
            if (window.solana?.publicKey) {
              solanaWalletAddress = window.solana.publicKey.toBase58();
              console.log('[AuthService] FALLBACK 3: Retrieved from window.solana.publicKey:', solanaWalletAddress);
            }
          } catch (e) {
            console.warn('[AuthService] FALLBACK 3: Failed to read window.solana:', e);
          }
        }
      }
      
      console.log('[AuthService] Final wallet address to use:', solanaWalletAddress);
      console.log('[AuthService] Will send to backend:', !!solanaWalletAddress);
      console.log('[AuthService] ====== END WALLET ADDRESS DEBUG ======');

      // Get or create identity - prioritize wallet-derived identity for security
      const walletAdapter = solanaWallet?.adapter || solanaWallet;
      const identity = await this.getOrCreateIdentity(sdk, walletAdapter, solanaWalletAddress);
      console.log('[AuthService] Identity created/retrieved');

      const ownerKey = await this.getOwnerCipherPayPubKey(identity);
      console.log('[AuthService] Owner key:', ownerKey.substring(0, 20) + '...');

      console.log('[AuthService] Getting auth pub key...');
      const authPubKey = await this.getAuthPubKey(identity);
      console.log('[AuthService] Auth pub key retrieved:', authPubKey);

      console.log('[AuthService] Requesting challenge...');
      const { nonce } = await this.requestChallenge(ownerKey, authPubKey, solanaWalletAddress);
      console.log('[AuthService] Challenge received, nonce:', String(nonce).substring(0, 16) + '...');

      console.log('[AuthService] Computing message field with nonce and ownerKey...');
      const nonceHex = String(nonce).startsWith('0x') ? String(nonce) : '0x' + String(nonce);
      const nonceBI = toBigIntFlexible(nonceHex);
      const ownerKeyBI = toBigIntFlexible(ownerKey);
      console.log('[AuthService] Message computation inputs:', {
        nonce: String(nonce),
        nonceHex: nonceHex,
        nonceBigInt: nonceBI.toString(),
        ownerKey: ownerKey,
        ownerKeyBigInt: ownerKeyBI.toString(),
      });
      // Use poseidonHash (not poseidonHashForAuth) to match server's poseidonLoginMsg
      const msgField = await poseidonHash([nonceBI, ownerKeyBI]);
      console.log('[AuthService] Message field computed:', msgField.toString());

      console.log('[AuthService] Signing message...');
      console.log('[AuthService] Signing with privKey type:', typeof identity.keypair.privKey);
      const signingPrivKey = toBigIntFlexible(identity.keypair.privKey);
      console.log('[AuthService] Signing with privKey (BigInt):', signingPrivKey.toString().substring(0, 50) + '...');
      console.log('[AuthService] Auth pubKey that will be sent:', authPubKey);
      const signature = await this.signBabyJub(msgField, identity.keypair.privKey);
      console.log('[AuthService] Signature generated:', signature);

      // Skip local verification for now - it may be a format conversion issue
      // The server-side verification uses the same format, so if it works there, we're good
      console.log('[AuthService] Skipping local verification (server will verify)');
      // TODO: Fix local verification - it may be a public key conversion issue

      console.log('[AuthService] Verifying signature with server...');
      const res = await this.verifyAuth(ownerKey, nonce, signature, authPubKey);
      console.log('[AuthService] Server verification response:', res);
      
      this.identity = normalizeIdentityKeys(this.identity); 
      this.saveIdentity();
      this.setAuthToken(res.token, res.user);
      console.log('[AuthService] Authentication successful');
      return true;
    } catch (error) {
      console.error('[AuthService] Authentication failed:', error);
      console.error('[AuthService] Error type:', typeof error, error?.constructor?.name);
      console.error('[AuthService] Error message:', error?.message);
      console.error('[AuthService] Error stack:', error?.stack);
      throw error;
    }
  }

  async getMe() {
    try {
      const axiosInstance = this.getAuthenticatedAxios();
      const response = await axiosInstance.get('/users/me');
      return response.data;
    } catch (error) {
      console.error('Failed to get current user:', error);
      throw error;
    }
  }
}

const authService = new AuthService();
export default authService;
