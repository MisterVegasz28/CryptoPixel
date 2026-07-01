import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
        "connect-src 'self' " +
          "https://rkmmnyppiztrwjnftrzx.supabase.co " +
          "wss://rkmmnyppiztrwjnftrzx.supabase.co " +
          "https://rpc-amoy.polygon.technology " +
          "https://cryptopixel-production.up.railway.app;"
    }
  }
});