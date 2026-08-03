import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { polygon, polygonAmoy } from 'wagmi/chains';
import { http } from 'wagmi';

export const wagmiConfig = getDefaultConfig({
    appName: 'CryptoPixel',
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
    chains: [polygonAmoy, polygon],
    transports: {
        [polygonAmoy.id]: http(`${import.meta.env.VITE_INDEXER_URL}/rpc`),
        [polygon.id]: http(),
    },
    ssr: false,
});