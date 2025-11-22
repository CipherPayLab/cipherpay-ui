# node 20
```bash
nvm use 20
```

# install
```bash
npm install
```

# Build
```bash
npm run build
```

# Run
```bash
npm run dev
```

# Add some SOL to wallet
solana airdrop 20 FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3 --url http://127.0.0.1:8899

# Check balance of a wallet
solana balance FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3 --url http://127.0.0.1:8899

# Check balance of ATA
node scripts/check-ata-balance.js FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3
