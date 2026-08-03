import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import { wagmiConfig } from './wagmi';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </ErrorBoundary>
);