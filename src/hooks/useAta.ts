// src/hooks/useAta.ts
//
// A lightweight React hook for cipherpay-ui that:
//  - derives & ensures a user's ATA via cipherpay-sdk
//  - sends the "create ATA" tx through the connected wallet (Phantom, etc.)
//  - returns status + the derived ATA
//
// Assumes your app is wrapped with WalletAdapter + Connection context.
//   import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
//
// SDK imports: adjust the import path to however you expose the utils from cipherpay-sdk.
// If you publish the SDK as '@cipherpay/sdk', prefer the first import line. If not yet,
// use a relative path to your monorepo workspace (second line).

import { useCallback, useMemo, useState } from "react";
import type { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { Transaction as Web3Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

// Preferred if SDK is published:
import {
  ensureAta,
  pickProgramsForMint,
  DEFAULT_PROGRAM_IDS,
  DEFAULT_PROGRAM_IDS_2022,
  type ProgramIds,
} from "@cipherpay/sdk/utils/ata";

// If using a local workspace before publishing, comment the line above and use:
// import {
//   ensureAta,
//   pickProgramsForMint,
//   DEFAULT_PROGRAM_IDS,
//   DEFAULT_PROGRAM_IDS_2022,
//   type ProgramIds,
// } from "../../cipherpay-sdk/src/utils/ata";

export type UseAtaOptions = {
  /** If true, use Token-2022 program IDs for this mint; otherwise legacy SPL-Token. */
  isToken2022?: boolean;
  /** Override program IDs explicitly if you need non-defaults. */
  programIds?: ProgramIds;
  /** Commitment level used when confirming the transaction. */
  commitment?: "processed" | "confirmed" | "finalized";
};

export type UseAtaState = {
  ata: PublicKey | null;
  creating: boolean;
  error: string | null;
};

export type UseAtaResult = UseAtaState & {
  /** Ensures ATA exists; if missing, sends a tx via the connected wallet to create it. */
  ensure: () => Promise<PublicKey>;
};

/**
 * useAta
 * Derive & (optionally) create the canonical ATA for (owner = connected wallet, mint).
 * Returns the derived ATA and a function to ensure it exists on-chain.
 */
export function useAta(mint: PublicKey | null, opts: UseAtaOptions = {}): UseAtaResult {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [ata, setAta] = useState<PublicKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pids: ProgramIds = useMemo(() => {
    if (opts.programIds) return opts.programIds;
    if (opts.isToken2022) return DEFAULT_PROGRAM_IDS_2022;
    return DEFAULT_PROGRAM_IDS;
  }, [opts.programIds, opts.isToken2022]);

  const ensure = useCallback(async (): Promise<PublicKey> => {
    setError(null);

    if (!connection) throw new Error("No Solana connection available.");
    if (!wallet.publicKey) throw new Error("Wallet not connected.");
    if (!mint) throw new Error("Mint public key is null.");

    // 1) Ask SDK to derive ATA and tell us if it's missing (ix != null).
    const { ata: derivedAta, ix } = await ensureAta(
      connection as Connection,
      wallet.publicKey,
      mint,
      wallet.publicKey,
      pids
    );

    setAta(derivedAta);

    // Already exists — nothing to send.
    if (!ix) return derivedAta;

    // 2) Build the one-instruction "create ATA" transaction and send via wallet.
    setCreating(true);
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

      const tx = new Web3Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = blockhash;

      // wallet-adapter will handle signing and sending
      const sig = await wallet.sendTransaction(tx as unknown as Transaction, connection);

      // Optional confirm (recommended for UX)
      const commitment = opts.commitment ?? "confirmed";
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        commitment
      );

      return derivedAta;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      throw e;
    } finally {
      setCreating(false);
    }
  }, [connection, wallet, mint, pids, opts.commitment]);

  return { ata, creating, error, ensure };
}
