import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

function WalletSelector({ onWalletConnected, onWalletDisconnected }) {
  const { publicKey, connected, disconnect, wallet, wallets, select, connecting, connect } = useWallet();
  const [showWalletList, setShowWalletList] = useState(false);
  const prevConnectedRef = useRef(false); // Track previous connection state

  useEffect(() => {
    // Only call onWalletConnected when connection changes from false to true
    // This prevents auto-authentication when user navigates to login with already-connected wallet
    if (connected && publicKey && onWalletConnected && !prevConnectedRef.current) {
      onWalletConnected(publicKey.toBase58());
    }
    // Update the previous connection state
    prevConnectedRef.current = connected;
  }, [connected, publicKey, onWalletConnected]);

  useEffect(() => {
    if (!connected && onWalletDisconnected) {
      onWalletDisconnected();
    }
  }, [connected, onWalletDisconnected]);

  const handleWalletSelect = async (walletName) => {
    try {
      await select(walletName);
      setShowWalletList(false);
    } catch (error) {
      console.error('Error selecting wallet:', error);
    }
  };

  const handleConnect = async () => {
    try {
      if (wallet?.adapter && !connected) {
        // Trigger the wallet connection
        // This will prompt the user to approve the connection in their wallet extension
        await connect();
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      if (error.name !== 'WalletConnectionUserCancelledError') {
        // Only log errors that aren't user cancellations
        alert(`Connection failed: ${error.message}`);
      }
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      if (onWalletDisconnected) {
        onWalletDisconnected();
      }
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  };

  // If wallet is connected, show connected state
  if (connected && publicKey) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-green-800">
                  {wallet?.adapter?.name || 'Wallet'} Connected
                </p>
                <p className="text-xs text-green-600 font-mono">
                  {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                </p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              className="px-3 py-1 text-sm font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show wallet selection UI
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          {wallet?.adapter?.name ? `Selected: ${wallet.adapter.name}` : 'Select a Wallet'}
        </h3>
        
        {/* Use WalletMultiButton for quick access - this handles Standard Wallets automatically */}
        <div className="flex justify-center mb-4">
          <div className="wallet-adapter-button-wrapper" style={{ minHeight: '40px' }}>
            {wallet?.adapter ? (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center justify-center px-6 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {connecting ? (
                  <>
                    <span className="inline-block animate-spin mr-2">⏳</span>
                    Connecting...
                  </>
                ) : (
                  `Connect ${wallet.adapter.name}`
                )}
              </button>
            ) : (
              <WalletMultiButton />
            )}
          </div>
        </div>
        
        {/* Fallback: If no wallets are available, show a message */}
        {wallets.length === 0 && !connecting && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">
              No wallets detected. Please install a Solana wallet extension like Phantom or Solflare.
            </p>
          </div>
        )}

        {/* Custom wallet list for additional wallets */}
        {wallets.length > 0 && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or choose from list</span>
              </div>
            </div>

            {showWalletList ? (
              <div className="space-y-2">
                {/* Deduplicate wallets by adapter name */}
                {wallets
                  .reduce((unique, wallet) => {
                    // Keep only the first occurrence of each wallet name
                    if (!unique.find(w => w.adapter.name === wallet.adapter.name)) {
                      unique.push(wallet);
                    }
                    return unique;
                  }, [])
                  .map((walletOption) => {
                  const isInstalled = walletOption.readyState === 'Installed' || walletOption.readyState === 'Loadable';
                  const isSelected = wallet?.adapter?.name === walletOption.adapter.name;
                  
                  // Determine status text
                  let statusText = 'Not detected';
                  let statusColor = 'text-gray-500';
                  
                  if (walletOption.readyState === 'Installed') {
                    statusText = 'Installed';
                    statusColor = 'text-green-600';
                  } else if (walletOption.readyState === 'Loadable') {
                    statusText = 'Available';
                    statusColor = 'text-blue-600';
                  }

                  return (
                    <button
                      key={walletOption.adapter.name}
                      onClick={() => handleWalletSelect(walletOption.adapter.name)}
                      disabled={connecting || isSelected || !isInstalled}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50'
                          : isInstalled
                          ? 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-indigo-50'
                          : 'border-gray-200 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex items-center space-x-3 flex-1">
                        {walletOption.adapter.icon && (
                          <img
                            src={walletOption.adapter.icon}
                            alt={walletOption.adapter.name}
                            className="h-8 w-8 flex-shrink-0"
                          />
                        )}
                        <div className="text-left min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {walletOption.adapter.name}
                          </p>
                          <p className={`text-xs font-medium ${statusColor}`}>
                            {statusText}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-2 flex-shrink-0">
                        {isInstalled && (
                          <svg className="h-4 w-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                        {isSelected && (
                          <svg className="h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                onClick={() => setShowWalletList(true)}
                className="w-full text-sm text-indigo-600 hover:text-indigo-700 font-medium py-2"
              >
                Show All Wallets ({wallets.length})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default WalletSelector;

