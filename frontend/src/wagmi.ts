import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
    metaMaskWallet,
    rabbyWallet,
    coinbaseWallet,
    rainbowWallet,
    okxWallet,
    trustWallet,
    braveWallet,
    zerionWallet,
    injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { polygon, polygonAmoy } from 'wagmi/chains';

// Chaque connecteur nommé ci-dessous cible son wallet via EIP-6963 (rdns
// précis), donc aucune collision possible entre eux même si plusieurs
// sont installés en même temps dans le même navigateur — c'est justement
// ce qui règle le conflit MetaMask/Rabby observé.
//
// injectedWallet en dernier sert de filet pour tout wallet EIP-6963 non
// listé ici explicitement (il cible le provider restant si un seul
// autre est présent). Cette liste couvre la grande majorité des wallets
// réellement utilisés ; c'est le même principe que getDefaultConfig de
// RainbowKit, en excluant simplement WalletConnect/Coinbase-cloud pour
// éviter toute dépendance à Reown.
const connectors = connectorsForWallets(
    [
        {
            groupName: 'Popular',
            wallets: [
                metaMaskWallet,
                rabbyWallet,
                coinbaseWallet,
                rainbowWallet,
            ],
        },
        {
            groupName: 'More',
            wallets: [
                okxWallet,
                trustWallet,
                braveWallet,
                zerionWallet,
                injectedWallet, // fallback générique EIP-6963 pour le reste
            ],
        },
    ],
    {
        appName: 'CryptoPixel',
        // Requis par la signature de certains connecteurs (ex: coinbaseWallet
        // utilise parfois un projectId pour son propre SDK), mais aucun ici
        // ne dépend de l'infra Reown/WalletConnect pour fonctionner.
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