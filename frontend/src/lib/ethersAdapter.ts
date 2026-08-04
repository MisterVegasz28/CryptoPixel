import type { WalletClient } from 'viem';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

export function walletClientToSigner(walletClient: WalletClient) {
    const { account, transport } = walletClient;
    const provider = new BrowserProvider(transport, "any");
    return new JsonRpcSigner(provider, account!.address);
}