// CipherPayService - Production/Real SDK Service
// This service provides full integration with the real CipherPay SDK
// Used for production environments and real blockchain interactions
// 
// Environment Variables:
// - REACT_APP_USE_REAL_SDK=true: Use this service (default when SDK is available)
// - REACT_APP_USE_FALLBACK_SERVICE=false: Use this service
// 
// Features:
// - Full SDK integration with Solana blockchain
// - Real wallet connections and transactions
// - ZK proof generation and verification
// - Event monitoring and compliance
// - Production-ready error handling

// Import SDK loader to get the global SDK instance
import { loadSDK, getSDKStatus } from './sdkLoader';
import { fetchAccountOverview, fetchMessages, decryptMessages, computeAccountOverview } from './accountOverviewService';
import { encryptForRecipient, getLocalEncPublicKeyB64 } from '../lib/e2ee';

class CipherPayService {
    constructor() {
        this.sdk = null;
        this.isInitialized = false;
        this.walletAddress = null; // Store wallet address from external wallet adapter
        this.eventListeners = {}; // Event listeners for deposit completion, etc.
        this.eventMonitoringActive = false;
        this.stopEventStream = null;
        this.config = {
            chainType: 'solana', // Use string instead of ChainType enum
            rpcUrl: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8899',
            relayerUrl: import.meta.env.VITE_RELAYER_URL || 'http://localhost:3000',
            relayerApiKey: import.meta.env.VITE_RELAYER_API_KEY,
            contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
            programId: import.meta.env.VITE_PROGRAM_ID || 'BCrt2kn5HR4B7CHEMSBacekhzVTKYhzAQAB5YNkr5kJf', // Solana program ID
            enableCompliance: true,
            enableCaching: true,
            enableStealthAddresses: true,
            cacheConfig: {
                maxSize: 1000,
                defaultTTL: 300000 // 5 minutes
            },
            // Add authentication configuration for relayer
            auth: {
                email: import.meta.env.VITE_RELAYER_EMAIL,
                password: import.meta.env.VITE_RELAYER_PASSWORD,
                apiKey: import.meta.env.VITE_RELAYER_API_KEY
            }
        };
        console.log('CipherPayService constructor - config:', this.config);
    }

    async initialize() {
        try {
            console.log('Initializing CipherPay SDK...');

            // Load the SDK from global scope
            const { CipherPaySDK, ChainType, sdkInitialized } = await loadSDK();

            if (!sdkInitialized || !CipherPaySDK) {
                // Check if SDK exists but is not a constructor
                if (typeof window !== 'undefined' && typeof window.CipherPaySDK !== 'undefined') {
                    throw new Error('CipherPaySDK found in global scope but is not a constructor class. The SDK appears to export utility functions only.');
                }
                throw new Error('CipherPay SDK not available in global scope. Ensure the SDK bundle is loaded via script tag in index.html');
            }

            // Configure circuit files for browser compatibility
            const circuitConfig = {
                transfer: {
                    wasmUrl: import.meta.env.VITE_TRANSFER_WASM_URL || '/circuits/transfer.wasm',
                    zkeyUrl: import.meta.env.VITE_TRANSFER_ZKEY_URL || '/circuits/transfer.zkey',
                    verificationKeyUrl: import.meta.env.VITE_TRANSFER_VKEY_URL || '/circuits/verifier-transfer.json'
                },
                merkle: {
                    wasmUrl: import.meta.env.VITE_MERKLE_WASM_URL || '/circuits/merkle.wasm',
                    zkeyUrl: import.meta.env.VITE_MERKLE_ZKEY_URL || '/circuits/merkle.zkey',
                    verificationKeyUrl: import.meta.env.VITE_MERKLE_VKEY_URL || '/circuits/verifier-merkle.json'
                },
                withdraw: {
                    wasmUrl: '/circuits/withdraw.wasm',
                    zkeyUrl: '/circuits/withdraw.zkey',
                    verificationKeyUrl: '/circuits/verifier-withdraw.json'
                },
                nullifier: {
                    wasmUrl: '/circuits/nullifier.wasm',
                    zkeyUrl: '/circuits/nullifier.zkey',
                    verificationKeyUrl: '/circuits/verifier-nullifier.json'
                },
                audit_proof: {
                    wasmUrl: '/circuits/audit_proof.wasm',
                    zkeyUrl: '/circuits/audit_proof.zkey',
                    verificationKeyUrl: '/circuits/verifier-audit_proof.json'
                }
            };

            // Initialize the SDK with configuration
            const sdkConfig = {
                ...this.config,
                circuitConfig
            };
            console.log('Creating SDK instance with config:', JSON.stringify(sdkConfig, null, 2));
            console.log('Program ID in sdkConfig:', sdkConfig.programId);

            this.sdk = new CipherPaySDK(sdkConfig);

            // Event monitoring is now handled via SSE in startEventMonitoring()
            console.log('SDK initialized. Call startEventMonitoring(recipientKey) to monitor on-chain events.');

            this.isInitialized = true;
            console.log('CipherPay SDK initialized successfully');
        } catch (error) {
            console.error('Failed to initialize CipherPay SDK:', error);
            throw error;
        }
    }

    // Wallet Management
    async connectWallet(walletAddress = null) {
        if (!this.isInitialized) await this.initialize();

        try {
            // Wallet connection is managed externally by Solana wallet adapter
            // We just store the wallet address here
            if (walletAddress) {
                this.walletAddress = walletAddress;
                console.log('[CipherPayService] connectWallet: Stored wallet address:', walletAddress);
                return walletAddress;
            }
            
            // If no address provided, try to get from SDK (fallback)
            if (this.sdk?.walletProvider?.getPublicAddress) {
                const address = this.sdk.walletProvider.getPublicAddress();
                if (address) {
                    this.walletAddress = address;
                    console.log('[CipherPayService] connectWallet: Got address from SDK:', address);
                    return address;
                }
            }
            
            console.warn('[CipherPayService] connectWallet: No wallet address provided and SDK has none');
            return null;
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        }
    }
    
    setWalletAddress(address) {
        this.walletAddress = address;
        console.log('[CipherPayService] setWalletAddress:', address);
    }

    async disconnectWallet() {
        // Clear stored wallet address
        this.walletAddress = null;
        console.log('[CipherPayService] disconnectWallet: Cleared wallet address');
        
        // Try to disconnect from SDK wallet provider if it exists
        if (this.sdk?.walletProvider?.disconnect) {
            try {
                await this.sdk.walletProvider.disconnect();
            } catch (error) {
                console.error('Failed to disconnect SDK wallet:', error);
                // Don't throw - wallet is managed externally
            }
        }
    }

    getPublicAddress() {
        try {
            // First check if we have a stored wallet address from external wallet adapter
            if (this.walletAddress) {
                console.log('[CipherPayService] getPublicAddress: Using stored address:', this.walletAddress);
                return this.walletAddress;
            }
            
            // Fallback to SDK wallet provider
            const address = this.sdk?.walletProvider?.getPublicAddress?.();
            console.log('[CipherPayService] getPublicAddress: SDK address:', address);
            return address || null;
        } catch (error) {
            if (error.message && error.message.includes('No wallet connected')) {
                return null;
            }
            console.error('Error getting public address:', error);
            return null;
        }
    }

    // Note Management
    // ALWAYS get notes from backend (database), never from SDK
    async getSpendableNotes() {
        try {
            // Fetch messages from backend DB, decrypt them, and get account overview
            const overview = await this.getAccountOverviewFromBackend({ checkOnChain: false });
            // Filter out spent notes and return in the format expected by transfer
            const spendable = (overview.notes || []).filter(n => !n.isSpent);
            // Convert to the format expected by createTransaction
            // Backend returns amounts as hex strings, convert to BigInt
            return spendable.map(n => ({
                amount: typeof n.amount === 'string' && n.amount.startsWith('0x') 
                    ? BigInt(n.amount) 
                    : BigInt(n.amount),
                tokenId: typeof n.note.tokenId === 'string' && n.note.tokenId.startsWith('0x')
                    ? BigInt(n.note.tokenId)
                    : BigInt(n.note.tokenId),
                ownerCipherPayPubKey: typeof n.note.ownerCipherPayPubKey === 'string' && n.note.ownerCipherPayPubKey.startsWith('0x')
                    ? BigInt(n.note.ownerCipherPayPubKey)
                    : BigInt(n.note.ownerCipherPayPubKey),
                randomness: {
                    r: typeof n.note.randomness.r === 'string' && n.note.randomness.r.startsWith('0x')
                        ? BigInt(n.note.randomness.r)
                        : BigInt(n.note.randomness.r),
                    s: n.note.randomness.s 
                        ? (typeof n.note.randomness.s === 'string' && n.note.randomness.s.startsWith('0x')
                            ? BigInt(n.note.randomness.s)
                            : BigInt(n.note.randomness.s))
                        : undefined,
                },
                memo: n.note.memo 
                    ? (typeof n.note.memo === 'string' && n.note.memo.startsWith('0x')
                        ? BigInt(n.note.memo)
                        : BigInt(n.note.memo))
                    : 0n,
            }));
        } catch (error) {
            console.error('[CipherPayService] Failed to get spendable notes from backend:', error);
            return [];
        }
    }

    async getAllNotes() {
        if (!this.isInitialized) await this.initialize();
        try {
            const notes = await this.sdk.getNotes();
            return Array.isArray(notes) ? notes : [];
        } catch (error) {
            console.error('Failed to get notes from SDK:', error);
            return [];
        }
    }

    getBalance() {
        const balance = this.sdk?.getBalance();
        console.log('[CipherPayService] getBalance:', balance);
        return balance || 0n;
    }

    // Get stored ATA from database (via backend API)
    async getUserAta() {
        if (!this.isInitialized) await this.initialize();
        
        try {
            // Import authService dynamically to avoid circular dependencies
            const authService = (await import('./authService.js')).default;
            
            // Get user info which includes stored ATA
            const userData = await authService.getMe();
            
            return {
                wsolAta: userData.wsolAta || null,
                solanaWalletAddress: userData.solanaWalletAddress || null,
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to get user ATA from DB:', error);
            return {
                wsolAta: null,
                solanaWalletAddress: null,
            };
        }
    }

    addNote(note) {
        if (this.sdk?.noteManager) {
            this.sdk.noteManager.addNote(note);
        }
    }

    // Transaction Management - Transfer
    // Note Selection Strategy:
    // 1. Try to find a single note with amount >= transfer amount
    // 2. If not found, select multiple notes (biggest to smallest) and transfer one by one
    async createTransaction(recipientPublicKey, amount, inputNote = null) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log('[CipherPayService] createTransaction called with params:', {
                recipientPublicKey,
                amount: amount.toString(),
                inputNote: inputNote ? 'provided' : 'not provided'
            });

            // Validate required parameters
            if (!recipientPublicKey) throw new Error('Recipient public key is required');
            if (!amount || amount <= 0n) throw new Error('Amount must be greater than 0');

            // Check if SDK transfer function is available
            if (!window.CipherPaySDK?.transfer) {
                throw new Error('SDK transfer function not available. Ensure the SDK bundle is loaded.');
            }

            // Get identity from stored keys
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found. Please authenticate first.');
            }

            // NOTE SELECTION STRATEGY
            let selectedNotes = [];
            
            if (inputNote) {
                // Use provided note - validate it has enough balance
                if (BigInt(inputNote.amount) < amount) {
                    throw new Error('Available shield balance insufficient');
                }
                selectedNotes = [inputNote];
            } else {
                // Get spendable notes from backend database (queries messages table and checks nullifiers)
                const spendable = await this.getSpendableNotes();
                if (spendable.length === 0) {
                    throw new Error('No spendable notes available. Please deposit funds first.');
                }

                // VALIDATION: Check total available balance first
                const totalAvailable = spendable.reduce((sum, n) => sum + BigInt(n.amount), 0n);
                if (totalAvailable < amount) {
                    throw new Error('Available shield balance insufficient');
                }

                // Strategy 1: Try to find a single note with amount >= transfer amount
                const singleNote = spendable.find(n => BigInt(n.amount) >= amount);
                
                if (singleNote) {
                    console.log('[CipherPayService] Found single note sufficient for transfer:', {
                        noteAmount: singleNote.amount.toString(),
                        transferAmount: amount.toString()
                    });
                    selectedNotes = [singleNote];
                } else {
                    // Strategy 2: Select multiple notes from biggest to smallest
                    console.log('[CipherPayService] No single note sufficient, selecting multiple notes...');
                    
                    // Sort notes by amount (biggest first)
                    const sortedNotes = [...spendable].sort((a, b) => {
                        const amountA = BigInt(a.amount);
                        const amountB = BigInt(b.amount);
                        if (amountB > amountA) return 1;
                        if (amountB < amountA) return -1;
                        return 0;
                    });
                    
                    // Select notes until we have enough
                    let totalSelected = 0n;
                    for (const note of sortedNotes) {
                        selectedNotes.push(note);
                        totalSelected += BigInt(note.amount);
                        if (totalSelected >= amount) {
                            break;
                        }
                    }
                    
                    // Double-check if we have enough (should not happen due to earlier validation, but safety check)
                    if (totalSelected < amount) {
                        throw new Error('Available shield balance insufficient');
                    }
                    
                    console.log('[CipherPayService] Selected multiple notes:', {
                        count: selectedNotes.length,
                        totalAmount: totalSelected.toString(),
                        transferAmount: amount.toString(),
                        notes: selectedNotes.map(n => ({ amount: n.amount.toString() }))
                    });
                }
            }

            // If multiple notes selected, execute transfers one by one
            if (selectedNotes.length > 1) {
                console.log('[CipherPayService] Executing', selectedNotes.length, 'transfers sequentially...');
                const results = [];
                let remainingAmount = amount;
                
                for (let i = 0; i < selectedNotes.length; i++) {
                    const note = selectedNotes[i];
                    const noteAmount = BigInt(note.amount);
                    
                    // Calculate transfer amount for this note
                    // For each note, transfer the full note amount to recipient
                    // The last note will have change if needed
                    // But we need to track how much we still need to send
                    const transferAmountForThisNote = remainingAmount <= noteAmount 
                        ? remainingAmount  // Last note or enough: transfer remaining amount
                        : noteAmount;      // Not enough yet: transfer full note amount
                    
                    console.log(`[CipherPayService] Transfer ${i + 1}/${selectedNotes.length}:`, {
                        noteAmount: noteAmount.toString(),
                        transferAmount: transferAmountForThisNote.toString(),
                        remainingAmount: remainingAmount.toString(),
                        willHaveChange: transferAmountForThisNote < noteAmount
                    });
                    
                    // Execute transfer for this note
                    const result = await this.executeSingleTransfer(
                        identity,
                        recipientPublicKey,
                        transferAmountForThisNote,
                        note
                    );
                    
                    results.push(result);
                    remainingAmount -= transferAmountForThisNote;
                    
                    // If we've transferred enough, stop
                    if (remainingAmount <= 0n) {
                        break;
                    }
                }
                
                // Return aggregated result
                return {
                    recipient: recipientPublicKey,
                    amount: amount,
                    timestamp: Date.now(),
                    id: results[results.length - 1]?.txHash || results[0]?.txHash,
                    txHash: results[results.length - 1]?.txHash || results[0]?.txHash,
                    transfers: results,
                    totalTransfers: results.length,
                };
            } else {
                // Single note transfer
                const inputNoteToUse = selectedNotes[0];
                return await this.executeSingleTransfer(
                    identity,
                    recipientPublicKey,
                    amount,
                    inputNoteToUse
                );
            }
        } catch (error) {
            console.error('[CipherPayService] Failed to create transaction:', error);
            throw error;
        }
    }

    // Execute a single transfer with a specific note
    async executeSingleTransfer(identity, recipientPublicKey, amount, inputNoteToUse) {
        try {
            // Validate input note structure
            if (!inputNoteToUse.amount || !inputNoteToUse.tokenId || !inputNoteToUse.ownerCipherPayPubKey || !inputNoteToUse.randomness) {
                throw new Error('Invalid input note structure');
            }

            // Parse recipient public key (should be ownerCipherPayPubKey as hex string or bigint)
            let recipientCipherPayPubKey;
            if (typeof recipientPublicKey === 'string') {
                recipientCipherPayPubKey = recipientPublicKey.startsWith('0x')
                    ? BigInt(recipientPublicKey)
                    : BigInt('0x' + recipientPublicKey);
            } else {
                recipientCipherPayPubKey = BigInt(recipientPublicKey);
            }

            // Validate sufficient balance
            if (inputNoteToUse.amount < amount) {
                throw new Error(`Insufficient balance in selected note. Note amount: ${inputNoteToUse.amount}, requested: ${amount}`);
            }

            // PRIVACY-PRESERVING TRANSFER DESIGN:
            // - If transfer amount == input note amount: Randomly split into two outputs (privacy-preserving)
            // - If transfer amount < input note amount: Output1 = transfer (recipient), Output2 = remainder (sender change)
            const inputAmount = BigInt(inputNoteToUse.amount);
            const transferAmount = amount;
            
            let out1Amount, out2Amount;
            let recipientGetsOut1;
            let recipientAmount, changeAmount;
            
            if (transferAmount === inputAmount) {
                // CASE 1: Transfer amount equals input amount - Randomly split for privacy
                // This prevents observers from knowing which output is the recipient
                // Minimum dust amount for each output (to prevent tiny notes)
                const minDust = 1000n; // 0.000001 SOL minimum per output
                const maxSplit = inputAmount - minDust;
                
                if (maxSplit < minDust) {
                    // Edge case: input amount is too small to split meaningfully
                    // Split equally
                    out1Amount = inputAmount / 2n;
                    out2Amount = inputAmount - out1Amount;
                } else {
                    // Generate random split: out1Amount between minDust and maxSplit
                    const range = maxSplit - minDust + 1n;
                    const randomBytes = new Uint8Array(8);
                    crypto.getRandomValues(randomBytes);
                    // Convert random bytes to BigInt (0 to 2^64-1)
                    let randomBigInt = 0n;
                    for (let i = 0; i < 8; i++) {
                        randomBigInt = (randomBigInt << 8n) | BigInt(randomBytes[i]);
                    }
                    // Scale to range
                    out1Amount = minDust + (randomBigInt % range);
                    out2Amount = inputAmount - out1Amount;
                }
                
                // Randomly decide which output position gets the recipient
                // This further enhances privacy - can't tell from position which is recipient
                recipientGetsOut1 = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0;
                recipientAmount = recipientGetsOut1 ? out1Amount : out2Amount;
                changeAmount = recipientGetsOut1 ? out2Amount : out1Amount;
                
                console.log('[CipherPayService] Full amount transfer - Randomly split for privacy:', {
                    inputAmount: inputAmount.toString(),
                    transferAmount: transferAmount.toString(),
                    out1Amount: out1Amount.toString(),
                    out2Amount: out2Amount.toString(),
                    recipientGetsOut1,
                    recipientAmount: recipientAmount.toString(),
                    changeAmount: changeAmount.toString(),
                });
            } else {
                // CASE 2: Transfer amount < input amount - Direct split (no privacy needed)
                // Output1: recipient gets exact transfer amount
                // Output2: sender gets remaining balance (change)
                out1Amount = transferAmount;
                out2Amount = inputAmount - transferAmount;
                recipientGetsOut1 = true; // Recipient always gets out1 in this case
                recipientAmount = out1Amount;
                changeAmount = out2Amount;
                
                console.log('[CipherPayService] Partial amount transfer - Direct split:', {
                    inputAmount: inputAmount.toString(),
                    transferAmount: transferAmount.toString(),
                    out1Amount: out1Amount.toString(),
                    out2Amount: out2Amount.toString(),
                    recipientGetsOut1: true,
                    recipientAmount: recipientAmount.toString(),
                    changeAmount: changeAmount.toString(),
                });
            }

            // Get auth token for server API calls
            const authToken = localStorage.getItem('cipherpay_token');
            const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';

            // Determine token descriptor from input note (assume same token for outputs)
            // For now, assume wSOL (can be enhanced to support other tokens)
            const tokenDescriptor = {
                chain: 'solana',
                symbol: 'SOL',
                decimals: 9,
                solana: {
                    mint: 'So11111111111111111111111111111111111111112', // wSOL
                    decimals: 9,
                }
            };

            // Import encryption utilities
            const { getLocalEncPublicKeyB64, encryptForRecipient } = await import('../lib/e2ee');

            // Prepare transfer parameters with privacy-preserving random split
            // Ensure all values are BigInt (defensive conversion from hex strings or numbers)
            const toBigInt = (val) => {
                if (typeof val === 'bigint') return val;
                if (typeof val === 'string' && val.startsWith('0x')) return BigInt(val);
                return BigInt(val);
            };
            
            // DEBUG: Log inputNoteToUse before conversion
            console.log('[CipherPayService] inputNoteToUse (before conversion):', {
                amount: inputNoteToUse.amount,
                amountType: typeof inputNoteToUse.amount,
                amountIsArray: Array.isArray(inputNoteToUse.amount),
                tokenId: inputNoteToUse.tokenId,
                tokenIdType: typeof inputNoteToUse.tokenId,
                randomness: inputNoteToUse.randomness,
                randomnessR: inputNoteToUse.randomness?.r,
                randomnessRType: typeof inputNoteToUse.randomness?.r,
                memo: inputNoteToUse.memo,
                memoType: typeof inputNoteToUse.memo,
            });
            
            const convertedAmount = toBigInt(inputNoteToUse.amount);
            const convertedTokenId = toBigInt(inputNoteToUse.tokenId);
            const convertedRandomnessR = toBigInt(inputNoteToUse.randomness.r);
            const convertedMemo = inputNoteToUse.memo ? toBigInt(inputNoteToUse.memo) : 0n;
            
            // DEBUG: Log converted values
            console.log('[CipherPayService] Converted values:', {
                amount: convertedAmount.toString(),
                amountType: typeof convertedAmount,
                amountIsArray: Array.isArray(convertedAmount),
                tokenId: convertedTokenId.toString(),
                randomnessR: convertedRandomnessR.toString(),
                memo: convertedMemo.toString(),
            });
            
            const inputNoteObj = {
                amount: convertedAmount,
                tokenId: convertedTokenId,
                ownerCipherPayPubKey: toBigInt(inputNoteToUse.ownerCipherPayPubKey),
                randomness: {
                    r: convertedRandomnessR,
                    s: inputNoteToUse.randomness.s ? toBigInt(inputNoteToUse.randomness.s) : undefined,
                },
                memo: convertedMemo,
            };
            
            // DEBUG: Log final inputNote object
            console.log('[CipherPayService] Final inputNote object:', {
                amount: inputNoteObj.amount.toString(),
                amountType: typeof inputNoteObj.amount,
                amountIsArray: Array.isArray(inputNoteObj.amount),
                tokenId: inputNoteObj.tokenId.toString(),
                randomness: {
                    r: inputNoteObj.randomness.r.toString(),
                    rType: typeof inputNoteObj.randomness.r,
                },
                memo: inputNoteObj.memo.toString(),
            });
            
            const transferParams = {
                identity,
                inputNote: inputNoteObj,
                out1: {
                    amount: { atoms: out1Amount, decimals: 9 },
                    recipientCipherPayPubKey: recipientGetsOut1 ? recipientCipherPayPubKey : BigInt(inputNoteToUse.ownerCipherPayPubKey),
                    token: tokenDescriptor,
                    memo: 0n,
                },
                out2: {
                    amount: { atoms: out2Amount, decimals: 9 },
                    recipientCipherPayPubKey: recipientGetsOut1 ? BigInt(inputNoteToUse.ownerCipherPayPubKey) : recipientCipherPayPubKey,
                    token: tokenDescriptor,
                    memo: 0n,
                },
                serverUrl,
                authToken,
                ownerWalletPubKey: identity.ownerWalletPubKey || BigInt(0),
                ownerWalletPrivKey: identity.ownerWalletPrivKey || BigInt(0),
                onOut1NoteReady: async (note) => {
                    // Temporarily disabled for debugging - prevents transfer messages from being created
                    console.log('[CipherPayService] Out1 note ready (message saving disabled for debugging)', note);
                    /*
                    try {
                        console.log('[CipherPayService] Out1 note ready, encrypting and saving...', note);
                        const recipientEncPubKeyB64 = getLocalEncPublicKeyB64();
                        const noteData = {
                            note: {
                                amount: '0x' + note.amount.toString(16),
                                tokenId: '0x' + note.tokenId.toString(16),
                                ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                randomness: {
                                    r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                    ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                },
                                ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                            },
                        };
                        const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, noteData);
                        const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({
                                recipientKey,
                                ciphertextB64,
                                kind: 'note-transfer',
                            }),
                        });
                        if (messageResponse.ok) {
                            const messageResult = await messageResponse.json();
                            console.log('[CipherPayService] Saved encrypted out1 note message:', messageResult);
                        } else {
                            const errorText = await messageResponse.text();
                            console.warn('[CipherPayService] Failed to save out1 note message:', errorText);
                        }
                    } catch (error) {
                        console.warn('[CipherPayService] Failed to save encrypted out1 note message:', error);
                    }
                    */
                },
                onOut2NoteReady: async (note) => {
                    // Temporarily disabled for debugging - prevents transfer messages from being created
                    console.log('[CipherPayService] Out2 note ready (change) (message saving disabled for debugging)', note);
                    /*
                    try {
                        console.log('[CipherPayService] Out2 note ready (change), encrypting and saving...', note);
                        const recipientEncPubKeyB64 = getLocalEncPublicKeyB64();
                        const noteData = {
                            note: {
                                amount: '0x' + note.amount.toString(16),
                                tokenId: '0x' + note.tokenId.toString(16),
                                ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                randomness: {
                                    r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                    ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                },
                                ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                            },
                        };
                        const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, noteData);
                        const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({
                                recipientKey,
                                ciphertextB64,
                                kind: 'note-transfer',
                            }),
                        });
                        if (messageResponse.ok) {
                            const messageResult = await messageResponse.json();
                            console.log('[CipherPayService] Saved encrypted out2 note message (change):', messageResult);
                        } else {
                            const errorText = await messageResponse.text();
                            console.warn('[CipherPayService] Failed to save out2 note message:', errorText);
                        }
                    } catch (error) {
                        console.warn('[CipherPayService] Failed to save encrypted out2 note message:', error);
                    }
                    */
                },
            };

            console.log('[CipherPayService] Calling SDK transfer with params:', {
                inputNoteAmount: transferParams.inputNote.amount.toString(),
                out1Amount: transferParams.out1.amount.atoms.toString(),
                out2Amount: transferParams.out2.amount.atoms.toString(),
            });

            // Call SDK transfer
            const result = await window.CipherPaySDK.transfer(transferParams);

            console.log('[CipherPayService] Transfer completed:', result);

            return {
                recipient: recipientPublicKey,
                amount: amount,
                changeAmount: changeAmount,
                timestamp: Date.now(),
                id: result.txId || result.signature,
                txHash: result.txId || result.signature,
                out1Commitment: result.out1Commitment?.toString(),
                out2Commitment: result.out2Commitment?.toString(),
                nullifier: result.nullifier?.toString(),
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to execute single transfer:', error);
            throw error;
        }
    }

    async sendTransaction(transaction) {
        if (!this.isInitialized) await this.initialize();

        try {
            // The transaction is already sent when created via SDK transfer
            // This method is kept for compatibility with the UI
            // Return the transaction details as receipt
            return {
                txHash: transaction.id || transaction.txHash,
                status: 'success',
                signature: transaction.id || transaction.txHash,
                out1Commitment: transaction.out1Commitment,
                out2Commitment: transaction.out2Commitment,
                nullifier: transaction.nullifier
            };
        } catch (error) {
            console.error('Failed to send transaction:', error);
            throw error;
        }
    }

    async checkTransactionStatus(txHash) {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.relayerClient.checkTxStatus(txHash);
        } catch (error) {
            console.error('Failed to check transaction status:', error);
            throw error;
        }
    }

    // Delegate Approval (One-time setup before deposits)
    async approveRelayerDelegate(params) {
        try {
            console.log('[CipherPayService] approveRelayerDelegate called with params:', params);
            
            // Validate required parameters
            if (!params.connection) throw new Error('Solana connection is required');
            if (!params.wallet) throw new Error('Wallet is required');
            if (!params.tokenMint) throw new Error('Token mint address is required');
            if (!params.amount) throw new Error('Amount is required');
            
            // Check if SDK function is available
            if (!window.CipherPaySDK?.approveRelayerDelegate) {
                throw new Error('SDK approveRelayerDelegate function not available. Ensure the SDK bundle is loaded.');
            }

            // Get relayer public key from server
            const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';
            const response = await fetch(`${serverUrl}/api/relayer/info`);
            if (!response.ok) {
                throw new Error(`Failed to get relayer info: ${response.status}`);
            }
            const { relayerPubkey } = await response.json();
            console.log('[CipherPayService] Relayer pubkey:', relayerPubkey);

            // Import PublicKey
            const { PublicKey } = await import('@solana/web3.js');

            // Call SDK approveRelayerDelegate
            const result = await window.CipherPaySDK.approveRelayerDelegate({
                connection: params.connection,
                wallet: params.wallet,
                tokenMint: new PublicKey(params.tokenMint),
                relayerPubkey: new PublicKey(relayerPubkey),
                amount: BigInt(params.amount),
            });
            
            console.log('[CipherPayService] Delegate approval completed:', result);
            
            return {
                signature: result.signature,
                userTokenAccount: result.userTokenAccount.toBase58(),
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to approve relayer delegate:', error);
            throw error;
        }
    }

    // Deposit Management
    async createDeposit(params) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log('[CipherPayService] createDeposit called with params:', params);
            
            // Validate required parameters
            if (!params.amount) throw new Error('Amount is required');
            if (!params.tokenMint) throw new Error('Token mint address is required');
            
            // Check if SDK deposit function is available
            if (!window.CipherPaySDK?.deposit) {
                throw new Error('SDK deposit function not available. Ensure the SDK bundle is loaded.');
            }

            // Get identity from stored keys (created during authentication)
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found. Please authenticate first.');
            }

            // Get auth token for server API calls
            const authToken = localStorage.getItem('cipherpay_token');

            // Prepare token descriptor
            const tokenDescriptor = {
                chain: 'solana',
                symbol: params.tokenSymbol || 'UNKNOWN',
                decimals: params.decimals || 9,
                solana: {
                    mint: params.tokenMint,
                    decimals: params.decimals || 9,
                }
            };

            // Get server URL (cipherpay-server, NOT relayer)
            const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';

            // Prepare deposit parameters for SDK
            const depositParams = {
                identity,
                token: tokenDescriptor,
                amount: {
                    atoms: BigInt(params.amount),
                    decimals: params.decimals || 9,
                },
                memo: params.memo ? BigInt(params.memo) : 0n,
                serverUrl,  // UI → Server → Relayer flow
                authToken,
                ownerWalletPubKey: identity.ownerWalletPubKey || BigInt(0),
                ownerWalletPrivKey: identity.ownerWalletPrivKey || BigInt(0),
                nonce: BigInt(Date.now() % 1000000), // Simple nonce for now
                // Delegate mode parameters
                sourceOwner: params.sourceOwner,
                sourceTokenAccount: params.sourceTokenAccount,
                useDelegate: params.useDelegate,
            };

            // Callback to save encrypted note during prepare phase
            const onNoteReady = async (note) => {
                try {
                    console.log('[CipherPayService] Note ready, encrypting and saving...', note);
                    
                    // Get encryption public key (will validate and recreate if corrupted)
                    const recipientEncPubKeyB64 = getLocalEncPublicKeyB64();
                    
                    // Format note data as hex strings (with 0x prefix) for consistency with decrypt function
                    const noteData = {
                        note: {
                            amount: '0x' + note.amount.toString(16),
                            tokenId: '0x' + note.tokenId.toString(16),
                            ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                            randomness: {
                                r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                            },
                            ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                        },
                    };
                    
                    console.log('[CipherPayService] Encrypting note data...');
                    const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, noteData);
                    console.log('[CipherPayService] Encryption successful, ciphertext length:', ciphertextB64.length);
                    const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                    
                    // Send encrypted message to backend
                    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';
                    const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                            recipientKey,
                            ciphertextB64,
                            kind: 'note-deposit',
                        }),
                    });
                    
                    if (messageResponse.ok) {
                        const messageResult = await messageResponse.json();
                        console.log('[CipherPayService] Saved encrypted note message during prepare:', messageResult);
                    } else {
                        const errorText = await messageResponse.text();
                        console.warn('[CipherPayService] Failed to save note message:', errorText);
                        // Don't throw - deposit can continue even if message save fails
                    }
                } catch (error) {
                    console.warn('[CipherPayService] Failed to save encrypted note message:', error);
                    // Don't throw - deposit can continue even if message save fails
                }
            };

            console.log('[CipherPayService] Calling SDK deposit with params:', {
                ...depositParams,
                authToken: authToken ? '***' : null,
            });

            // Add callback to save note during prepare
            depositParams.onNoteReady = onNoteReady;

            // Call SDK deposit function (now calls server APIs)
            const result = await window.CipherPaySDK.deposit(depositParams);
            
            console.log('[CipherPayService] Deposit completed:', result);
            
            return {
                txHash: result.signature || result.txId,
                commitment: result.commitment?.toString(),
                merkleRoot: result.merkleRoot?.toString(),
                index: result.index,
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to create deposit:', error);
            throw error;
        }
    }

    // Helper to get identity from stored keys
    async getIdentity() {
        try {
            // Try to get identity from authService or localStorage
            const storedIdentity = localStorage.getItem('cipherpay_identity');
            if (storedIdentity) {
                const parsed = JSON.parse(storedIdentity);
                
                // Helper to convert stored values to BigInt
                const toBigInt = (val) => {
                    if (!val) return BigInt(0);
                    if (typeof val === 'bigint') return val;
                    if (typeof val === 'string' && /^-?\d+$/.test(val) && val.length > 15) {
                        return BigInt(val);
                    }
                    if (typeof val === 'string' && /^\d+(,\d+)+$/.test(val)) {
                        // Convert comma-separated bytes to hex then BigInt
                        const nums = val.split(',').map(x => parseInt(x, 10));
                        const hex = nums.map(b => b.toString(16).padStart(2, '0')).join('');
                        return BigInt('0x' + hex);
                    }
                    return BigInt(val);
                };
                
                // Extract keypair from stored identity
                const keypair = parsed.keypair || {};
                const ownerWalletPubKey = toBigInt(keypair.pubKey);
                const ownerWalletPrivKey = toBigInt(keypair.privKey);
                
                // recipientCipherPayPubKey is derived from the keypair
                // For now, use pubKey as recipient (can be computed from Poseidon(pubKey, privKey) if needed)
                const recipientCipherPayPubKey = ownerWalletPubKey;
                
                console.log('[CipherPayService] Loaded identity with wallet keys:', {
                    ownerWalletPubKey: ownerWalletPubKey.toString().substring(0, 20) + '...',
                    ownerWalletPrivKey: ownerWalletPrivKey.toString().substring(0, 20) + '...',
                });
                
                return {
                    recipientCipherPayPubKey,
                    ownerWalletPubKey,
                    ownerWalletPrivKey,
                };
            }

            // Fallback: create a temporary identity (not ideal for production)
            console.warn('[CipherPayService] No stored identity found, using temporary identity');
            return {
                recipientCipherPayPubKey: BigInt(1),
                ownerWalletPubKey: BigInt(1),
                ownerWalletPrivKey: BigInt(1),
            };
        } catch (error) {
            console.error('[CipherPayService] Error getting identity:', error);
            return null;
        }
    }

    // Proof Management
    async generateProof(input) {
        if (!this.isInitialized) await this.initialize();

        try {
            const proof = await this.sdk.zkProver.generateTransferProof(input);
            return proof;
        } catch (error) {
            console.error('Failed to generate proof:', error);
            throw error;
        }
    }

    async verifyProof(proof, publicSignals, verifierKey) {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.zkProver.verifyProof(proof, publicSignals, verifierKey);
        } catch (error) {
            console.error('Failed to verify proof:', error);
            throw error;
        }
    }

    // View Key Management
    exportViewKey() {
        return this.sdk?.viewKeyManager?.exportViewKey() || null;
    }

    generateProofOfPayment(note) {
        return this.sdk?.viewKeyManager?.generateProofOfPayment(note) || null;
    }

    verifyProofOfPayment(proof, note, viewKey) {
        return this.sdk?.viewKeyManager?.verifyProofOfPayment(proof, note, viewKey) || false;
    }

    // Merkle Tree Operations
    async fetchMerkleRoot() {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.merkleTreeClient.fetchMerkleRoot();
        } catch (error) {
            console.error('Failed to fetch Merkle root:', error);
            throw error;
        }
    }

    async getMerklePath(commitment) {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.merkleTreeClient.getMerklePath(commitment);
        } catch (error) {
            console.error('Failed to get Merkle path:', error);
            throw error;
        }
    }

    // Withdrawal Management
    async withdraw(amount, recipientAddress) {
        if (!this.isInitialized) await this.initialize();

        try {
            const withdrawRequest = {
                amount: BigInt(amount),
                recipientAddress: recipientAddress,
                complianceCheck: true,
                metadata: {
                    timestamp: Date.now(),
                    source: 'cipherpay-ui'
                }
            };

            const result = await this.sdk.withdraw(withdrawRequest);

            if (!result.success) {
                throw new Error(result.error || 'Withdrawal failed');
            }

            return {
                txHash: result.txHash,
                proof: result.proof,
                complianceStatus: result.complianceStatus
            };
        } catch (error) {
            console.error('Failed to withdraw:', error);
            throw error;
        }
    }

    // Compliance Management
    async generateComplianceReport(startTime, endTime) {
        if (!this.isInitialized) await this.initialize();

        try {
            return this.sdk.generateComplianceReport(startTime, endTime);
        } catch (error) {
            console.error('Failed to generate compliance report:', error);
            throw error;
        }
    }

    // Cache Management
    getCacheStats() {
        if (!this.isInitialized) return null;
        return this.sdk.getCacheStats();
    }

    // Utility Methods
    isConnected() {
        try {
            // Return true only if walletProvider exists and has a valid public address
            const address = this.getPublicAddress();
            return !!(this.sdk?.walletProvider && address && typeof address === 'string' && address.length > 0);
        } catch (error) {
            // Handle any errors gracefully
            return false;
        }
    }

    async getServiceStatus() {
        console.log('[CipherPayService] getServiceStatus called (should always log this!)');
        const allNotes = await this.getAllNotes();
        const publicAddress = this.getPublicAddress();
        const balance = this.getBalance();
        const isConnected = !!(this.sdk?.walletProvider && publicAddress && typeof publicAddress === 'string' && publicAddress.length > 0);
        const spendableNotes = await this.getSpendableNotes();
        console.log('[CipherPayService] getServiceStatus returning:', { isConnected, publicAddress, balance });
        return {
            isInitialized: this.isInitialized,
            isConnected,
            publicAddress: publicAddress || null,
            balance,
            spendableNotes: spendableNotes.length,
            totalNotes: allNotes.length,
            cacheStats: this.getCacheStats(),
            chainType: this.config.chainType
        };
    }

    // Account Overview from Backend (decrypts messages.ciphertext)
    async getAccountOverviewFromBackend(options = {}) {
        try {
            const overview = await fetchAccountOverview(options);
            return overview;
        } catch (error) {
            console.error('[CipherPayService] Failed to get account overview from backend:', error);
            throw error;
        }
    }

    async getMessagesFromBackend(options = {}) {
        try {
            return await fetchMessages(options);
        } catch (error) {
            console.error('[CipherPayService] Failed to fetch messages from backend:', error);
            throw error;
        }
    }

    async decryptMessagesFromBackend(messages) {
        try {
            return decryptMessages(messages);
        } catch (error) {
            console.error('[CipherPayService] Failed to decrypt messages:', error);
            throw error;
        }
    }

    async computeAccountOverviewFromNotes(notes, checkOnChain = false) {
        try {
            return await computeAccountOverview(notes, checkOnChain);
        } catch (error) {
            console.error('[CipherPayService] Failed to compute account overview:', error);
            throw error;
        }
    }

    // Event Handling
    addEventListener(eventType, callback) {
        if (!this.eventListeners[eventType]) {
            this.eventListeners[eventType] = [];
        }
        this.eventListeners[eventType].push(callback);
        console.log(`[CipherPayService] Event listener added for: ${eventType}`);
    }

    removeEventListener(eventType, callback) {
        if (!this.eventListeners[eventType]) return;
        this.eventListeners[eventType] = this.eventListeners[eventType].filter(cb => cb !== callback);
        console.log(`[CipherPayService] Event listener removed for: ${eventType}`);
    }

    emit(eventType, data) {
        console.log(`[CipherPayService] Emitting event: ${eventType}`, data);
        if (!this.eventListeners[eventType]) return;
        this.eventListeners[eventType].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[CipherPayService] Error in event listener for ${eventType}:`, error);
            }
        });
    }

    // Start event monitoring via Server SSE (not relayer API)
    async startEventMonitoring(recipientKey) {
        if (this.eventMonitoringActive) {
            console.log('[CipherPayService] Event monitoring already active');
            return;
        }

        if (!recipientKey) {
            console.warn('[CipherPayService] Cannot start event monitoring: recipientKey required');
            return;
        }

        console.log('[CipherPayService] Starting SSE event monitoring for:', recipientKey);
        this.eventMonitoringActive = true;

        try {
            const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8788';
            // EventSource doesn't support custom headers, so pass token as query param if needed
            const token = localStorage.getItem('cipherpay_token');
            const url = token 
                ? `${serverUrl}/stream?recipientKey=${recipientKey}&token=${encodeURIComponent(token)}`
                : `${serverUrl}/stream?recipientKey=${recipientKey}`;
            const eventSource = new EventSource(url);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[CipherPayService] SSE event received:', data);
                    
                    // Emit specific event types
                    if (data.type === 'DepositCompleted') {
                        console.log('[CipherPayService] Deposit completed event:', data);
                        this.emit('depositCompleted', data);
                    } else if (data.type === 'TransferCompleted') {
                        console.log('[CipherPayService] Transfer completed event:', data);
                        this.emit('transferCompleted', data);
                    } else if (data.type === 'WithdrawCompleted') {
                        console.log('[CipherPayService] Withdraw completed event:', data);
                        this.emit('withdrawCompleted', data);
                    }
                    
                    // Emit generic event for any listeners
                    this.emit('event', data);
                } catch (error) {
                    console.error('[CipherPayService] Error parsing SSE event:', error);
                }
            };

            eventSource.onerror = (error) => {
                console.error('[CipherPayService] SSE connection error:', error);
                if (eventSource.readyState === EventSource.CLOSED) {
                    console.log('[CipherPayService] SSE connection closed, stopping monitoring');
                    this.eventMonitoringActive = false;
                }
            };

            // Store reference to close later
            this.stopEventStream = () => {
                eventSource.close();
                console.log('[CipherPayService] SSE connection closed');
            };
            
            console.log('[CipherPayService] SSE event monitoring started successfully');
        } catch (error) {
            console.error('[CipherPayService] Failed to start SSE event monitoring:', error);
            this.eventMonitoringActive = false;
        }
    }

    stopEventMonitoring() {
        if (!this.eventMonitoringActive) {
            console.log('[CipherPayService] Event monitoring not active');
            return;
        }

        console.log('[CipherPayService] Stopping event monitoring...');
        if (this.stopEventStream) {
            this.stopEventStream();
            this.stopEventStream = null;
        }
        this.eventMonitoringActive = false;
        console.log('[CipherPayService] Event monitoring stopped');
    }

    // Configuration Management
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('Configuration updated:', this.config);
    }

    // Cleanup
    async destroy() {
        // Stop event monitoring
        this.stopEventMonitoring();
        
        if (this.sdk) {
            try {
                // Note: SDK no longer has stopEventMonitoring or destroy methods
                // as event monitoring is now via server SSE
                this.sdk = null;
                this.isInitialized = false;
                console.log('CipherPay SDK destroyed successfully');
            } catch (error) {
                console.error('Failed to destroy SDK:', error);
            }
        }
    }
}

// Create a singleton instance
const cipherPayService = new CipherPayService();
export { CipherPayService };
export default cipherPayService; 