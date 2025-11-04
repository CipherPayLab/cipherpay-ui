# Vite Migration Plan - Step by Step

## Overview
Migrating from Create React App (react-scripts) to Vite for:
- ⚡ Faster development server
- 🚀 Faster builds
- ✅ Eliminate deprecation warnings
- 🔒 Fix security vulnerabilities
- 📦 Smaller dependency tree

## Migration Steps

### Step 1: Backup Current Setup
```bash
# Create a backup branch
git checkout -b backup-before-vite-migration
git add .
git commit -m "Backup before Vite migration"
```

### Step 2: Update package.json
- Remove: `react-scripts`, `@craco/craco`, `react-app-rewired`, `webpack`
- Add: `vite`, `@vitejs/plugin-react`
- Update scripts

### Step 3: Create vite.config.js
- Convert `craco.config.js` webpack config to Vite config
- Add polyfills (Buffer, process)
- Configure path aliases
- Set up SDK bundle handling

### Step 4: Move index.html
- Move `public/index.html` → `index.html` (root)
- Update script tag to `<script type="module" src="/src/main.jsx">`
- Keep polyfill scripts

### Step 5: Create main entry point
- Create `src/main.jsx` (Vite entry point)
- Update imports if needed

### Step 6: Update Environment Variables
- Change `REACT_APP_*` → `VITE_*` in all files
- Update `.env` files if they exist
- Update service files

### Step 7: Remove CRA-specific files
- Delete `craco.config.js`
- Remove `public/index.html` (moved to root)
- Update `.gitignore` if needed

### Step 8: Update build scripts
- Update `postinstall` script if needed
- Test `npm run dev` and `npm run build`

## Files to Modify

### Configuration Files:
- `package.json` - Dependencies and scripts
- `vite.config.js` - New Vite configuration
- `index.html` - Move to root, update script tag
- `src/main.jsx` - New entry point

### Source Files with Environment Variables:
- `src/services/authService.js`
- `src/services/index.js`
- `src/services/FallbackCipherPayService.js`
- `src/services/CipherPayService.js`
- `src/services/sdkLoader.js`

## Testing Checklist
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts dev server
- [ ] App loads in browser
- [ ] Environment variables work (VITE_*)
- [ ] SDK bundle loads correctly
- [ ] Authentication flow works
- [ ] Wallet connection works
- [ ] `npm run build` produces working build
- [ ] Production build runs correctly


