import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCipherPay } from '../contexts/CipherPayContext';
import SolanaStatus from './SolanaStatus';
import SDKStatus from './SDKStatus';

function Dashboard() {
  const navigate = useNavigate();
  const {
    isInitialized,
    isConnected,
    publicAddress,
    balance,
    spendableNotes,
    allNotes,
    loading,
    error,
    disconnectWallet,
    refreshData,
    createDeposit,
    createTransfer,
    createWithdraw
  } = useCipherPay();

  const [actionLoading, setActionLoading] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawRecipient, setWithdrawRecipient] = useState('');

  useEffect(() => {
    if (!isInitialized) {
      navigate('/');
      return;
    }

    if (!isConnected) {
      navigate('/');
      return;
    }

    // Refresh data when component mounts
    refreshData();
  }, [isInitialized, isConnected, navigate, refreshData]);

  const handleDisconnect = async () => {
    try {
      await disconnectWallet();
      navigate('/');
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const formatAddress = (address) => {
    if (!address) return 'Not connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatBalance = (balance) => {
    // For Solana, 1 SOL = 1,000,000,000 lamports
    return Number(balance) / 1e9; // Convert lamports to SOL
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      alert('Please enter a valid deposit amount');
      return;
    }
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(depositAmount) * 1e9));
      const txHash = await createDeposit(amountInLamports);
      console.log('Deposit successful:', txHash);
      setShowDepositModal(false);
      setDepositAmount('');
      await refreshData();
      alert(`Deposit successful! Transaction: ${txHash?.txHash || txHash || 'pending'}`);
    } catch (err) {
      console.error('Failed to deposit:', err);
      alert(`Deposit failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      alert('Please enter a valid transfer amount');
      return;
    }
    if (!transferRecipient || transferRecipient.trim() === '') {
      alert('Please enter a recipient address');
      return;
    }
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(transferAmount) * 1e9));
      const transaction = await createTransfer(transferRecipient.trim(), amountInLamports);
      console.log('Transfer successful:', transaction);
      setShowTransferModal(false);
      setTransferAmount('');
      setTransferRecipient('');
      await refreshData();
      const txHash = transaction?.id || transaction?.txHash || 'pending';
      alert(`Transfer successful! Transaction: ${txHash}`);
    } catch (err) {
      console.error('Failed to transfer:', err);
      alert(`Transfer failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      alert('Please enter a valid withdraw amount');
      return;
    }
    if (!withdrawRecipient || withdrawRecipient.trim() === '') {
      alert('Please enter a recipient address');
      return;
    }
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(withdrawAmount) * 1e9));
      const result = await createWithdraw(amountInLamports, withdrawRecipient.trim());
      console.log('Withdraw successful:', result);
      setShowWithdrawModal(false);
      setWithdrawAmount('');
      setWithdrawRecipient('');
      await refreshData();
      alert(`Withdraw successful! Transaction: ${result.txHash || 'pending'}`);
    } catch (err) {
      console.error('Failed to withdraw:', err);
      alert(`Withdraw failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Loading Dashboard...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">CipherPay Solana Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                Connected: {formatAddress(publicAddress)}
              </span>
              <button
                onClick={handleDisconnect}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
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

        {/* Account Overview */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Account Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Shielded Balance</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {formatBalance(balance)} SOL
                </dd>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Spendable Notes</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {spendableNotes.length}
                </dd>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Total Notes</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {allNotes.length}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Deposit */}
              <button
                onClick={() => setShowDepositModal(true)}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-green-50 text-green-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Deposit</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Deposit funds into your shielded account
                  </p>
                </div>
              </button>

              {/* Transfer */}
              <button
                onClick={() => setShowTransferModal(true)}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-blue-50 text-blue-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Transfer</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Transfer funds to another shielded account
                  </p>
                </div>
              </button>

              {/* Withdraw */}
              <button
                onClick={() => setShowWithdrawModal(true)}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-red-50 text-red-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Withdraw</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Withdraw funds from your shielded account
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Solana Integration Status */}
        <div className="mb-6">
          <SolanaStatus />
        </div>

        {/* SDK Status */}
        <div className="mb-6">
          <SDKStatus />
        </div>

        {/* Recent Activity */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h2>
            {allNotes.length === 0 ? (
              <p className="text-gray-500">No recent activity. Start by creating a transaction!</p>
            ) : (
              <div className="space-y-4">
                {allNotes.slice(0, 5).map((note, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Note {note.commitment?.slice(0, 8)}...
                      </p>
                      <p className="text-sm text-gray-500">
                        Amount: {Number(note.amount) / 1e9} SOL
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${note.spent ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                      }`}>
                      {note.spent ? 'Spent' : 'Available'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Deposit Modal */}
        {showDepositModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowDepositModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Deposit Funds</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0.0"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowDepositModal(false);
                      setDepositAmount('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeposit}
                    disabled={actionLoading || !depositAmount}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Deposit'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowTransferModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Transfer Funds</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    value={transferRecipient}
                    onChange={(e) => setTransferRecipient(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0x..."
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0.0"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowTransferModal(false);
                      setTransferAmount('');
                      setTransferRecipient('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTransfer}
                    disabled={actionLoading || !transferAmount || !transferRecipient}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Transfer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Withdraw Modal */}
        {showWithdrawModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowWithdrawModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Withdraw Funds</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    value={withdrawRecipient}
                    onChange={(e) => setWithdrawRecipient(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0x..."
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0.0"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowWithdrawModal(false);
                      setWithdrawAmount('');
                      setWithdrawRecipient('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={actionLoading || !withdrawAmount || !withdrawRecipient}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Withdraw'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard; 