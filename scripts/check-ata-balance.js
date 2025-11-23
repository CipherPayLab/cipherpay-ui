#!/usr/bin/env node
/**
 * Script to check wSOL balance in a wallet's ATA
 * Usage: node check-wsol-balance.js <wallet-address> [rpc-url]
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function checkWSOLBalance(walletAddress, rpcUrl = 'http://127.0.0.1:8899') {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const walletPubkey = new PublicKey(walletAddress);
    
    // Calculate ATA address
    const wsolAta = getAssociatedTokenAddressSync(
      WSOL_MINT,
      walletPubkey,
      false,
      TOKEN_PROGRAM_ID
    );
    
    console.log(`Wallet: ${walletAddress}`);
    console.log(`wSOL ATA: ${wsolAta.toBase58()}`);
    console.log(`RPC: ${rpcUrl}`);
    console.log('');
    
    // Check if ATA exists
    const ataInfo = await connection.getAccountInfo(wsolAta);
    
    if (!ataInfo) {
      console.log('❌ ATA does not exist yet (no wSOL balance)');
      return;
    }
    
    // Get token balance
    try {
      const tokenAccount = await connection.getTokenAccountBalance(wsolAta);
      const balance = Number(tokenAccount.value.amount);
      const decimals = tokenAccount.value.decimals;
      const uiAmount = balance / Math.pow(10, decimals);
      
      console.log(`✅ ATA exists`);
      console.log(`Balance: ${balance} lamports (${uiAmount} wSOL)`);
      console.log(`Decimals: ${decimals}`);
      
      if (balance > 0) {
        console.log(`\n✅ Your ATA has ${uiAmount} wSOL!`);
      } else {
        console.log(`\n⚠️  ATA exists but balance is 0`);
      }
    } catch (error) {
      console.log('⚠️  ATA exists but may not be initialized:', error.message);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get command line arguments
const walletAddress = process.argv[2];
const rpcUrl = process.argv[3] || 'http://127.0.0.1:8899';

if (!walletAddress) {
  console.error('Usage: node check-wsol-balance.js <wallet-address> [rpc-url]');
  console.error('Example: node check-wsol-balance.js FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3');
  process.exit(1);
}

checkWSOLBalance(walletAddress, rpcUrl);

