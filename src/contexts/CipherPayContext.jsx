import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } from '@solana/spl-token';
import { SystemProgram, Transaction } from '@solana/web3.js';
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
    const { publicKey: solanaPublicKey, connected: solanaConnected, wallet: solanaWallet, disconnect: solanaDisconnect, sendTransaction } = useWallet();
    const { connection } = useConnection();
    
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

        // Try to get account overview from backend (decrypts messages.ciphertext)
        // Falls back to SDK's in-memory note manager if backend fails
        // Check auth token directly instead of isAuthenticated state (which may not be updated yet)
        const authToken = localStorage.getItem('cipherpay_token');
        const isAuthTokenPresent = !!authToken;
        
        try {
            console.log('[CipherPayContext] updateServiceStatus: isAuthenticated =', isAuthenticated, 'authToken present =', isAuthTokenPresent);
            if (isAuthTokenPresent) {
                console.log('[CipherPayContext] updateServiceStatus: Attempting to get account overview from backend...');
                const backendOverview = await cipherPayService.getAccountOverviewFromBackend({ checkOnChain: false });
                
                console.log('[CipherPayContext] updateServiceStatus: Got account overview from backend:', backendOverview);
                // Update balance from backend overview (even if 0)
                setBalance(backendOverview.shieldedBalance || 0n);
                // Update notes from backend overview (even if empty)
                const spendable = (backendOverview.notes || []).filter(n => !n.isSpent);
                setSpendableNotes(spendable);
                setAllNotes((backendOverview.notes || []).map(n => ({
                    ...n.note,
                    commitment: n.nullifierHex, // Use nullifier hex as identifier
                    spent: n.isSpent,
                    amount: n.amount,
                })));
                console.log('[CipherPayContext] updateServiceStatus: Updated from backend overview - balance:', backendOverview.shieldedBalance, 'notes:', backendOverview.notes?.length || 0);
                return; // Early return, skip SDK fallback
            } else {
                console.log('[CipherPayContext] updateServiceStatus: No auth token, skipping backend account overview');
            }
        } catch (error) {
            console.warn('[CipherPayContext] updateServiceStatus: Failed to get account overview from backend, falling back to SDK:', error);
            console.warn('[CipherPayContext] updateServiceStatus: Error details:', error.message, error.stack);
            
            // If 401, the token might be invalid - but don't clear it yet, might be a temporary issue
            if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
                console.warn('[CipherPayContext] updateServiceStatus: 401 error - token may be invalid, but keeping it for now');
                // Could trigger re-authentication here if needed
            }
        }

        // Fallback to SDK's in-memory note manager
        if (status.balance !== undefined) {
            console.log('[CipherPayContext] updateServiceStatus: Setting balance to:', status.balance);
            setBalance(status.balance);
        }

        // Update notes from backend (database)
        const spendableNotes = await cipherPayService.getSpendableNotes();
        setSpendableNotes(spendableNotes);
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
            
            // Check if user just disconnected - don't auto-connect in this case
            try {
                const justDisconnected = sessionStorage.getItem('cipherpay_just_disconnected');
                if (justDisconnected === '1') {
                    console.log('[CipherPayContext] User just disconnected, skipping auto-connection');
                    // Clear the flag after a short delay to allow manual reconnection
                    setTimeout(() => {
                        sessionStorage.removeItem('cipherpay_just_disconnected');
                    }, 1000);
                    return null;
                }
            } catch (e) {
                // Ignore sessionStorage errors
            }
            
            let walletAddress = null;
            
            // If Solana wallet is connected, use its address
            if (solanaConnected && solanaPublicKey) {
                walletAddress = solanaPublicKey.toBase58();
                console.log('[CipherPayContext] connectWallet: Using Solana wallet address:', walletAddress);
                
                if (cipherPayService.setWalletAddress) {
                    cipherPayService.setWalletAddress(walletAddress);
                    // Ensure service internal connection flag is set as well
                    if (cipherPayService.connectWallet) {
                        await cipherPayService.connectWallet(walletAddress);
                    }
                } else {
                    // Fallback: try to connect through service with wallet address
                    await cipherPayService.connectWallet(walletAddress);
                }
                
                setPublicAddress(walletAddress);
                setIsConnected(true);
                console.log('[CipherPayContext] connectWallet: setIsConnected(true), address:', walletAddress);
            } else {
                // Fallback to service's connectWallet (for mock or SDK)
                walletAddress = await cipherPayService.connectWallet();
                console.log('[CipherPayContext] connectWallet: SDK returned address:', walletAddress);
                setPublicAddress(walletAddress);
                setIsConnected(true);
                console.log('[CipherPayContext] connectWallet: setIsConnected(true), address:', walletAddress);
            }

            // Add a small delay to ensure service state is updated
            console.log('[CipherPayContext] connectWallet: Waiting 100ms for service state to update...');
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log('[CipherPayContext] connectWallet: About to call updateServiceStatus...');
            await updateServiceStatus();
            console.log('[CipherPayContext] connectWallet: updateServiceStatus completed');
            
            // Store wallet address for use in authentication
            if (walletAddress) {
                try {
                    sessionStorage.setItem('cipherpay_wallet_address', walletAddress);
                    console.log('[CipherPayContext] ====== STORED WALLET ADDRESS (v2) ======');
                    console.log('[CipherPayContext] connectWallet: Stored wallet address in sessionStorage:', walletAddress);
                    console.log('[CipherPayContext] ====== END STORED WALLET ADDRESS ======');
                } catch (e) {
                    console.warn('[CipherPayContext] connectWallet: Failed to store wallet address in sessionStorage:', e);
                }
            } else {
                console.warn('[CipherPayContext] connectWallet: No wallet address to store');
            }
            
            return walletAddress;
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
            // Explicitly clear any persisted auth/session first to avoid immediate re-login loops
            try {
                localStorage.removeItem('cipherpay_token');
                sessionStorage.setItem('cipherpay_just_disconnected', '1');
            } catch (e) {
                console.warn('[CipherPayContext] Unable to clear persisted auth token', e);
            }
            
            // Disconnect from Solana wallet adapter first
            if (solanaDisconnect) {
                try {
                    await solanaDisconnect();
                    console.log('[CipherPayContext] Disconnected from Solana wallet adapter');
                } catch (err) {
                    console.warn('[CipherPayContext] Error disconnecting from Solana wallet adapter:', err);
                    // Continue with disconnect even if Solana adapter disconnect fails
                }
            }
            
            // Disconnect from CipherPay service
            await cipherPayService.disconnectWallet();
            setIsConnected(false);
            setPublicAddress(null);
            setAuthUser(null);
            setIsAuthenticated(false);
            await updateServiceStatus();
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Transfer Management
    const createTransfer = async (recipientPublicKey, amount, inputNote = null) => {
        try {
            setLoading(true);
            setError(null);
            console.log('[CipherPayContext] createTransfer: Called with recipientPublicKey:', recipientPublicKey, 'amount:', amount.toString());
            const transaction = await cipherPayService.createTransaction(recipientPublicKey, amount, inputNote);
            console.log('[CipherPayContext] createTransfer: Transaction created:', transaction);
            
            // Refresh account overview after transfer
            setTimeout(() => {
                console.log('[CipherPayContext] createTransfer: Triggering account overview refresh after transfer');
                updateServiceStatus();
            }, 1000); // Wait a bit for backend to process the transfer
            
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

    // Delegate Approval (One-time setup before first deposit)
    const approveRelayerDelegate = async (params) => {
        try {
            setLoading(true);
            setError(null);
            
            // Validate that required parameters are provided
            if (!params.connection) {
                throw new Error('Connection is required');
            }
            if (!params.wallet || !params.wallet.publicKey) {
                throw new Error('Please connect your wallet first');
            }
            
            console.log('[CipherPayContext] approveRelayerDelegate: Calling service with params:', {
                connection: !!params.connection,
                wallet: !!params.wallet,
                walletPublicKey: params.wallet?.publicKey?.toString(),
                tokenMint: params.tokenMint,
                amount: params.amount?.toString()
            });
            
            const result = await cipherPayService.approveRelayerDelegate(params);
            
            console.log('[CipherPayContext] approveRelayerDelegate: Result:', result);
            
            return result;
        } catch (err) {
            console.error('[CipherPayContext] approveRelayerDelegate: Error:', err);
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Deposit Management (calls server APIs via SDK)
    const createDeposit = async (params) => {
        try {
            setLoading(true);
            setError(null);
            
            // Validate authentication (needed for server API calls)
            if (!isAuthenticated) {
                throw new Error('Please authenticate first');
            }
            
            // Validate wallet connection
            if (!solanaConnected || !solanaPublicKey) {
                throw new Error('Please connect your Solana wallet first');
            }
            
            let sourceOwner = solanaPublicKey.toBase58();
            let sourceTokenAccount = null;
            let useDelegate = false;
            
            // If depositing SOL/wSOL, wrap SOL to wSOL first
            if (params.tokenMint === NATIVE_MINT.toBase58() || params.tokenMint === 'So11111111111111111111111111111111111111112') {
                const { PublicKey } = await import('@solana/web3.js');
                const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
                const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, solanaPublicKey, false, TOKEN_PROGRAM_ID);
                sourceTokenAccount = wsolAta.toBase58();
                
                // Check if ATA exists and has enough balance
                const ataInfo = await connection.getAccountInfo(wsolAta);
                const requiredLamports = Number(params.amount);
                
                // Get current wSOL balance
                let currentBalance = 0;
                if (ataInfo) {
                    try {
                        const tokenAccount = await connection.getTokenAccountBalance(wsolAta);
                        currentBalance = Number(tokenAccount.value.amount);
                    } catch (e) {
                        // ATA exists but might not be initialized yet
                        currentBalance = 0;
                    }
                }
                
                // Wrap SOL to wSOL if needed
                if (currentBalance < requiredLamports) {
                    const delta = requiredLamports - currentBalance;
                    const tx = new Transaction();
                    
                    // Create ATA if it doesn't exist
                    if (!ataInfo) {
                        tx.add(createAssociatedTokenAccountInstruction(
                            solanaPublicKey, // payer
                            wsolAta, // ata
                            solanaPublicKey, // owner
                            WSOL_MINT // mint
                        ));
                    }
                    
                    // Transfer SOL to ATA and sync
                    tx.add(
                        SystemProgram.transfer({
                            fromPubkey: solanaPublicKey,
                            toPubkey: wsolAta,
                            lamports: delta,
                        }),
                        createSyncNativeInstruction(wsolAta)
                    );
                    
                    // Send transaction
                    const signature = await sendTransaction(tx, connection);
                    await connection.confirmTransaction(signature, 'confirmed');
                    console.log('[CipherPayContext] Wrapped', delta / 1e9, 'SOL to wSOL:', signature);
                }
                
                useDelegate = true;
            }
            
            // Prepare deposit parameters (SDK will call server APIs)
            const depositParams = {
                amount: params.amount,
                tokenMint: params.tokenMint,
                tokenSymbol: params.tokenSymbol || 'SOL',
                decimals: params.decimals || 9,
                memo: params.memo || 0,
                sourceOwner,
                sourceTokenAccount,
                useDelegate,
            };
            
            console.log('[CipherPayContext] createDeposit: Calling service with params:', depositParams);
            
            const result = await cipherPayService.createDeposit(depositParams);
            
            console.log('[CipherPayContext] createDeposit: Result:', result);
            
            await updateServiceStatus(); // Refresh balance and notes
            return result;
        } catch (err) {
            console.error('[CipherPayContext] createDeposit: Error:', err);
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
    const signIn = async (walletAddressOverride = null) => {
        try {
            console.log('[CipherPayContext] ====== SIGNIN CALLED (v2) ======');
            setLoading(true);
            setError(null);
            // Get Solana wallet address from multiple sources
            // Priority: 1. Override parameter, 2. sessionStorage, 3. context state, 4. wallet adapter
            let walletAddr = walletAddressOverride;
            console.log('[CipherPayContext] signIn: Called with override:', walletAddressOverride);
            console.log('[CipherPayContext] signIn: Override type:', typeof walletAddressOverride);
            
            if (!walletAddr) {
                try {
                    walletAddr = sessionStorage.getItem('cipherpay_wallet_address');
                    console.log('[CipherPayContext] signIn: Retrieved from sessionStorage:', walletAddr);
                } catch (e) {
                    console.warn('[CipherPayContext] signIn: Failed to read sessionStorage:', e);
                }
            }
            if (!walletAddr) {
                walletAddr = publicAddress || solanaPublicKey?.toBase58() || null;
                console.log('[CipherPayContext] signIn: Using context/wallet adapter:', walletAddr, {
                    publicAddress,
                    solanaPublicKey: solanaPublicKey?.toBase58()
                });
            }
            
            console.log('[CipherPayContext] signIn: Final wallet address to use:', walletAddr);
            console.log('[CipherPayContext] signIn: About to call authService.authenticate with wallet address:', walletAddr);
            console.log('[CipherPayContext] signIn: Solana wallet available:', !!solanaWallet);
            
            await authService.authenticate(sdk, walletAddr, solanaWallet);
            setIsAuthenticated(true);
            // Get user from localStorage (stored by authService.setAuthToken)
            const storedUser = localStorage.getItem('cipherpay_user');
            let user = null;
            if (storedUser) {
                try {
                    user = JSON.parse(storedUser);
                    setAuthUser(user);
                } catch (e) {
                    console.warn('[CipherPayContext] signIn: Failed to parse stored user:', e);
                }
            }
            
            // Start event monitoring for this user
            if (user?.ownerCipherPayPubKey) {
                console.log('[CipherPayContext] signIn: Starting event monitoring for user:', user.ownerCipherPayPubKey);
                await cipherPayService.startEventMonitoring(user.ownerCipherPayPubKey);
                
                // Listen for deposit completed events to refresh account overview
                cipherPayService.on('depositCompleted', async (eventData) => {
                    console.log('[CipherPayContext] Deposit completed event received, refreshing account overview...', eventData);
                    // Wait a bit for backend to process the deposit
                    setTimeout(() => {
                        updateServiceStatus();
                    }, 1000);
                });
            }
            
            // Refresh account overview from backend after authentication
            // Use setTimeout to ensure token is stored and state has updated
            setTimeout(() => {
                console.log('[CipherPayContext] signIn: Triggering account overview refresh after authentication');
                updateServiceStatus();
            }, 100);
            return { success: true };
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const signUp = async (walletAddressOverride = null) => {
        try {
            setLoading(true);
            setError(null);
            // Sign up is the same as sign in - server creates user on first challenge
            // Get Solana wallet address from multiple sources
            // Priority: 1. Override parameter, 2. sessionStorage, 3. context state, 4. wallet adapter
            let walletAddr = walletAddressOverride;
            if (!walletAddr) {
                try {
                    walletAddr = sessionStorage.getItem('cipherpay_wallet_address');
                } catch (e) {
                    // Ignore sessionStorage errors
                }
            }
            if (!walletAddr) {
                walletAddr = publicAddress || solanaPublicKey?.toBase58() || null;
            }
            console.log('[CipherPayContext] signUp: Using wallet address:', walletAddr, {
                override: walletAddressOverride,
                sessionStorage: sessionStorage.getItem('cipherpay_wallet_address'),
                publicAddress,
                solanaPublicKey: solanaPublicKey?.toBase58()
            });
            console.log('[CipherPayContext] signUp: Solana wallet available:', !!solanaWallet);
            await authService.authenticate(sdk, walletAddr, solanaWallet);
            setIsAuthenticated(true);
            // Get user from localStorage (stored by authService.setAuthToken)
            const storedUser = localStorage.getItem('cipherpay_user');
            let user = null;
            if (storedUser) {
                try {
                    user = JSON.parse(storedUser);
                    setAuthUser(user);
                } catch (e) {
                    console.warn('[CipherPayContext] signUp: Failed to parse stored user:', e);
                }
            }
            
            // Start event monitoring for this user
            if (user?.ownerCipherPayPubKey) {
                console.log('[CipherPayContext] signUp: Starting event monitoring for user:', user.ownerCipherPayPubKey);
                await cipherPayService.startEventMonitoring(user.ownerCipherPayPubKey);
            }
            
            // Refresh account overview from backend after authentication
            // Use setTimeout to ensure token is stored and state has updated
            setTimeout(() => {
                console.log('[CipherPayContext] signUp: Triggering account overview refresh after authentication');
                updateServiceStatus();
            }, 100);
            return { success: true };
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const signOut = async () => {
        try {
            // Stop event monitoring
            cipherPayService.stopEventMonitoring();
            
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
    // IMPORTANT: Only clear auth when explicitly disconnected, don't auto-set from stored tokens
    // This prevents auto-redirect to dashboard when user navigates back to login
    // BUT: Don't clear auth just because wallet is disconnected - user might reconnect
    useEffect(() => {
        if (isInitialized) {
            // Check if user explicitly disconnected (not just wallet disconnected)
            // Only clear auth if user explicitly signed out, not just wallet disconnect
            // This allows users to reconnect wallet without losing authentication
            const hasValidToken = authService.isAuthenticated();
            const storedUser = localStorage.getItem('cipherpay_user');
            
            // If we have a valid token and user, keep authentication state
            if (hasValidToken && storedUser) {
                try {
                    const user = JSON.parse(storedUser);
                    if (!isAuthenticated) {
                        console.log('[CipherPayContext] Restoring authentication state from stored token');
                        setIsAuthenticated(true);
                        setAuthUser(user);
                    }
                } catch (e) {
                    console.warn('[CipherPayContext] Failed to parse stored user:', e);
                }
            }
            // Don't auto-authenticate from token on page load
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
        approveRelayerDelegate, // One-time setup before first deposit
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