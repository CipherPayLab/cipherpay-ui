// SDK Loader - Handles dynamic loading of CipherPay SDK
let CipherPaySDK = null;
let ChainType = null;
let sdkInitialized = false;
let sdkInitPromise = null;

export async function loadSDK() {
    if (sdkInitPromise) return sdkInitPromise;

    sdkInitPromise = (async () => {
        // Check if we're in a browser environment and if the SDK should be used
        console.log('🔍 SDK Loader: Checking environment...');
        console.log('VITE_USE_REAL_SDK:', import.meta.env.VITE_USE_REAL_SDK);

        if (import.meta.env.VITE_USE_REAL_SDK !== 'true') {
            console.log('❌ Real SDK disabled, using mock components');
            sdkInitialized = false;
            ChainType = { ethereum: 'ethereum', solana: 'solana' };
            return { CipherPaySDK: null, ChainType, sdkInitialized };
        }

        console.log('🚀 Attempting to load CipherPay SDK...');
        console.log('🔍 Checking global scope for SDK...');

        // Log available global objects for debugging
        const globalObjects = Object.keys(window).filter(key =>
            key.toLowerCase().includes('cipher') ||
            key.toLowerCase().includes('sdk') ||
            key.toLowerCase().includes('pay')
        );
        console.log('Available global objects:', globalObjects);

        // Try to load SDK from global scope
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
            attempts++;

            // Check if SDK is available in global scope
            if (typeof window.CipherPaySDK !== 'undefined') {
                console.log('✅ CipherPay SDK found in global scope!');
                CipherPaySDK = window.CipherPaySDK;
                ChainType = { ethereum: 'ethereum', solana: 'solana' };
                sdkInitialized = true;

                // Test creating an instance
                try {
                    const testInstance = new CipherPaySDK({
                        chainType: 'solana',
                        rpcUrl: 'http://localhost:8899'
                    });
                    console.log('✅ SDK instance created successfully');
                    return { CipherPaySDK, ChainType, sdkInitialized };
                } catch (error) {
                    console.error('❌ Failed to create SDK instance:', error);
                    sdkInitialized = false;
                    return { CipherPaySDK: null, ChainType, sdkInitialized };
                }
            }

            console.log(`⏳ SDK not found yet, attempt ${attempts}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('❌ CipherPay SDK not found in global scope after all attempts');
        console.log('🔄 Falling back to mock components');
        sdkInitialized = false;
        ChainType = { ethereum: 'ethereum', solana: 'solana' };
        return { CipherPaySDK: null, ChainType, sdkInitialized };
    })();

    return sdkInitPromise;
}

export function getSDKStatus() {
    return {
        sdkInitialized,
        hasSDK: CipherPaySDK !== null,
        hasChainType: ChainType !== null
    };
} 