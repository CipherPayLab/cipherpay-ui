import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import cipherPayService from '../services';

const CipherPayContext = createContext();

export const useCipherPay = () => {
    const context = useContext(CipherPayContext);
    if (!context) {
        throw new Error('useCipherPay must be used within a CipherPayProvider');
    }
    return context;
};

export const CipherPayProvider = ({ children }) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [publicAddress, setPublicAddress] = useState(null);
    const [balance, setBalance] = useState(0);
    const [spendableNotes, setSpendableNotes] = useState([]);
    const [allNotes, setAllNotes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [sdk, setSdk] = useState(null);

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
            } catch (err) {
                setError(err.message);
                console.error('Failed to initialize CipherPay service:', err);
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
            const address = await cipherPayService.connectWallet();
            console.log('[CipherPayContext] connectWallet: SDK returned address:', address);
            setPublicAddress(address);
            setIsConnected(true);
            console.log('[CipherPayContext] connectWallet: setIsConnected(true), address:', address);

            // Add a small delay to ensure service state is updated
            console.log('[CipherPayContext] connectWallet: Waiting 100ms for service state to update...');
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log('[CipherPayContext] connectWallet: About to call updateServiceStatus...');
            await updateServiceStatus();
            console.log('[CipherPayContext] connectWallet: updateServiceStatus completed');
            return address;
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

        // Wallet Management
        connectWallet,
        disconnectWallet,

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