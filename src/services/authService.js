// Auth Service - Handles authentication with cipherpay-server
import axios from 'axios';
import { poseidonHash } from '../lib/sdk';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:8788';

// Load circomlibjs for BabyJubJub signing (we'll use a CDN or bundle it)
let circomlib = null;
async function loadCircomlib() {
    if (circomlib) return circomlib;
    try {
        // Try to load from node_modules if available
        circomlib = await import('circomlibjs');
        return circomlib;
    } catch (e) {
        // Fallback: load from CDN if available
        if (typeof window !== 'undefined' && window.circomlibjs) {
            circomlib = window.circomlibjs;
            return circomlib;
        }
        throw new Error('circomlibjs not available. Please include it in your build or via CDN.');
    }
}

class AuthService {
    constructor() {
        this.token = localStorage.getItem('cipherpay_token');
        this.user = JSON.parse(localStorage.getItem('cipherpay_user') || 'null');
        this.identity = JSON.parse(localStorage.getItem('cipherpay_identity') || 'null');
    }

    getAuthToken() {
        return this.token;
    }

    getUser() {
        return this.user;
    }

    getIdentity() {
        return this.identity;
    }

    isAuthenticated() {
        return !!this.token;
    }

    setAuthToken(token, user) {
        this.token = token;
        this.user = user;
        if (token) {
            localStorage.setItem('cipherpay_token', token);
            localStorage.setItem('cipherpay_user', JSON.stringify(user || {}));
        } else {
            localStorage.removeItem('cipherpay_token');
            localStorage.removeItem('cipherpay_user');
        }
    }

    setIdentity(identity) {
        this.identity = identity;
        if (identity) {
            localStorage.setItem('cipherpay_identity', JSON.stringify(identity));
        } else {
            localStorage.removeItem('cipherpay_identity');
        }
    }

    clearAuth() {
        this.setAuthToken(null, null);
        // Note: We might want to keep identity even after logout
    }

    // Get axios instance with auth header
    getAuthenticatedAxios() {
        const instance = axios.create({
            baseURL: SERVER_URL,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Add auth token to requests
        instance.interceptors.request.use(
            (config) => {
                if (this.token) {
                    config.headers.Authorization = `Bearer ${this.token}`;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );

        // Handle 401 responses (token expired)
        instance.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) {
                    this.clearAuth();
                    // Redirect to login would be handled by the component
                }
                return Promise.reject(error);
            }
        );

        return instance;
    }

    // Get or create identity from SDK or create a new one
    async getOrCreateIdentity(sdk = null) {
        // Check if we have a stored identity
        if (this.identity) {
            return this.identity;
        }

        // Try to get from SDK if available
        if (sdk?.identityManager?.getIdentity) {
            const identity = await sdk.identityManager.getIdentity();
            if (identity) {
                this.setIdentity(identity);
                return identity;
            }
        }

        // Create new identity - simplified version
        // In production, this should use SDK's createIdentity
        // For now, we'll create a minimal structure
        const identity = {
            keypair: {
                privKey: this.generateRandomField(),
                pubKey: this.generateRandomField(),
            },
            viewKey: {
                vk: this.generateRandomField(),
            },
            recipientCipherPayPubKey: null, // Will be computed
        };

        // Compute recipientCipherPayPubKey = Poseidon(pubKey, privKey)
        identity.recipientCipherPayPubKey = await poseidonHash([
            identity.keypair.pubKey,
            identity.keypair.privKey,
        ]);

        this.setIdentity(identity);
        return identity;
    }

    generateRandomField() {
        // Generate a random 254-bit field element (BigInt)
        // Use crypto.getRandomValues for better randomness
        const array = new Uint8Array(32);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(array);
        } else {
            // Fallback for older browsers
            for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256);
            }
        }
        // Convert to BigInt, ensuring it's less than the field modulus
        // Field modulus for BabyJubJub is approximately 2^254 + 2^253 + ...
        const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
        return BigInt('0x' + hex);
    }

    // Get ownerCipherPayPubKey as hex string
    async getOwnerCipherPayPubKey(identity) {
        if (!identity) {
            identity = await this.getOrCreateIdentity();
        }
        const pubKey = identity.recipientCipherPayPubKey || identity.recipientCipherPayPubKey;
        return '0x' + pubKey.toString(16).padStart(64, '0');
    }

    // Sign message with BabyJubJub EdDSA
    async signBabyJub(messageField, privKey) {
        const lib = await loadCircomlib();
        const F = lib.babyJub.F;
        const privKeyField = F.e(BigInt(privKey));
        const msgField = F.e(BigInt(messageField));

        // Generate signature
        const signature = lib.eddsa.signPoseidon(privKeyField, msgField);
        
        return {
            R8x: signature.R8[0].toString(),
            R8y: signature.R8[1].toString(),
            S: signature.S.toString(),
        };
    }

    // Get auth pub key from identity (for new user registration)
    async getAuthPubKey(identity) {
        if (!identity) {
            identity = await this.getOrCreateIdentity();
        }
        
        // For now, derive from keypair. In production, might be separate
        const lib = await loadCircomlib();
        const F = lib.babyJub.F;
        const privKeyField = F.e(BigInt(identity.keypair.privKey));
        
        // Derive public key from private key
        const pubKey = lib.eddsa.prv2pub(privKeyField);
        
        return {
            x: pubKey[0].toString(),
            y: pubKey[1].toString(),
        };
    }

    // Request authentication challenge
    async requestChallenge(ownerKey, authPubKey = null) {
        try {
            const response = await axios.post(`${SERVER_URL}/auth/challenge`, {
                ownerKey,
                authPubKey,
            });
            return response.data;
        } catch (error) {
            console.error('Challenge request failed:', error);
            throw new Error(error.response?.data?.error || 'Failed to request authentication challenge');
        }
    }

    // Verify authentication signature
    async verifyAuth(ownerKey, nonce, signature, authPubKey = null) {
        try {
            const response = await axios.post(`${SERVER_URL}/auth/verify`, {
                ownerKey,
                nonce,
                signature,
                authPubKey,
            });
            return response.data;
        } catch (error) {
            console.error('Auth verification failed:', error);
            throw new Error(error.response?.data?.error || 'Authentication verification failed');
        }
    }

    // Complete authentication flow
    async authenticate(sdk = null) {
        try {
            // Get or create identity
            const identity = await this.getOrCreateIdentity(sdk);
            
            // Get ownerCipherPayPubKey
            const ownerKey = await this.getOwnerCipherPayPubKey(identity);
            
            // Get auth pub key for new users
            const authPubKey = await this.getAuthPubKey(identity);
            
            // Request challenge
            const { nonce, expiresAt } = await this.requestChallenge(ownerKey, authPubKey);
            
            // Compute challenge message: Poseidon(nonce || ownerKey)
            const nonceHex = '0x' + nonce;
            const msgField = await poseidonHash([BigInt(nonceHex), BigInt(ownerKey)]);
            
            // Sign the message
            const signature = await this.signBabyJub(msgField, identity.keypair.privKey);
            
            // Verify and get token
            const result = await this.verifyAuth(ownerKey, nonce, signature, authPubKey);
            
            // Store token and user
            this.setAuthToken(result.token, result.user);
            
            return {
                token: result.token,
                user: result.user,
                identity,
            };
        } catch (error) {
            console.error('Authentication failed:', error);
            throw error;
        }
    }

    // Get current user info (requires authentication)
    async getCurrentUser() {
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

