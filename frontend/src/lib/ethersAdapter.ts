import type { WalletClient } from 'viem';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

export function walletClientToSigner(walletClient: WalletClient) {
    const { account, chain, transport } = walletClient;
    const network = {
        chainId: chain!.id,
        name: chain!.name,
    };
    const provider = new BrowserProvider(transport, network);
    return new JsonRpcSigner(provider, account!.address);
}