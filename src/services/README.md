# CipherPay Services

This directory contains the service layer for the CipherPay UI.

## Service Files

### `CipherPayService.js` - Production Service
- **Purpose**: Full integration with the real CipherPay SDK
- **Use Case**: Production environments, real blockchain interactions
- **Features**: 
  - Real Solana blockchain integration
  - Actual wallet connections and transactions
  - ZK proof generation and verification
  - Event monitoring and compliance

### `index.js` - Service Export
- **Purpose**: Exports the CipherPay service instance
- **Usage**: Import the service from this directory

## Usage

### In Components
```javascript
import cipherPayService from '../services';

// Initialize and use the service
await cipherPayService.initialize();
```

### Direct Import (Advanced)
```javascript
import { CipherPayService } from '../services';

// Create a specific service instance if needed
const service = new CipherPayService();
```

## Requirements

The CipherPay SDK must be loaded in the application (typically via script tag in `index.html`) for the service to function properly. 