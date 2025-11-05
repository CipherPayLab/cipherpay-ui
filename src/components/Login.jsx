import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCipherPay } from '../contexts/CipherPayContext';

function Login() {
  const [isConnecting, setIsConnecting] = useState(false);
  const navigate = useNavigate();
  const hasNavigated = useRef(false);

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

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    // Only navigate if authenticated and haven't navigated yet
    if (isAuthenticated && !hasNavigated.current) {
      hasNavigated.current = true;
      // Check current pathname to avoid unnecessary navigation
      const currentPath = window.location.pathname;
      if (currentPath !== '/dashboard') {
        // Use requestAnimationFrame to defer navigation until after render
        requestAnimationFrame(() => {
          navigate('/dashboard', { replace: true });
        });
      }
    }
    // Reset navigation flag if user logs out
    if (!isAuthenticated) {
      hasNavigated.current = false;
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWalletConnect = async (e) => {
    e.preventDefault();
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }

    try {
      setIsConnecting(true);
      clearError();
      
      // Connect wallet first (optional but recommended)
      if (!isConnected) {
        await connectWallet();
      }
      
      // Then authenticate with server
      await signIn();
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to connect and authenticate:', err);
      alert(`Authentication failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }

    try {
      setIsConnecting(true);
      clearError();
      
      // Connect wallet if not connected
      if (!isConnected) {
        await connectWallet();
      }
      
      // Authenticate with server
      await signIn();
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
          {/* Wallet Connection */}
          <div>
            <button
              onClick={handleWalletConnect}
              disabled={isConnecting || loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>

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
                Sign in using your CipherPay identity. Your wallet will be connected automatically.
              </p>
            </div>
            <div>
              <button
                type="submit"
                disabled={isConnecting || loading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConnecting || loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

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