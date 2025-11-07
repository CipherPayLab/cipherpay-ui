/* eslint-env browser */
/* global BigInt */

// FallbackCipherPayService - Development/Testing Service
// This service provides mock implementations for CipherPay components
// Used when the real SDK is not available, fails to load, or for development/testing
// 
// Environment Variables:
// - REACT_APP_USE_FALLBACK_SERVICE=true: Force use of this service
// - REACT_APP_USE_REAL_SDK=false: Use this service as fallback
// 
// Features:
// - Mock wallet provider with test addresses
// - Mock note management with sample data
// - Mock ZK proof generation and verification
// - Mock relayer client for testing
// - Graceful degradation when real SDK fails

// Import SDK loader
import { loadSDK, getSDKStatus } from './sdkLoader';

// Mock implementations for testing when real SDK is not available
class MockWalletProvider {
    constructor() {
        this.connected = false;
        this.address = null;
        // Use localStorage to persist wallet address across sessions
        this.storageKey = 'cipherpay_mock_wallet_address';
        this.loadPersistedAddress();
    }

    loadPersistedAddress() {
        // Load persisted address from localStorage if available
        if (typeof window !== 'undefined' && window.localStorage) {
            const persisted = localStorage.getItem(this.storageKey);
            if (persisted) {
                this.address = persisted;
            }
        }
    }

    async connect() {
        this.connected = true;
        // If no address exists, generate one and persist it
        if (!this.address) {
            this.address = '0x' + Math.random().toString(16).substr(2, 40);
            // Persist the address to localStorage so it stays consistent
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(this.storageKey, this.address);
            }
        }
        return this.address;
    }

    async disconnect() {
        this.connected = false;
        // Clear the address so the app truly treats us as disconnected
        this.address = null;
        if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem(this.storageKey);
        }
    }

    getPublicAddress() {
        // If not connected, do not expose an address
        return this.connected ? this.address : null;
    }

    // Method to manually set/change wallet address (for testing multiple wallets)
    setWalletAddress(address) {
        this.address = address;
        // Keep internal connection state in sync when address is set manually
        this.connected = !!address;
        if (typeof window !== 'undefined' && window.localStorage) {
            if (address) {
                localStorage.setItem(this.storageKey, address);
            } else {
                localStorage.removeItem(this.storageKey);
            }
        }
    }

    async signAndSendDepositTx(to, value) {
        return '0x' + Math.random().toString(16).substr(2, 64);
    }
}

class MockNoteManager {
    constructor() {
        this.notes = [];
    }

    addNote(note) {
        this.notes.push(note);
    }

    getSpendableNotes() {
        return this.notes.filter(note => !note.spent);
    }

    getAllNotes() {
        return this.notes;
    }

    getBalance() {
        return this.notes
            .filter(note => !note.spent)
            .reduce((total, note) => total + Number(note.amount || 0), 0);
    }
}

class MockTransactionBuilder {
    constructor(noteManager, merkleTreeClient, zkProver) {
        this.noteManager = noteManager;
        this.merkleTreeClient = merkleTreeClient;
        this.zkProver = zkProver;
    }

    async buildTransfer(recipientPublicKey, amount) {
        return {
            recipient: recipientPublicKey,
            amount: amount,
            timestamp: Date.now(),
            id: 'tx_' + Math.random().toString(16).substr(2, 8)
        };
    }
}

class MockZKProver {
    constructor(wasmPath, zkeyPath) {
        this.wasmPath = wasmPath;
        this.zkeyPath = zkeyPath;
    }

    async generateTransferProof(input) {
        return {
            proof: {
                pi_a: ['0x' + Math.random().toString(16).substr(2, 64)],
                pi_b: [['0x' + Math.random().toString(16).substr(2, 64)]],
                pi_c: ['0x' + Math.random().toString(16).substr(2, 64)]
            },
            publicSignals: ['0x' + Math.random().toString(16).substr(2, 64)],
            verifierKey: {}
        };
    }

    async verifyProof(proof, publicSignals, verifierKey) {
        return Math.random() > 0.1; // 90% success rate for testing
    }
}

class MockRelayerClient {
    async sendToRelayer(payload) {
        return {
            txHash: '0x' + Math.random().toString(16).substr(2, 64),
            status: 'pending'
        };
    }

    async checkTxStatus(txHash) {
        const statuses = ['pending', 'success', 'failed'];
        return statuses[Math.floor(Math.random() * statuses.length)];
    }
}

class MockViewKeyManager {
    exportViewKey() {
        return '0x' + Math.random().toString(16).substr(2, 64);
    }

    generateProofOfPayment(note) {
        return {
            proof: '0x' + Math.random().toString(16).substr(2, 64),
            metadata: {
                noteId: note.commitment,
                timestamp: Date.now()
            }
        };
    }

    verifyProofOfPayment(proof, note, viewKey) {
        return Math.random() > 0.1; // 90% success rate for testing
    }
}

class FallbackCipherPayService {
    constructor() {
        this.walletProvider = null;
        this.noteManager = null;
        this.transactionBuilder = null;
        this.zkProver = null;
        this.relayerClient = null;
        this.viewKeyManager = null;
        this.merkleTreeClient = null;
        this.isInitialized = false;
        this.sdk = null;
        this.useRealSDK = import.meta.env.VITE_USE_REAL_SDK === 'true';
        this.config = {
            chainType: 'solana', // Default to Solana for end-to-end testing
            rpcUrl: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8899', // Local Solana validator
            relayerUrl: import.meta.env.VITE_RELAYER_URL || 'http://localhost:3000', // Local Solana relayer
            programId: import.meta.env.VITE_PROGRAM_ID, // Solana program ID
            enableCompliance: import.meta.env.VITE_ENABLE_COMPLIANCE !== 'false',
            enableCaching: import.meta.env.VITE_ENABLE_CACHING !== 'false',
            enableStealthAddresses: import.meta.env.VITE_ENABLE_STEALTH_ADDRESSES !== 'false',
            cacheConfig: {
                maxSize: parseInt(import.meta.env.VITE_CACHE_MAX_SIZE) || 1000,
                defaultTTL: parseInt(import.meta.env.VITE_CACHE_DEFAULT_TTL) || 300000
            }
        };
    }

    async initialize() {
        try {
            if (this.useRealSDK) {
                console.log('Initializing CipherPay SDK...');

                // Wait for SDK to be loaded
                const { CipherPaySDK, ChainType, sdkInitialized } = await loadSDK();

                if (!sdkInitialized || !CipherPaySDK) {
                    console.warn('SDK not available, falling back to mock components');
                    this.useRealSDK = false;
                } else {
                    try {
                        // Initialize the real SDK
                        console.log('Creating SDK instance with config:', this.config);
                        this.sdk = new CipherPaySDK(this.config);
                        console.log('SDK instance created successfully');

                        // Test if the SDK has the required methods
                        if (typeof this.sdk.getWalletInfo !== 'function') {
                            console.warn('SDK instance does not have getWalletInfo method');
                            this.useRealSDK = false;
                        } else {
                            // Start event monitoring - temporarily disabled
                            // await this.sdk.startEventMonitoring();
                            console.log('CipherPay SDK initialized successfully');
                            this.isInitialized = true;
                            return;
                        }
                    } catch (error) {
                        console.error('Failed to initialize SDK instance:', error);
                        this.useRealSDK = false;
                    }
                }
            }

            if (!this.useRealSDK) {
                console.log('Initializing CipherPay Service with mock components...');

                // Initialize core components with mocks
                this.walletProvider = new MockWalletProvider();
                this.noteManager = new MockNoteManager();
                this.zkProver = new MockZKProver('./transfer.wasm', './transfer.zkey');
                this.relayerClient = new MockRelayerClient();
                this.viewKeyManager = new MockViewKeyManager();

                // Initialize transaction builder with dependencies
                this.transactionBuilder = new MockTransactionBuilder(
                    this.noteManager,
                    this.merkleTreeClient,
                    this.zkProver
                );

                // Add some mock notes for testing
                this.noteManager.addNote({
                    commitment: '0x' + Math.random().toString(16).substr(2, 64),
                    nullifier: '0x' + Math.random().toString(16).substr(2, 64),
                    amount: '1000000000', // 1 SOL (1 SOL = 1,000,000,000 lamports)
                    encryptedNote: '',
                    spent: false
                });

                this.noteManager.addNote({
                    commitment: '0x' + Math.random().toString(16).substr(2, 64),
                    nullifier: '0x' + Math.random().toString(16).substr(2, 64),
                    amount: '500000000', // 0.5 SOL
                    encryptedNote: '',
                    spent: false
                });
            }

            this.isInitialized = true;
            console.log('CipherPay Service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize CipherPay Service:', error);
            throw error;
        }
    }

    // Wallet Management
    async connectWallet(address = null) {
        if (!this.isInitialized) await this.initialize();

        if (this.useRealSDK && this.sdk) {
            try {
                // Use the SDK's connectWallet method instead of accessing walletProvider directly
                const walletInfo = await this.sdk.connectWallet();
                return walletInfo.address || walletInfo;
            } catch (error) {
                console.error('Failed to connect wallet via SDK:', error);
                throw error;
            }
        } else {
            // If address is provided (from Solana wallet adapter), set it directly
            if (address && this.walletProvider) {
                this.walletProvider.setWalletAddress(address);
                return address;
            }
            // Otherwise, use the mock wallet provider's connect
            await this.walletProvider.connect();
            return this.walletProvider.getPublicAddress();
        }
    }

    // Set wallet address directly (for Solana wallet adapter integration)
    setWalletAddress(address) {
        if (this.walletProvider && typeof this.walletProvider.setWalletAddress === 'function') {
            this.walletProvider.setWalletAddress(address);
        }
    }

    async disconnectWallet() {
        if (this.useRealSDK && this.sdk) {
            try {
                if (typeof this.sdk.disconnectWallet === 'function') {
                    await this.sdk.disconnectWallet();
                } else {
                    // Fallback if SDK lacks explicit disconnect
                    this.useRealSDK = false;
                    await this.walletProvider.disconnect();
                }
                // Ensure local mock state is clean
                this.walletProvider?.setWalletAddress?.(null);
            } catch (error) {
                console.error('Failed to disconnect wallet via SDK:', error);
                throw error;
            }
        } else if (this.walletProvider) {
            await this.walletProvider.disconnect();
            this.walletProvider.setWalletAddress?.(null);
        }
    }

    getPublicAddress() {
        if (this.useRealSDK && this.sdk) {
            try {
                // Check if the SDK has the getWalletInfo method
                if (typeof this.sdk.getWalletInfo === 'function') {
                    const walletInfo = this.sdk.getWalletInfo();
                    return walletInfo?.address || null;
                } else {
                    console.warn('SDK does not have getWalletInfo method, falling back to mock');
                    this.useRealSDK = false;
                    return this.walletProvider?.getPublicAddress() || null;
                }
            } catch (error) {
                console.error('Error calling SDK getWalletInfo:', error);
                console.warn('Falling back to mock components');
                this.useRealSDK = false;
                return this.walletProvider?.getPublicAddress() || null;
            }
        }
        return this.walletProvider?.getPublicAddress() || null;
    }

    // Note Management
    getSpendableNotes() {
        if (this.useRealSDK && this.sdk) {
            return this.sdk.getSpendableNotes() || [];
        }
        return this.noteManager?.getSpendableNotes() || [];
    }

    getAllNotes() {
        if (this.useRealSDK && this.sdk) {
            try {
                // Try to get notes from the real SDK
                return this.sdk.getNotes ? this.sdk.getNotes() : [];
            } catch (error) {
                console.error('Failed to get notes via SDK:', error);
                return [];
            }
        }
        return this.noteManager?.getAllNotes() || [];
    }

    getBalance() {
        if (this.useRealSDK && this.sdk) {
            return this.sdk.getBalance() || 0n;
        }
        return this.noteManager?.getBalance() || 0n;
    }

    addNote(note) {
        if (this.useRealSDK && this.sdk?.noteManager) {
            this.sdk.noteManager.addNote(note);
        } else {
            this.noteManager?.addNote(note);
        }
    }

    // Transaction Management
    async createTransaction(recipientPublicKey, amount) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
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
            } else {
                const transaction = await this.transactionBuilder.buildTransfer(
                    recipientPublicKey,
                    amount
                );
                return transaction;
            }
        } catch (error) {
            console.error('Failed to create transaction:', error);
            throw error;
        }
    }

    async sendTransaction(transaction) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                // The transaction is already sent when created via SDK
                // This method is kept for compatibility with the UI
                return {
                    txHash: transaction.id,
                    status: 'success'
                };
            } else {
                // Use mock relayer client to submit transaction
                if (this.relayerClient && typeof this.relayerClient.sendToRelayer === 'function') {
                    const result = await this.relayerClient.sendToRelayer(transaction);
                    return result;
                } else {
                    // Fallback to mock
                    return {
                        txHash: 'mock-tx-hash',
                        status: 'success'
                    };
                }
            }
        } catch (error) {
            console.error('Failed to send transaction:', error);
            throw error;
        }
    }

    async checkTransactionStatus(txHash) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                // Use the SDK's relayer client to check transaction status
                return await this.sdk.relayerClient.checkTxStatus(txHash);
            } else {
                // Use Solana relayer client to check transaction status
                if (this.relayerClient && typeof this.relayerClient.checkTxStatus === 'function') {
                    return await this.relayerClient.checkTxStatus(txHash);
                } else {
                    // Fallback to mock
                    return 'confirmed';
                }
            }
        } catch (error) {
            console.error('Failed to check transaction status:', error);
            throw error;
        }
    }

    // Deposit Management
    async createDeposit(amount) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                // Use the SDK's wallet provider to create deposit
                const txHash = await this.sdk.walletProvider.signAndSendDepositTx(
                    this.sdk.getWalletInfo()?.address || this.getPublicAddress(),
                    amount.toString()
                );
                return txHash.txHash || txHash;
            } else {
                const txHash = await this.walletProvider.signAndSendDepositTx(
                    this.getPublicAddress(),
                    amount
                );
                return txHash;
            }
        } catch (error) {
            console.error('Failed to create deposit:', error);
            throw error;
        }
    }

    // Proof Management
    async generateProof(input) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                // Use the SDK's ZK prover to generate proof
                return await this.sdk.zkProver.generateTransferProof(input);
            } else {
                const proof = await this.zkProver.generateTransferProof(input);
                return proof;
            }
        } catch (error) {
            console.error('Failed to generate proof:', error);
            throw error;
        }
    }

    async verifyProof(proof, publicSignals, verifierKey) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                return await this.sdk.zkProver.verifyProof(proof, publicSignals, verifierKey);
            } else {
                return await this.zkProver.verifyProof(proof, publicSignals, verifierKey);
            }
        } catch (error) {
            console.error('Failed to verify proof:', error);
            throw error;
        }
    }

    // View Key Management
    exportViewKey() {
        if (this.useRealSDK && this.sdk) {
            return this.sdk.viewKeyManager?.exportViewKey() || null;
        }
        return this.viewKeyManager?.exportViewKey() || null;
    }

    generateProofOfPayment(note) {
        if (this.useRealSDK && this.sdk) {
            return this.sdk.viewKeyManager?.generateProofOfPayment(note) || null;
        }
        return this.viewKeyManager?.generateProofOfPayment(note) || null;
    }

    verifyProofOfPayment(proof, note, viewKey) {
        if (this.useRealSDK && this.sdk) {
            return this.sdk.viewKeyManager?.verifyProofOfPayment(proof, note, viewKey) || false;
        }
        return this.viewKeyManager?.verifyProofOfPayment(proof, note, viewKey) || false;
    }

    // Merkle Tree Operations
    async fetchMerkleRoot() {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                return await this.sdk.merkleTreeClient.fetchMerkleRoot();
            } else {
                // Use mock merkle tree client
                if (this.merkleTreeClient && typeof this.merkleTreeClient.fetchMerkleRoot === 'function') {
                    return await this.merkleTreeClient.fetchMerkleRoot();
                } else {
                    // Fallback to mock
                    return '0x0000000000000000000000000000000000000000000000000000000000000000';
                }
            }
        } catch (error) {
            console.error('Failed to fetch merkle root:', error);
            throw error;
        }
    }

    async getMerklePath(commitment) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                return await this.sdk.merkleTreeClient.getMerklePath(commitment);
            } else {
                // Use mock merkle tree client
                if (this.merkleTreeClient && typeof this.merkleTreeClient.getMerklePath === 'function') {
                    return await this.merkleTreeClient.getMerklePath(commitment);
                } else {
                    // Fallback to mock
                    return {
                        path: [],
                        siblings: []
                    };
                }
            }
        } catch (error) {
            console.error('Failed to get merkle path:', error);
            throw error;
        }
    }

    // Withdrawal Management
    async withdraw(amount, recipientAddress) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
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
            } else {
                throw new Error('Withdrawal not supported in mock mode');
            }
        } catch (error) {
            console.error('Failed to withdraw:', error);
            throw error;
        }
    }

    // Compliance Management
    async generateComplianceReport(startTime, endTime) {
        if (!this.isInitialized) await this.initialize();

        try {
            if (this.useRealSDK && this.sdk) {
                return this.sdk.generateComplianceReport(startTime, endTime);
            } else {
                throw new Error('Compliance reports not supported in mock mode');
            }
        } catch (error) {
            console.error('Failed to generate compliance report:', error);
            throw error;
        }
    }

    // Cache Management
    getCacheStats() {
        if (!this.isInitialized) return null;

        if (this.useRealSDK && this.sdk) {
            return this.sdk.getCacheStats();
        }
        return null;
    }

    // Configuration Management
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('Configuration updated:', this.config);
    }

    // Utility Methods
    isConnected() {
        // Must be connected **and** have a current address
        if (this.useRealSDK && this.sdk) {
            const hasAddr = this.getPublicAddress() !== null;
            // Prefer explicit flag if the SDK exposes one; otherwise rely on address + provider
            return (!!this.sdk.walletProvider) && hasAddr;
        }
        return (!!this.walletProvider?.connected) && (this.getPublicAddress() !== null);
    }

    getServiceStatus() {
        const connected = this.isConnected();
        return {
            isInitialized: this.isInitialized,
            isConnected: connected,
            publicAddress: connected ? this.getPublicAddress() : null,
            balance: this.getBalance(),
            spendableNotes: this.getSpendableNotes().length,
            totalNotes: this.getAllNotes().length,
            cacheStats: this.getCacheStats(),
            chainType: this.config.chainType,
            useRealSDK: this.useRealSDK
        };
    }

    // Cleanup
    async destroy() {
        if (this.useRealSDK && this.sdk) {
            try {
                this.sdk.stopEventMonitoring();
                this.sdk.destroy();
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
const fallbackCipherPayService = new FallbackCipherPayService();
export { FallbackCipherPayService };
export default fallbackCipherPayService; 