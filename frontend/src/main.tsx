import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import App from './App';
import './index.css';
import { polygonAmoy } from 'viem/chains';
import ErrorBoundary from './components/ErrorBoundary';

export const polygonAmoyOverride = addRpcUrlOverrideToChain(
  polygonAmoy,
  `${import.meta.env.VITE_INDEXER_URL}/rpc`
);

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
        defaultChain: polygonAmoyOverride,
        supportedChains: [polygonAmoyOverride],
      }}
    >
      <App />
    </PrivyProvider>
  </ErrorBoundary>
);