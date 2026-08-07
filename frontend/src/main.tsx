import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import { wagmiConfig } from './wagmi';
import '@rainbow-me/rainbowkit/styles.css';

if (typeof window !== 'undefined') {
  const keysToRemove = Object.keys(localStorage).filter(key =>
    key.startsWith('privy:') ||
    key.startsWith('rk-') ||
    key.startsWith('wagmi') ||
    key.startsWith('-walletlink') ||
    key.startsWith('@appkit') ||
    key.startsWith('base-acc-sdk') ||
    key.startsWith('cbwsdk')
  );

  keysToRemove.forEach(key => localStorage.removeItem(key));

  // Utilise le type déjà défini dans vite-env.d.ts
  const provider = window.ethereum;
  if (provider) {
    provider.request({ method: 'eth_accounts' })
      .then((accounts: string[]) => {
        if (!accounts || accounts.length === 0) {
          localStorage.removeItem('wagmi.recentConnectorId');
          localStorage.removeItem('wagmi.store');
        }
      })
      .catch(() => {
        localStorage.removeItem('wagmi.recentConnectorId');
        localStorage.removeItem('wagmi.store');
      });
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      gcTime: 0,
    },
  },
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </ErrorBoundary>
);