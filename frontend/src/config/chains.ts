import { addRpcUrlOverrideToChain } from '@privy-io/react-auth';
import { polygonAmoy } from 'viem/chains';

const INDEXER_URL = import.meta.env.VITE_INDEXER_URL;

export const polygonAmoyOverride = addRpcUrlOverrideToChain(polygonAmoy, `${INDEXER_URL}/rpc`);