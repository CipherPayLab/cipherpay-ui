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
    getSpendableNotes() {
        return this.sdk?.getSpendableNotes() || [];
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

    // Transaction Management
    async createTransaction(recipientPublicKey, amount) {
        if (!this.isInitialized) await this.initialize();

        try {
            // Use the SDK's transfer method
            const transferRequest = {
                amount: BigInt(amount),
                recipientAddress: recipientPublicKey,
                stealthAddress: true,
                complianceCheck: true,
                metadata: {
                    timestamp: Date.now(),
                    source: 'cipherpay-ui'
                }
            };

            const result = await this.sdk.transfer(transferRequest);

            if (!result.success) {
                throw new Error(result.error || 'Transfer failed');
            }

            return {
                recipient: recipientPublicKey,
                amount: amount,
                timestamp: Date.now(),
                id: result.txHash,
                stealthAddress: result.stealthAddress,
                proof: result.proof,
                complianceStatus: result.complianceStatus
            };
        } catch (error) {
            console.error('Failed to create transaction:', error);
            throw error;
        }
    }

    async sendTransaction(transaction) {
        if (!this.isInitialized) await this.initialize();

        try {
            // The transaction is already sent when created via SDK
            // This method is kept for compatibility with the UI
            return {
                txHash: transaction.id,
                status: 'success'
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
            const authToken = localStorage.getItem('cipherpay_auth_token');

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

            console.log('[CipherPayService] Calling SDK deposit with params:', {
                ...depositParams,
                authToken: authToken ? '***' : null,
            });

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
        console.log('[CipherPayService] getServiceStatus returning:', { isConnected, publicAddress, balance });
        return {
            isInitialized: this.isInitialized,
            isConnected,
            publicAddress: publicAddress || null,
            balance,
            spendableNotes: this.getSpendableNotes().length,
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