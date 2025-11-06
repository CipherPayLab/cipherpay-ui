import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import cipherPayService from '../services';
import authService from '../services/authService';

const CipherPayContext = createContext();

export const useCipherPay = () => {
    const context = useContext(CipherPayContext);
    if (!context) {
        throw new Error('useCipherPay must be used within a CipherPayProvider');
    }
    return context;
};

export const CipherPayProvider = ({ children }) => {
    // Get Solana wallet adapter state
    const { publicKey: solanaPublicKey, connected: solanaConnected, wallet: solanaWallet } = useWallet();
    
    const [isInitialized, setIsInitialized] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [publicAddress, setPublicAddress] = useState(null);
    const [balance, setBalance] = useState(0);
    const [spendableNotes, setSpendableNotes] = useState([]);
    const [allNotes, setAllNotes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [sdk, setSdk] = useState(null);
    // Don't initialize isAuthenticated from localStorage - wait for connection check
    // This prevents false authentication state from stale tokens
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authUser, setAuthUser] = useState(null);

    // Sync Solana wallet state with CipherPay state
    useEffect(() => {
        if (solanaConnected && solanaPublicKey) {
            const address = solanaPublicKey.toBase58();
            setPublicAddress(address);
            setIsConnected(true);
            // Update service with wallet address
            if (cipherPayService.isInitialized) {
                cipherPayService.setWalletAddress?.(address);
            }
        } else if (!solanaConnected) {
            // Clear wallet connection state when Solana wallet disconnects
            console.log('[CipherPayContext] Solana wallet disconnected, clearing connection state');
            setPublicAddress(null);
            setIsConnected(false);
        }
    }, [solanaConnected, solanaPublicKey]);

    // Initialize the service
    useEffect(() => {
        const initializeService = async () => {
            try {
                setLoading(true);
                setError(null);
                await cipherPayService.initialize();
                setIsInitialized(true);
                setSdk(cipherPayService.sdk); // Set the SDK from the service
                await updateServiceStatus();
                
                // After initialization, check service status to determine if connected
                // Clear any stale authentication tokens if not connected
                const status = cipherPayService.getServiceStatus();
                const serviceConnected = status?.isConnected || false;
                
                if (serviceConnected && authService.isAuthenticated()) {
                    // Only set authenticated if service shows connected
                    setIsAuthenticated(true);
                    setAuthUser(authService.getUser());
                } else {
                    // Clear any stale authentication tokens
                    if (authService.isAuthenticated()) {
                        console.log('[CipherPayContext] Clearing stale authentication - no active connection');
                        authService.clearAuth();
                    }
                    setIsAuthenticated(false);
                    setAuthUser(null);
                }
            } catch (err) {
                setError(err.message);
                console.error('Failed to initialize CipherPay service:', err);
                // On error, clear any stale auth
                if (authService.isAuthenticated()) {
                    authService.clearAuth();
                }
                setIsAuthenticated(false);
                setAuthUser(null);
            } finally {
                setLoading(false);
            }
        };

        initializeService();
    }, []);

    const updateServiceStatus = async () => {
        if (!cipherPayService.isInitialized) {
            console.log('[CipherPayContext] updateServiceStatus: Service not initialized, skipping');
            return;
        }

        const status = cipherPayService.getServiceStatus();
        console.log('[CipherPayContext] updateServiceStatus: Raw status from service:', status);

        // Defensive check: only update if we have valid status
        if (!status) {
            console.log('[CipherPayContext] updateServiceStatus: No status returned from service, skipping');
            return;
        }

        // Only update individual states if the values are not undefined
        if (status.isConnected !== undefined) {
            console.log('[CipherPayContext] updateServiceStatus: Setting isConnected to:', status.isConnected);
            setIsConnected(status.isConnected);
        }

        if (status.publicAddress !== undefined) {
            console.log('[CipherPayContext] updateServiceStatus: Setting publicAddress to:', status.publicAddress);
            setPublicAddress(status.publicAddress);
        }

        if (status.balance !== undefined) {
            console.log('[CipherPayContext] updateServiceStatus: Setting balance to:', status.balance);
            setBalance(status.balance);
        }

        // Update notes
        setSpendableNotes(cipherPayService.getSpendableNotes());
        const notes = await cipherPayService.getAllNotes();
        setAllNotes(Array.isArray(notes) ? notes : []);

        console.log('[CipherPayContext] updateServiceStatus: Final state update complete');
    };

    // Wallet Management
    const connectWallet = async () => {
        console.log('[CipherPayContext] connectWallet: Starting wallet connection...');
        try {
            setLoading(true);
            setError(null);
            
            // If Solana wallet is connected, use its address
            if (solanaConnected && solanaPublicKey) {
                const address = solanaPublicKey.toBase58();
                console.log('[CipherPayContext] connectWallet: Using Solana wallet address:', address);
                
                // Set wallet address in service if method exists
                if (cipherPayService.setWalletAddress) {
                    cipherPayService.setWalletAddress(address);
                } else {
                    // Fallback: try to connect through service with wallet address
                    await cipherPayService.connectWallet(address);
                }
                
                setPublicAddress(address);
                setIsConnected(true);
                console.log('[CipherPayContext] connectWallet: setIsConnected(true), address:', address);
            } else {
                // Fallback to service's connectWallet (for mock or SDK)
                const address = await cipherPayService.connectWallet();
                console.log('[CipherPayContext] connectWallet: SDK returned address:', address);
                setPublicAddress(address);
                setIsConnected(true);
                console.log('[CipherPayContext] connectWallet: setIsConnected(true), address:', address);
            }

            // Add a small delay to ensure service state is updated
            console.log('[CipherPayContext] connectWallet: Waiting 100ms for service state to update...');
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log('[CipherPayContext] connectWallet: About to call updateServiceStatus...');
            await updateServiceStatus();
            console.log('[CipherPayContext] connectWallet: updateServiceStatus completed');
            return publicAddress || solanaPublicKey?.toBase58();
        } catch (err) {
            console.error('[CipherPayContext] connectWallet: Error occurred:', err);
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
            console.log('[CipherPayContext] connectWallet: Function completed');
        }
    };

    const disconnectWallet = async () => {
        try {
            setLoading(true);
            setError(null);
            await cipherPayService.disconnectWallet();
            setIsConnected(false);
            setPublicAddress(null);
            await updateServiceStatus();
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Transfer Management
    const createTransfer = async (recipientPublicKey, amount) => {
        try {
            setLoading(true);
            setError(null);
            const transaction = await cipherPayService.createTransaction(recipientPublicKey, amount);
            return transaction;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const sendTransfer = async (transaction) => {
        try {
            setLoading(true);
            setError(null);
            const receipt = await cipherPayService.sendTransaction(transaction);
            await updateServiceStatus(); // Refresh balance and notes
            return receipt;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const checkTransferStatus = async (txHash) => {
        try {
            setError(null);
            return await cipherPayService.checkTransactionStatus(txHash);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Deposit Management
    const createDeposit = async (amount) => {
        try {
            setLoading(true);
            setError(null);
            const txHash = await cipherPayService.createDeposit(amount);
            await updateServiceStatus(); // Refresh balance and notes
            return txHash;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Proof Management
    const generateProof = async (input) => {
        try {
            setLoading(true);
            setError(null);
            const proof = await cipherPayService.generateProof(input);
            return proof;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const verifyProof = async (proof, publicSignals, verifierKey) => {
        try {
            setError(null);
            return await cipherPayService.verifyProof(proof, publicSignals, verifierKey);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // View Key Management
    const exportViewKey = () => {
        try {
            setError(null);
            return cipherPayService.exportViewKey();
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const generateProofOfPayment = (note) => {
        try {
            setError(null);
            return cipherPayService.generateProofOfPayment(note);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const verifyProofOfPayment = (proof, note, viewKey) => {
        try {
            setError(null);
            return cipherPayService.verifyProofOfPayment(proof, note, viewKey);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Merkle Tree Operations
    const fetchMerkleRoot = async () => {
        try {
            setError(null);
            return await cipherPayService.fetchMerkleRoot();
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const getMerklePath = async (commitment) => {
        try {
            setError(null);
            return await cipherPayService.getMerklePath(commitment);
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Withdrawal Management
    const createWithdraw = async (amount, recipientAddress) => {
        try {
            setLoading(true);
            setError(null);
            const result = await cipherPayService.withdraw(amount, recipientAddress);
            await updateServiceStatus(); // Refresh balance and notes
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Authentication Management
    const signIn = async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await authService.authenticate(sdk);
            setIsAuthenticated(true);
            setAuthUser(result.user);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const signUp = async () => {
        try {
            setLoading(true);
            setError(null);
            // Sign up is the same as sign in - server creates user on first challenge
            const result = await authService.authenticate(sdk);
            setIsAuthenticated(true);
            setAuthUser(result.user);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const signOut = async () => {
        try {
            authService.clearAuth();
            setIsAuthenticated(false);
            setAuthUser(null);
            await disconnectWallet();
        } catch (err) {
            console.error('Sign out error:', err);
            // Clear auth even if wallet disconnect fails
            setIsAuthenticated(false);
            setAuthUser(null);
        }
    };

    // Sync authentication state with connection state
    // IMPORTANT: Only clear auth when disconnected, don't auto-set from stored tokens
    // This prevents auto-redirect to dashboard when user navigates back to login
    useEffect(() => {
        if (isInitialized) {
            const hasValidToken = authService.isAuthenticated();
            
            // Only manage authentication state when disconnected
            if (!isConnected) {
                // Always clear authentication when not connected
                console.log('[CipherPayContext] Clearing authentication - no active connection');
                if (hasValidToken) {
                    authService.clearAuth();
                }
                setIsAuthenticated(false);
                setAuthUser(null);
            }
            // If connected but not authenticated, don't auto-authenticate from token
            // User must explicitly call signIn() for authentication
            // This allows users to navigate to login page without being redirected
        }
    }, [isInitialized, isConnected]);

    // Utility functions
    const refreshData = useCallback(() => {
        updateServiceStatus();
    }, []);

    const clearError = () => {
        setError(null);
    };

    const value = {
        // State
        isInitialized,
        isConnected,
        publicAddress,
        balance,
        spendableNotes,
        allNotes,
        loading,
        error,
        sdk,
        isAuthenticated,
        authUser,

        // Wallet Management
        connectWallet,
        disconnectWallet,

        // Authentication
        signIn,
        signUp,
        signOut,

        // Transfer Management
        createTransfer,
        sendTransfer,
        checkTransferStatus,

        // Deposit Management
        createDeposit,

        // Withdrawal Management
        createWithdraw,

        // Proof Management
        generateProof,
        verifyProof,

        // View Key Management
        exportViewKey,
        generateProofOfPayment,
        verifyProofOfPayment,

        // Merkle Tree Operations
        fetchMerkleRoot,
        getMerklePath,

        // Utility
        refreshData,
        clearError
    };

    return (
        <CipherPayContext.Provider value={value}>
            {children}
        </CipherPayContext.Provider>
    );
}; 