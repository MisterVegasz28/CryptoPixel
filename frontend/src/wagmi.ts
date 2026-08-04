import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { polygon, polygonAmoy } from 'wagmi/chains';

// IMPORTANT : les connecteurs "nommés" de RainbowKit (metaMaskWallet,
// coinbaseWallet, rainbowWallet, etc.) initient réellement des connexions
// réseau vers des relais externes (WalletConnect/Reown pour la plupart,
// WalletLink pour coinbaseWallet) même quand on clique dessus pour se
// connecter à l'extension déjà installée. Confirmé en prod par deux
// erreurs concrètes :
//   - CSP bloquant wss://www.walletlink.org/rpc (coinbaseWallet)
//   - WalletConnect relay "Project not found" (projectId factice rejeté)
//
// Seul injectedWallet ne fait AUCUN appel réseau externe : il communique
// uniquement avec le provider EIP-1193 déjà présent dans le navigateur.
// Combiné à multiInjectedProviderDiscovery (EIP-6963), RainbowKit détecte
// et affiche automatiquement chaque wallet réellement installé (MetaMask,
// Rabby, Coinbase Wallet, etc.) avec son propre nom/icône, sans jamais
// contacter de serveur tiers.
const connectors = connectorsForWallets(
    [
        {
            groupName: 'Recommended',
            wallets: [injectedWallet],
        },
    ],
    {
        appName: 'CryptoPixel',
        projectId: 'not-used-no-walletconnect',
    }
);

export const wagmiConfig = createConfig({
    connectors,
    chains: [polygonAmoy, polygon],
    transports: {
        [polygonAmoy.id]: http(`${import.meta.env.VITE_INDEXER_URL}/rpc`),
        [polygon.id]: http(),
    },
    ssr: false,
    multiInjectedProviderDiscovery: true,
});