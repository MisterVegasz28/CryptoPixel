import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import './index.css';
import { polygonAmoy } from 'viem/chains';
import ErrorBoundary from './components/ErrorBoundary';

export const polygonAmoyOverride = addRpcUrlOverrideToChain(
  polygonAmoy,
  `${import.meta.env.VITE_INDEXER_URL}/rpc`
);

// PrivyProvider + App chargés dans le même chunk, en parallèle du reste
// mais sans bloquer le premier paint (index.css + le shell suffisent).
const PrivyRoot = lazy(async () => {
  const [{ PrivyProvider }, { default: App }] = await Promise.all([
    import('@privy-io/react-auth'),
    import('./App'),
  ]);
  return {
    default: () => (
      <PrivyProvider
        appId={import.meta.env.VITE_PRIVY_APP_ID}
        config={{
          loginMethods: ['google', 'email', 'wallet'],
          embeddedWallets: {
            ethereum: { createOnLogin: 'users-without-wallets' },
          },
          defaultChain: polygonAmoyOverride,
          supportedChains: [polygonAmoyOverride],
        }}
      >
        <App />
      </PrivyProvider>
    ),
  };
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <Suspense fallback={
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', color: 'var(--text-muted, #888)',
      }}>
        Loading CryptoPixel...
      </div>
    }>
      <PrivyRoot />
    </Suspense>
  </ErrorBoundary>
);