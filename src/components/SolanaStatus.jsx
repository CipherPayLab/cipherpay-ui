import React, { useState, useEffect } from 'react';
import { useCipherPay } from '../contexts/CipherPayContext';
import cipherPayService from '../services/CipherPayService';

function SolanaStatus() {
    const { isInitialized, error, sdk } = useCipherPay();
    const [relayerStatus, setRelayerStatus] = useState('checking');
    const [merkleRoot, setMerkleRoot] = useState(null);
    const [circuits, setCircuits] = useState([]);

    useEffect(() => {
        const checkRelayerStatus = async () => {
            try {
                // Try to use SDK service method first
                if (isInitialized && cipherPayService.sdk?.relayerClient) {
                    try {
                        const status = await cipherPayService.sdk.relayerClient.getStatus();
                        setRelayerStatus(status.status === 'healthy' ? 'healthy' : 'unhealthy');
                        return;
                    } catch (sdkError) {
                        console.log('SDK relayer status failed, trying fallback:', sdkError);
                    }
                }

                // Fallback to direct API call
                const response = await fetch('http://localhost:3000/health');
                const data = await response.json();
                setRelayerStatus(data.status === 'healthy' ? 'healthy' : 'unhealthy');
            } catch (error) {
                console.error('Failed to check relayer status:', error);
                setRelayerStatus('unreachable');
            }
        };

        const fetchMerkleRoot = async () => {
            try {
                // Try to use SDK service method first
                if (isInitialized) {
                    try {
                        const root = await cipherPayService.fetchMerkleRoot();
                        setMerkleRoot(root);
                        return;
                    } catch (sdkError) {
                        console.log('SDK merkle root fetch failed, trying fallback:', sdkError);
                    }
                }

                // Fallback to direct API call
                const response = await fetch('http://localhost:3000/api/v1/merkle/root');
                const data = await response.json();
                if (data.success) {
                    setMerkleRoot(data.root);
                }
            } catch (error) {
                console.error('Failed to fetch merkle root:', error);
            }
        };

        const fetchCircuits = async () => {
            try {
                // Try to use SDK service method first
                if (isInitialized && cipherPayService.sdk?.relayerClient) {
                    try {
                        const circuitsData = await cipherPayService.sdk.relayerClient.getCircuits();
                        setCircuits(circuitsData.circuits || []);
                        return;
                    } catch (sdkError) {
                        console.log('SDK circuits fetch failed, trying fallback:', sdkError);
                    }
                }

                // Fallback to direct API call
                const response = await fetch('http://localhost:3000/api/v1/circuits');
                const data = await response.json();
                if (data.success) {
                    setCircuits(data.circuits);
                }
            } catch (error) {
                console.error('Failed to fetch circuits:', error);
            }
        };

        if (isInitialized) {
            checkRelayerStatus();
            fetchMerkleRoot();
            fetchCircuits();
        }
    }, [isInitialized, sdk]);

    const getStatusColor = (status) => {
        switch (status) {
            case 'healthy':
                return 'text-green-600 bg-green-100';
            case 'unhealthy':
                return 'text-red-600 bg-red-100';
            case 'unreachable':
                return 'text-yellow-600 bg-yellow-100';
            default:
                return 'text-gray-600 bg-gray-100';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'healthy':
                return '✅';
            case 'unhealthy':
                return '❌';
            case 'unreachable':
                return '⚠️';
            default:
                return '⏳';
        }
    };

    return (
        <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Solana Integration Status</h2>

                <div className="space-y-4">
                    {/* Service Status */}
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">CipherPay Service</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isInitialized ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                            {isInitialized ? '✅ Initialized' : '❌ Not Initialized'}
                        </span>
                    </div>

                    {/* Relayer Status */}
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-500">Solana Relayer</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(relayerStatus)}`}>
                            {getStatusIcon(relayerStatus)} {relayerStatus}
                        </span>
                    </div>

                    {/* Merkle Root */}
                    {merkleRoot && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-500">Merkle Root</span>
                            <span className="text-xs font-mono text-gray-600">
                                {merkleRoot.slice(0, 10)}...{merkleRoot.slice(-8)}
                            </span>
                        </div>
                    )}

                    {/* Supported Circuits */}
                    {circuits.length > 0 && (
                        <div>
                            <span className="text-sm font-medium text-gray-500">Supported Circuits</span>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {circuits.map((circuit, index) => (
                                    <span
                                        key={index}
                                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                                    >
                                        {circuit.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-4">
                            <div className="flex">
                                <div className="ml-3">
                                    <h3 className="text-sm font-medium text-red-800">Error</h3>
                                    <div className="mt-2 text-sm text-red-700">
                                        <p>{error}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default SolanaStatus; 