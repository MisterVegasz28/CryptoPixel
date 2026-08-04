import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, coinbaseWallet, injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { polygon, polygonAmoy } from 'wagmi/chains';

// Plus de dépendance à Reown/WalletConnect : uniquement les wallets
// injectés dans le navigateur (extension) ou natifs mobile via leur
// propre deep-link. Zéro appel réseau vers l'infra Reown, donc zéro
// risque de blocage lié aux quotas MAU/RPC de leur plan gratuit.
const connectors = connectorsForWallets(
    [
        {
            groupName: 'Recommended',
            wallets: [metaMaskWallet, coinbaseWallet, injectedWallet],
        },
    ],
    {
        appName: 'CryptoPixel',
        // RainbowKit exige une string non vide même si aucun wallet ici
        // n'utilise réellement WalletConnect/le project ID.
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
});