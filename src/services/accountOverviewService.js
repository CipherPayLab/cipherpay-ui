// Account Overview Service
// Fetches messages from backend, decrypts them, and computes account overview

import { decryptFromSenderForMe } from '../lib/e2ee';

const API_BASE_URL = import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_API_URL || 'http://localhost:8788';

// Request deduplication: track in-flight requests
const inFlightRequests = new Map();

/**
 * Fetch messages for the authenticated user
 */
export async function fetchMessages(options = {}) {
  const {
    recipientKey = null,
    senderKey = null,
    unreadOnly = false,
    limit = 100,
    offset = 0,
  } = options;

  const token = localStorage.getItem('cipherpay_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  const params = new URLSearchParams();
  if (recipientKey) params.append('recipientKey', recipientKey);
  if (senderKey) params.append('senderKey', senderKey);
  if (unreadOnly) params.append('unreadOnly', 'true');
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const url = `${API_BASE_URL}/api/v1/messages?${params}`;
  
  // Check if request is already in flight
  if (inFlightRequests.has(url)) {
    console.log('[accountOverviewService] Reusing in-flight request for:', url);
    return inFlightRequests.get(url);
  }
  
  console.log('[accountOverviewService] Fetching messages from:', url);
  console.log('[accountOverviewService] Token present:', !!token, 'Token length:', token?.length);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  const requestPromise = (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch messages' }));
        const errorMessage = error.message || `HTTP ${response.status}`;
        if (response.status === 401) {
          console.warn('[accountOverviewService] 401 Unauthorized - token may be invalid or expired');
          console.warn('[accountOverviewService] Error details:', error);
          // Try to decode JWT to check expiration (without verification)
          try {
            const tokenParts = token.split('.');
            if (tokenParts.length === 3) {
              const payload = JSON.parse(atob(tokenParts[1]));
              console.warn('[accountOverviewService] Token payload:', { 
                sub: payload.sub, 
                ownerKey: payload.ownerKey?.substring(0, 20) + '...',
                exp: payload.exp,
                expDate: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
                now: new Date().toISOString(),
                expired: payload.exp ? Date.now() > payload.exp * 1000 : null
              });
            }
          } catch (e) {
            console.warn('[accountOverviewService] Could not decode token:', e);
          }
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out after 30 seconds');
      }
      throw error;
    } finally {
      // Remove from in-flight requests
      inFlightRequests.delete(url);
    }
  })();

  // Store in-flight request
  inFlightRequests.set(url, requestPromise);

  return requestPromise;
}

/**
 * Decrypt messages and extract notes
 * @param {Array} messages - Array of message objects with ciphertext
 * @returns {Array} Array of decrypted notes
 */
export function decryptMessages(messages) {
  const notes = [];
  
  for (const msg of messages) {
    try {
      console.log(`[accountOverviewService] Attempting to decrypt message ${msg.id}, kind: ${msg.kind}`);
      console.log(`[accountOverviewService] Ciphertext type: ${typeof msg.ciphertext}, length: ${msg.ciphertext?.length}`);
      console.log(`[accountOverviewService] Ciphertext preview: ${msg.ciphertext?.substring(0, 100)}...`);
      
      // Decrypt the ciphertext
      const decrypted = decryptFromSenderForMe(msg.ciphertext);
      
      console.log(`[accountOverviewService] Decryption result:`, decrypted ? 'success' : 'failed (null)');
      if (decrypted) {
        console.log(`[accountOverviewService] Decrypted keys:`, Object.keys(decrypted));
        console.log(`[accountOverviewService] Has note property:`, !!decrypted.note);
        if (decrypted.note) {
          console.log(`[accountOverviewService] Note keys:`, Object.keys(decrypted.note));
        }
      }
      
      if (decrypted && decrypted.note) {
        // Convert hex strings to BigInt if needed
        const note = {
          amount: typeof decrypted.note.amount === 'string' 
            ? BigInt(decrypted.note.amount.startsWith('0x') ? decrypted.note.amount : `0x${decrypted.note.amount}`)
            : BigInt(decrypted.note.amount),
          tokenId: typeof decrypted.note.tokenId === 'string'
            ? BigInt(decrypted.note.tokenId.startsWith('0x') ? decrypted.note.tokenId : `0x${decrypted.note.tokenId}`)
            : BigInt(decrypted.note.tokenId),
          ownerCipherPayPubKey: typeof decrypted.note.ownerCipherPayPubKey === 'string'
            ? BigInt(decrypted.note.ownerCipherPayPubKey.startsWith('0x') ? decrypted.note.ownerCipherPayPubKey : `0x${decrypted.note.ownerCipherPayPubKey}`)
            : BigInt(decrypted.note.ownerCipherPayPubKey),
          randomness: {
            r: typeof decrypted.note.randomness?.r === 'string'
              ? BigInt(decrypted.note.randomness.r.startsWith('0x') ? decrypted.note.randomness.r : `0x${decrypted.note.randomness.r}`)
              : BigInt(decrypted.note.randomness?.r || 0),
            s: decrypted.note.randomness?.s 
              ? (typeof decrypted.note.randomness.s === 'string'
                  ? BigInt(decrypted.note.randomness.s.startsWith('0x') ? decrypted.note.randomness.s : `0x${decrypted.note.randomness.s}`)
                  : BigInt(decrypted.note.randomness.s))
              : undefined,
          },
          memo: decrypted.note.memo,
        };
        console.log(`[accountOverviewService] Successfully decrypted and parsed note from message ${msg.id}`);
        notes.push(note);
      } else {
        console.warn(`[accountOverviewService] Message ${msg.id} decryption returned null or missing note property`);
      }
    } catch (error) {
      console.error(`[accountOverviewService] Failed to decrypt message ${msg.id}:`, error);
      console.error(`[accountOverviewService] Error stack:`, error.stack);
      // Continue with other messages
    }
  }
  
  return notes;
}

/**
 * Compute account overview from decrypted notes
 * @param {Array} notes - Array of decrypted notes
 * @param {boolean} checkOnChain - Whether to check on-chain for nullifiers not in DB
 * @returns {Promise<Object>} Account overview object
 */
export async function computeAccountOverview(notes, checkOnChain = false) {
  const token = localStorage.getItem('cipherpay_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  // Convert notes to the format expected by the API (BigInts as hex strings)
  const notesForAPI = notes.map(note => ({
    amount: `0x${note.amount.toString(16)}`,
    tokenId: `0x${note.tokenId.toString(16)}`,
    ownerCipherPayPubKey: `0x${note.ownerCipherPayPubKey.toString(16)}`,
    randomness: {
      r: `0x${note.randomness.r.toString(16)}`,
      s: note.randomness.s ? `0x${note.randomness.s.toString(16)}` : undefined,
    },
    memo: note.memo,
  }));

  const response = await fetch(`${API_BASE_URL}/api/v1/account/overview`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      notes: notesForAPI,
      checkOnChain,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to compute account overview' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  
  // Convert hex strings back to BigInts
  return {
    shieldedBalance: BigInt(result.shieldedBalance),
    spendableNotes: result.spendableNotes,
    totalNotes: result.totalNotes,
    notes: result.notes.map(n => ({
      note: {
        amount: BigInt(n.note.amount),
        tokenId: BigInt(n.note.tokenId),
        ownerCipherPayPubKey: BigInt(n.note.ownerCipherPayPubKey),
        randomness: {
          r: BigInt(n.note.randomness.r),
          s: n.note.randomness.s ? BigInt(n.note.randomness.s) : undefined,
        },
        memo: n.note.memo,
      },
      nullifierHex: n.nullifierHex,
      isSpent: n.isSpent,
      amount: BigInt(n.amount),
    })),
  };
}

/**
 * Fetch messages, decrypt them, and compute account overview
 * @param {Object} options - Options for fetching messages and computing overview
 * @returns {Promise<Object>} Account overview object
 */
export async function fetchAccountOverview(options = {}) {
  const { checkOnChain = false, ...messageOptions } = options;
  
  console.log('[accountOverviewService] fetchAccountOverview: Starting...');
  
  // Fetch messages
  const { messages, total } = await fetchMessages(messageOptions);
  console.log('[accountOverviewService] fetchAccountOverview: Fetched', messages?.length || 0, 'messages (total:', total || 0, ')');
  
  // Decrypt messages to get notes
  const notes = decryptMessages(messages || []);
  console.log('[accountOverviewService] fetchAccountOverview: Decrypted', notes.length, 'notes');
  
  // If no notes, return empty overview
  if (notes.length === 0) {
    console.log('[accountOverviewService] fetchAccountOverview: No notes found, returning empty overview');
    return {
      shieldedBalance: 0n,
      spendableNotes: 0,
      totalNotes: 0,
      notes: [],
    };
  }
  
  // Compute account overview
  const overview = await computeAccountOverview(notes, checkOnChain);
  console.log('[accountOverviewService] fetchAccountOverview: Computed overview - balance:', overview.shieldedBalance, 'spendable:', overview.spendableNotes, 'total:', overview.totalNotes);
  
  return overview;
}

