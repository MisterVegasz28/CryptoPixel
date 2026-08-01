import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { WalletProvider } from './contexts/WalletContext';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <WalletProvider>
      <App />
    </WalletProvider>
  </ErrorBoundary>
);

