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

class CipherPayService {
    constructor() {
        this.sdk = null;
        this.isInitialized = false;
        this.config = {
            chainType: 'solana', // Use string instead of ChainType enum
            rpcUrl: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8899',
            relayerUrl: import.meta.env.VITE_RELAYER_URL || 'http://localhost:3000',
            relayerApiKey: import.meta.env.VITE_RELAYER_API_KEY,
            contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
            programId: 'XeEs3gHZGdDhs3Lm1VoukrWrEnjdC3CA5VRtowN5MGz', // Solana program ID
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
                    throw new Error('CipherPaySDK found in global scope but is not a constructor class. The SDK appears to export utility functions only. Please use FallbackCipherPayService by setting VITE_USE_FALLBACK_SERVICE=true or VITE_USE_REAL_SDK=false');
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

            // Temporarily disable event monitoring to avoid errors
            // await this.sdk.startEventMonitoring();
            console.log('Event monitoring temporarily disabled');

            this.isInitialized = true;
            console.log('CipherPay SDK initialized successfully');
        } catch (error) {
            console.error('Failed to initialize CipherPay SDK:', error);
            throw error;
        }
    }

    // Wallet Management
    async connectWallet() {
        if (!this.isInitialized) await this.initialize();

        try {
            // Connect to wallet through the SDK
            const result = await this.sdk.walletProvider.connect();
            console.log('[CipherPayService] connectWallet: SDK walletProvider.connect() result:', result);
            return this.sdk.walletProvider.getPublicAddress();
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        }
    }

    async disconnectWallet() {
        if (this.sdk?.walletProvider) {
            try {
                await this.sdk.walletProvider.disconnect();
            } catch (error) {
                console.error('Failed to disconnect wallet:', error);
                throw error;
            }
        }
    }

    getPublicAddress() {
        try {
            const address = this.sdk?.walletProvider?.getPublicAddress();
            console.log('[CipherPayService] getPublicAddress:', address);
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

    // Deposit Management
    async createDeposit(amount) {
        if (!this.isInitialized) await this.initialize();

        try {
            const txHash = await this.sdk.walletProvider.signAndSendDepositTx(
                this.getPublicAddress(),
                amount.toString()
            );
            return txHash;
        } catch (error) {
            console.error('Failed to create deposit:', error);
            throw error;
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

    // Configuration Management
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('Configuration updated:', this.config);
    }

    // Cleanup
    async destroy() {
        if (this.sdk) {
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
const cipherPayService = new CipherPayService();
export { CipherPayService };
export default cipherPayService; 