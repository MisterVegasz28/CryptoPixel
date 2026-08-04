import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { polygon, polygonAmoy } from 'wagmi/chains';

// Volontairement AUCUN wallet de marque listé ici (ni metaMaskWallet, ni
// rabbyWallet, ni coinbaseWallet...) : plusieurs connecteurs nommés de
// RainbowKit acceptent un `projectId` en option et peuvent s'en servir
// pour leur fallback mobile — donc pas de garantie "zéro dépendance
// Reown" avec eux, malgré ce qu'on a cru un peu vite plus tôt.
//
// injectedWallet est le seul connecteur gardé ici : sa signature ne
// prend qu'un `chains`, pas de projectId, donc aucune dépendance Reown
// possible même en fallback.
//
// Tout le reste (MetaMask, Rabby, Coinbase Wallet, OKX, etc., peu importe
// lequel l'utilisateur a réellement installé) est détecté automatiquement
// par multiInjectedProviderDiscovery via EIP-6963, avec le bon nom et la
// bonne icône, sans collision entre extensions et sans avoir à nommer
// quoi que ce soit ici.
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