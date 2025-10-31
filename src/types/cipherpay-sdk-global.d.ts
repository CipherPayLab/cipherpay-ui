declare global {
  interface Window {
    CipherPaySDK?: {
      TOKENS: Record<string, unknown>;
      bigintifySignals: (s: Record<string, unknown>) => Record<string, bigint>;
      poseidonHash: (inputs: Array<bigint | number | string>) => Promise<bigint>;
      commitmentOf: (
        input:
          | Array<bigint | number | string>
          | {
              amount: bigint | number | string;
              tokenId: bigint | number | string;
              ownerCipherPayPubKey: bigint | number | string;
              randomness: { r: bigint | number | string; s?: bigint | number | string };
            }
      ) => Promise<bigint>;
    };
  }
}

export {};

