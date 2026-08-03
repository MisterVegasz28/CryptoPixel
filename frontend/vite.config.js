import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          web3: ['wagmi', '@rainbow-me/rainbowkit'],
          ethers: ['ethers'],
          lucide: ['lucide-react'],
        },
      },
    },
  },

  server: {
    port: 3000,
    open: true,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https://*.walletconnect.com https://*.walletconnect.org; " +
        "frame-src 'self'; " +
        "connect-src 'self' " +
          "https://rkmmnyppiztrwjnftrzx.supabase.co " +
          "wss://rkmmnyppiztrwjnftrzx.supabase.co " +
          "https://*.g.alchemy.com " +
          "wss://*.g.alchemy.com " +
          "https://rpc-amoy.polygon.technology " +
          "https://cryptopixel-production.up.railway.app " +
          "https://explorer-api.walletconnect.com " +
          "https://*.walletconnect.com " +
          "https://*.walletconnect.org " +
          "wss://*.walletconnect.com " +
          "wss://*.walletconnect.org " +
          "https://pulse.walletconnect.org;"
    }
  }
});