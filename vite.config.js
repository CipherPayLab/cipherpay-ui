import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Plugin to handle CommonJS modules that don't have default exports
const commonjsPlugin = () => ({
  name: 'commonjs-default-export',
  transform(code, id) {
    // Transform CommonJS module.exports to ES module default export for blake2b
    if (id.includes('blake2b') && code.includes('module.exports') && !code.includes('export default')) {
      // Add export default for CommonJS modules
      const transformed = code + '\nexport default module.exports;';
      return { code: transformed, map: null };
    }
    return null;
  },
});

export default defineConfig({
  plugins: [
    react({
      // Process both .js and .jsx files as JSX
      // Also handle TypeScript files
      include: /\.(jsx|js|tsx|ts)$/,
      jsxRuntime: 'automatic',
      fastRefresh: true,
      // Use Babel to process JSX in .js files during import analysis
      // This ensures .js files with JSX are transformed before Vite tries to parse them
      babel: {
        parserOpts: {
          plugins: ['jsx']
        }
      }
    }),
    commonjsPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      buffer: 'buffer',
      assert: 'assert',
      events: 'events',
      util: 'util',
      stream: 'stream-browserify',
    },
    extensions: ['.ts', '.tsx', '.jsx', '.js', '.json'],
    // Handle CommonJS modules better
    mainFields: ['browser', 'module', 'main'],
  },
  define: {
    'global': 'globalThis',
    'process.env': 'import.meta.env',
    'globalThis.Buffer': 'Buffer',
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx', // Critical: Tell esbuild to treat .js files as JSX
        '.jsx': 'jsx', // Ensure JSX files are handled
        '.ts': 'ts', // Ensure TypeScript files are handled
        '.tsx': 'tsx', // Ensure TSX files are handled
      },
      // Ensure JSX is parsed during dependency optimization
      jsx: 'automatic',
      // Handle CommonJS modules
      format: 'esm',
    },
    exclude: ['cipherpay-sdk'], // SDK is loaded via browser bundle
    include: ['buffer', 'assert', 'events', 'util', 'stream-browserify', 'blake2b', 'circomlibjs'],
    force: true, // Force re-optimization to handle blake2b
  },
  ssr: {
    noExternal: [], // Don't externalize anything for SSR
    external: ['cipherpay-sdk'], // Mark SDK as external for SSR
  },
  // Vite automatically handles TypeScript via esbuild
  // TypeScript files (.ts, .tsx) are automatically transpiled
  build: {
    // Increase chunk size warning limit to 3000kb (3MB) 
    // circomlibjs is legitimately large (~2.5MB) and is loaded dynamically
    chunkSizeWarningLimit: 3000,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      // Handle CommonJS modules that don't have default exports
      defaultIsModuleExports: true,
      esmExternals: true,
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Only process node_modules
          if (!id.includes('node_modules')) {
            return;
          }
          
          // Split React Router first (more specific, must check before 'react')
          if (id.includes('react-router')) {
            return 'react-router';
          }
          
          // Split Solana wallet adapters into their own chunk
          if (id.includes('@solana/wallet-adapter')) {
            return 'solana-wallet';
          }
          
          // Split Solana web3.js into its own chunk
          if (id.includes('@solana/web3.js') || id.includes('@solana/spl-token')) {
            return 'solana-web3';
          }
          
          // Split React and React DOM into their own chunk (check after react-router)
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || 
              id.endsWith('/react') || id.endsWith('/react-dom') || id.endsWith('/scheduler')) {
            return 'react-vendor';
          }
          
          // Split wallet connect and related packages (check before other crypto)
          if (id.includes('@walletconnect') || id.includes('@reown/appkit') || id.includes('@reown/appkit-controllers')) {
            return 'wallet-connect';
          }
          
          // Split circomlibjs into its own chunk (it's very large ~2.5MB)
          if (id.includes('circomlibjs')) {
            return 'circomlibjs';
          }
          
          // Split other crypto-related libraries
          if (id.includes('@toruslabs/eccrypto') || id.includes('snarkjs')) {
            return 'crypto-libs';
          }
          
          // Split large UI libraries
          if (id.includes('@solana/wallet-adapter-react-ui') || id.includes('tailwindcss')) {
            return 'ui-libs';
          }
          
          // Split utility libraries
          if (id.includes('axios') || id.includes('buffer') || id.includes('assert') || id.includes('events') || id.includes('util') || id.includes('stream')) {
            return 'utils';
          }
          
          // Everything else from node_modules goes to vendor
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  publicDir: 'public',
});
