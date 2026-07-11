import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './index.css';
import { polygonAmoy } from 'viem/chains';
import ErrorBoundary from './components/ErrorBoundary';

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['google'],
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        defaultChain: polygonAmoy,
        supportedChains: [polygonAmoy],
      }}
    >
      <App />
    </PrivyProvider>
  </ErrorBoundary>
);