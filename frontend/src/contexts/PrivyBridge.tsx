import { ethers } from 'ethers';
import {
    PrivyProvider,
    usePrivy,
    useWallets,
    useConnectWallet,
    useFundWallet,
} from '@privy-io/react-auth';
import { polygonAmoyOverride } from '../config/chains';
import React, { useEffect, useCallback } from 'react';
import type { Chain } from 'viem';

interface BridgeProps {
    setAccount: (a: string | null) => void;
    setSigner: (s: ethers.Signer | null) => void;
    setAuthenticated: (v: boolean) => void;
    setPrivyReady: (v: boolean) => void;
    onBridgeReady: (fns: {
        connectWallet: () => void;
        login: () => void;
        logout: () => Promise<void>;
        fundWallet: (opts: { address: string; options: { chain: Chain; amount: string } }) => Promise<void>;
    }) => void;
}

function Inner({ setAccount, setSigner, setAuthenticated, setPrivyReady, onBridgeReady }: BridgeProps) {
    const { login, logout, authenticated, ready } = usePrivy();
    const { wallets } = useWallets();
    const { fundWallet } = useFundWallet();

    const { connectWallet } = useConnectWallet({
        onSuccess: async ({ wallet }) => {
            if (!('getEthereumProvider' in wallet)) {
                console.error('Unsupported wallet type');
                return;
            }
            const provider = await wallet.getEthereumProvider();
            const browserProvider = new ethers.BrowserProvider(provider);
            const s = await browserProvider.getSigner();
            setAccount(wallet.address);
            setSigner(s);
        },
        onError: (err: unknown) => console.error('connectWallet error', err),
    });

    useEffect(() => { setAuthenticated(authenticated); }, [authenticated, setAuthenticated]);
    useEffect(() => { setPrivyReady(ready); }, [ready, setPrivyReady]);

    // Auto-connexion du wallet Privy embarqué (login Google) — équivalent de
    // l'ancien effect `connectPrivyWallet` de App.tsx.
    useEffect(() => {
        if (!ready || !authenticated) return;
        const wallet = wallets.find(w => w.walletClientType === 'privy');
        if (!wallet) return;
        (async () => {
            try {
                const provider = await wallet.getEthereumProvider();
                const browserProvider = new ethers.BrowserProvider(provider);
                const s = await browserProvider.getSigner();
                setAccount(wallet.address);
                setSigner(s);
            } catch (err) {
                console.error('Privy connect error', err);
            }
        })();
    }, [ready, authenticated, wallets, setAccount, setSigner]);

    // Écoute des events du wallet externe (MetaMask, etc.) — équivalent de
    // l'ancien effect sur `externalWallet` de App.tsx.
    useEffect(() => {
        const externalWallet = wallets.find(w => w.walletClientType !== 'privy');
        if (!externalWallet) return;
        let eth: Awaited<ReturnType<typeof externalWallet.getEthereumProvider>>;
        let onAccountsChanged: (accounts: string[]) => void;
        (async () => {
            eth = await externalWallet.getEthereumProvider();
            onAccountsChanged = (accounts: string[]) => {
                if (accounts.length > 0) {
                    const browserProvider = new ethers.BrowserProvider(eth);
                    browserProvider.getSigner().then(s => {
                        setAccount(accounts[0]);
                        setSigner(s);
                    });
                } else {
                    setAccount(null);
                    setSigner(null);
                }
            };
            eth.on('accountsChanged', onAccountsChanged);
            eth.on('chainChanged', () => window.location.reload());
        })();
        return () => { eth?.removeListener?.('accountsChanged', onAccountsChanged); };
    }, [wallets, setAccount, setSigner]);

    const doLogout = useCallback(async () => {
        if (authenticated) await logout();
        setAccount(null);
        setSigner(null);
    }, [authenticated, logout, setAccount, setSigner]);
    const wrappedFundWallet = useCallback(
        async (opts: { address: string; options: { chain: Chain; amount: string } }) => {
            await fundWallet(opts);
        },
        [fundWallet]
    );
    useEffect(() => {
        onBridgeReady({ connectWallet, login, logout: doLogout, fundWallet: wrappedFundWallet });
    }, [connectWallet, login, doLogout, fundWallet, onBridgeReady]);

    return null;
}

export default function PrivyBridge(props: BridgeProps) {
    return (
        <PrivyProvider
            appId={import.meta.env.VITE_PRIVY_APP_ID}
            config={{
                loginMethods: ['google'],
                embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
                defaultChain: polygonAmoyOverride,
                supportedChains: [polygonAmoyOverride],
            }}
        >
            <Inner {...props} />
        </PrivyProvider>
    );
}
