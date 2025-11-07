import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
    })
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
    },
    exclude: ['cipherpay-sdk'], // SDK is loaded via browser bundle
    include: ['buffer', 'assert', 'events', 'util', 'stream-browserify', 'circomlibjs'],
    // Force pre-bundling of circomlibjs with Buffer available
    force: false, // Set to true to force re-optimization
  },
  ssr: {
    noExternal: [], // Don't externalize anything for SSR
    external: ['cipherpay-sdk'], // Mark SDK as external for SSR
  },
  // Vite automatically handles TypeScript via esbuild
  // TypeScript files (.ts, .tsx) are automatically transpiled
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  publicDir: 'public',
});
