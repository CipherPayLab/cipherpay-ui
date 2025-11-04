// Service Selection Mechanism
// This file exports the appropriate CipherPay service based on environment variables

import cipherPayService, { CipherPayService } from './CipherPayService.js';
import fallbackCipherPayService, { FallbackCipherPayService } from './FallbackCipherPayService.js';

// Determine which service to use based on environment variables
const getServiceType = () => {
    // Check if we should use the fallback service
    if (import.meta.env.VITE_USE_FALLBACK_SERVICE === 'true') {
        console.log('🔧 Using FallbackCipherPayService (development/fallback mode)');
        return 'fallback';
    }

    // Check if we should use the real SDK
    if (import.meta.env.VITE_USE_REAL_SDK === 'true') {
        console.log('🚀 Using CipherPayService (real SDK mode)');
        return 'real';
    }

    // Default to fallback if no environment variables are set
    console.log('🔧 Using FallbackCipherPayService (default mode)');
    return 'fallback';
};

// Create and export the appropriate service instance
const createService = () => {
    const serviceType = getServiceType();

    switch (serviceType) {
        case 'real':
            return cipherPayService; // use the singleton instance
        case 'fallback':
            return fallbackCipherPayService; // use the singleton instance
        default:
            console.warn('Unknown service type, falling back to FallbackCipherPayService');
            return fallbackCipherPayService;
    }
};

// Export the service instance
const selectedService = createService();

// Also export the service classes for advanced usage
export { CipherPayService, FallbackCipherPayService };
export default selectedService; 