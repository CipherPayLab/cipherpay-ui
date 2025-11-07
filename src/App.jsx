import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { WalletProvider } from './providers/WalletProvider';
import { CipherPayProvider } from './contexts/CipherPayContext';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import Transaction from './components/Transaction';
import Proof from './components/Proof';
import Auditor from './components/Auditor';

function App() {
  return (
    <WalletProvider>
      <CipherPayProvider>
        <Router>
          <div className="App">
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/transaction" element={<Transaction />} />
              <Route path="/proof" element={<Proof />} />
              <Route path="/auditor" element={<Auditor />} />
            </Routes>
          </div>
        </Router>
      </CipherPayProvider>
    </WalletProvider>
  );
}

export default App; 