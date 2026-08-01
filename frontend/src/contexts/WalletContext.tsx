import React, { createContext, useContext, useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import { ethers } from 'ethers';
import type { Chain } from 'viem';

const PrivyBridge = lazy(() => import('./PrivyBridge'));

interface WalletActions {
    connectWallet: () => void;
    login: () => void;
    logout: () => Promise<void>;
    fundWallet: (opts: { address: string; options: { chain: Chain; amount: string } }) => Promise<void>;
}

const noopActions: WalletActions = {
    connectWallet: () => console.warn('[wallet] connector still loading, try again in a moment'),
    login: () => console.warn('[wallet] connector still loading, try again in a moment'),
    logout: async () => { },
    fundWallet: async () => console.warn('[wallet] connector still loading'),
};

interface WalletContextValue {
    account: string | null;
    setAccount: (a: string | null) => void;
    signer: ethers.Signer | null;
    setSigner: (s: ethers.Signer | null) => void;
    authenticated: boolean;
    privyReady: boolean;
    bridgeLoaded: boolean;
    connectWallet: () => void;
    login: () => void;
    logout: () => Promise<void>;
    fundWallet: WalletActions['fundWallet'];
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within WalletProvider');
    return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [account, setAccount] = useState<string | null>(null);
    const [signer, setSigner] = useState<ethers.Signer | null>(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [privyReady, setPrivyReady] = useState(false);
    const [bridgeLoaded, setBridgeLoaded] = useState(false);
    const [actions, setActions] = useState<WalletActions>(noopActions);

    // Si l'utilisateur clique "Connect" avant que le chunk Privy soit chargé,
    // on mémorise l'intention et on la rejoue dès que le bridge est prêt —
    // au lieu de perdre le clic silencieusement.
    const pendingIntentRef = useRef<'connect' | 'login' | null>(null);
    useEffect(() => {
        if (!bridgeLoaded || !pendingIntentRef.current) return;
        const intent = pendingIntentRef.current;
        pendingIntentRef.current = null;
        if (intent === 'connect') actions.connectWallet();
        if (intent === 'login') actions.login();
    }, [bridgeLoaded, actions]);

    const connectWallet = useCallback(() => {
        if (!bridgeLoaded) { pendingIntentRef.current = 'connect'; return; }
        actions.connectWallet();
    }, [bridgeLoaded, actions]);

    const login = useCallback(() => {
        if (!bridgeLoaded) { pendingIntentRef.current = 'login'; return; }
        actions.login();
    }, [bridgeLoaded, actions]);

    const logout = useCallback(async () => {
        if (!bridgeLoaded) return;
        await actions.logout();
    }, [bridgeLoaded, actions]);

    const fundWallet = useCallback<WalletActions['fundWallet']>(async (opts) => {
        if (!bridgeLoaded) return;
        await actions.fundWallet(opts);
    }, [bridgeLoaded, actions]);

    const value: WalletContextValue = {
        account, setAccount, signer, setSigner,
        authenticated, privyReady, bridgeLoaded,
        connectWallet, login, logout, fundWallet,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
            {/* Non-bloquant : fallback=null, ne retarde jamais le rendu de {children} */}
            <Suspense fallback={null}>
                <PrivyBridge
                    setAccount={setAccount}
                    setSigner={setSigner}
                    setAuthenticated={setAuthenticated}
                    setPrivyReady={setPrivyReady}
                    onBridgeReady={(fns: WalletActions) => { setActions(fns); setBridgeLoaded(true); }}
                />
            </Suspense>
        </WalletContext.Provider>
    );
}
