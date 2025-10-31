// Prefer the global browser bundle injected via public/index.html
// Falls back to ESM import if available in the build toolchain.

type SDKShape = {
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

let cached: SDKShape | null = null;

export async function getSDK(): Promise<SDKShape> {
  if (cached) return cached;
  if (typeof window !== "undefined" && window.CipherPaySDK) {
    cached = window.CipherPaySDK as unknown as SDKShape;
    return cached;
  }
  try {
    // Optional fallback when bundler supports ESM import of the SDK
    const mod = (await import("cipherpay-sdk")) as unknown as SDKShape;
    cached = mod;
    return cached;
  } catch (e) {
    throw new Error(
      "CipherPaySDK not available. Ensure postinstall copied browser bundle to public/sdk and index.html includes it."
    );
  }
}

export async function poseidonHash(inputs: Array<bigint | number | string>) {
  return (await getSDK()).poseidonHash(inputs);
}

export async function commitmentOf(
  input:
    | Array<bigint | number | string>
    | { amount: bigint | number | string; tokenId: bigint | number | string; ownerCipherPayPubKey: bigint | number | string; randomness: { r: bigint | number | string; s?: bigint | number | string } }
) {
  return (await getSDK()).commitmentOf(input);
}

export async function bigintifySignals(s: Record<string, unknown>) {
  return (await getSDK()).bigintifySignals(s);
}

export async function TOKENS() {
  return (await getSDK()).TOKENS;
}


