// src/components/CreateAtaButton.tsx
//
// A tiny button that uses the useAta hook to ensure the user's ATA exists.
// Displays simple loading/error states. Plug it into any mint-specific screen.

import React from "react";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAta } from "../hooks/useAta";

type Props = {
  mint: PublicKey;
  isToken2022?: boolean;
  className?: string;
  label?: string;
  onReady?: (ata: PublicKey) => void; // fires when ATA confirmed/exists
};

export const CreateAtaButton: React.FC<Props> = ({
  mint,
  isToken2022,
  className,
  label = "Create Token Account",
  onReady,
}) => {
  const wallet = useWallet();
  const { ata, creating, error, ensure } = useAta(mint, { isToken2022 });

  const onClick = async () => {
    const res = await ensure();
    onReady?.(res);
  };

  if (!wallet.connected) {
    return (
      <button disabled className={className}>
        Connect wallet first
      </button>
    );
  }

  if (ata && !error) {
    return (
      <button disabled className={className}>
        Token account ready
      </button>
    );
  }

  return (
    <div className={className}>
      <button onClick={onClick} disabled={creating}>
        {creating ? "Creating..." : label}
      </button>
      {error && (
        <p style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Error: {error}
        </p>
      )}
    </div>
  );
};
