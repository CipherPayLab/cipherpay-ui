import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import WalletSelector from './WalletSelector';

function Login() {
  const [isConnecting, setIsConnecting] = useState(false);
  const navigate = useNavigate();
  const hasNavigated = useRef(false);
  const sessionAuthenticatedRef = useRef(false); // Track if authenticated in THIS session
  const { publicKey, connected: walletConnected } = useWallet();

  const {
    isInitialized,
    isConnected,
    isAuthenticated,
    connectWallet,
    signIn,
    loading,
    error,
    clearError
  } = useCipherPay();

  // Redirect to dashboard ONLY if user completed authentication flow on login page
  // Don't redirect if user just navigated back to login with a stored token
  useEffect(() => {
    // Only check for redirect if we're on the login page
    const currentPath = window.location.pathname;
    if (currentPath !== '/') {
      return;
    }
    
    // Don't redirect during initialization
    if (!isInitialized || loading) {
      return;
    }
    
    // ONLY redirect if:
    // 1. User authenticated in this session (via handleWalletConnected or handleSignIn)
    // 2. AND user is connected
    // 3. AND we haven't already navigated
    if (sessionAuthenticatedRef.current && isAuthenticated && isConnected && !hasNavigated.current) {
      hasNavigated.current = true;
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 0);
    }
    
    // Reset flags if user disconnects
    if (!isAuthenticated || !isConnected) {
      hasNavigated.current = false;
      sessionAuthenticatedRef.current = false;
    }
  }, [isInitialized, isAuthenticated, isConnected, loading, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle wallet connection from WalletSelector
  const handleWalletConnected = async (walletAddress) => {
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }
    
    // Check if user just disconnected - don't auto-authenticate in this case
    // This prevents redirect loop when user disconnects and lands on login page
    try {
      const justDisconnected = sessionStorage.getItem('cipherpay_just_disconnected');
      if (justDisconnected === '1') {
        console.log('[Login] User just disconnected, skipping auto-authentication');
        sessionStorage.removeItem('cipherpay_just_disconnected');
        // Don't auto-authenticate - let user manually click "Connect" button
        return;
      }
    } catch (e) {
      // Ignore sessionStorage errors
    }
    
    try {
      setIsConnecting(true);
      clearError();
      
      console.log('[Login] handleWalletConnected: walletAddress parameter:', walletAddress);
      
      // Connect wallet to CipherPay service using the selected wallet address
      if (!isConnected) {
        await connectWallet();
      }
      
      // Automatically authenticate after wallet connection
      // Pass the wallet address directly to ensure it's used
      await signIn(walletAddress);
      
      // Mark that user authenticated in this session
      sessionAuthenticatedRef.current = true;
      
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to connect and authenticate:', err);
      alert(`Authentication failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnected = () => {
    // Wallet disconnected - clear any errors
    clearError();
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }

    // Check if wallet is connected
    if (!walletConnected || !publicKey) {
      alert('Please connect a wallet first');
      return;
    }

    try {
      setIsConnecting(true);
      clearError();
      
      // Get wallet address from the connected wallet
      const walletAddr = publicKey.toBase58();
      console.log('[Login] handleSignIn: Using wallet address:', walletAddr);
      
      // Connect wallet to CipherPay service if not already connected
      if (!isConnected) {
        await connectWallet();
      }
      
      // Authenticate with server, passing the wallet address directly
      await signIn(walletAddr);
      
      // Mark that user authenticated in this session
      sessionAuthenticatedRef.current = true;
      
      navigate('/dashboard');
    } catch (err) {
      console.error('Sign in failed:', err);
      alert(`Sign in failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  if (loading && !isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">Initializing CipherPay...</h2>
            <p className="mt-2 text-sm text-gray-600">Please wait while we set up your secure environment.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to CipherPay
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Privacy-preserving payments powered by zero-knowledge proofs
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Connection Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-6">
          {/* Wallet Selection */}
          <WalletSelector
            onWalletConnected={handleWalletConnected}
            onWalletDisconnected={handleWalletDisconnected}
          />

          {walletConnected && publicKey && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
                </div>
              </div>

              {/* Sign In Form */}
              <form className="space-y-6" onSubmit={handleSignIn}>
                <div>
                  <p className="text-sm text-gray-600 text-center">
                    Sign in using your CipherPay identity. Your wallet is already connected.
                  </p>
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={isConnecting || loading || !walletConnected}
                    className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConnecting || loading ? 'Signing in...' : 'Sign in'}
                  </button>
                </div>
              </form>
            </>
          )}

          <div className="text-center">
            <a href="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
              Don't have an account? Sign up
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login; 