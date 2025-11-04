import React, { useState, useEffect } from 'react';
import { useCipherPay } from '../contexts/CipherPayContext';

function SDKStatus() {
    const { isInitialized, sdk } = useCipherPay();
    const [sdkStatus, setSdkStatus] = useState({
        hasRelayerClient: false,
        hasMerkleTreeClient: false,
        hasWalletProvider: false,
        hasNoteManager: false
    });

    useEffect(() => {
        const checkSDKStatus = () => {
            if (sdk) {
                setSdkStatus({
                    hasRelayerClient: !!sdk.relayerClient,
                    hasMerkleTreeClient: !!sdk.merkleTreeClient,
                    hasWalletProvider: !!sdk.walletProvider,
                    hasNoteManager: !!sdk.noteManager,
                });
            }
        };

        checkSDKStatus();
    }, [sdk]);

    if (!isInitialized) {
        return (
            <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                    <h2 className="text-lg font-medium text-gray-900 mb-4">SDK Status</h2>
                    <div className="text-sm text-gray-500">SDK not initialized</div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">SDK Components Status</h2>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">Relayer Client</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sdkStatus.hasRelayerClient ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'
                            }`}>
                            {sdkStatus.hasRelayerClient ? '✅ Available' : '❌ Not Available'}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">Merkle Tree Client</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sdkStatus.hasMerkleTreeClient ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'
                            }`}>
                            {sdkStatus.hasMerkleTreeClient ? '✅ Available' : '❌ Not Available'}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">Wallet Provider</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sdkStatus.hasWalletProvider ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'
                            }`}>
                            {sdkStatus.hasWalletProvider ? '✅ Available' : '❌ Not Available'}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">Note Manager</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sdkStatus.hasNoteManager ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'
                            }`}>
                            {sdkStatus.hasNoteManager ? '✅ Available' : '❌ Not Available'}
                        </span>
                    </div>
                </div>

                {sdk && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-md">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">SDK Configuration</h3>
                        <div className="text-xs font-mono text-gray-600">
                            <div>Chain Type: {sdk.config?.chainType || 'Unknown'}</div>
                            <div>RPC URL: {sdk.config?.rpcUrl || 'Not set'}</div>
                            <div>Relayer URL: {sdk.config?.relayerUrl || 'Not set'}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SDKStatus; 