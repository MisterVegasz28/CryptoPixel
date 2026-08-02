import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import { polygonAmoyOverride } from '../main';



interface WalletFundingProps {
    account: string | null;
}

function WalletFunding({ account }: WalletFundingProps) {
    const { fundWallet } = useFundWallet();
    const { ready } = usePrivy();
    const [funding, setFunding] = useState(false);

    const handleFund = async () => {
        if (!account) return;
        setFunding(true);
        try {
            await fundWallet({
                address: account,
                options: { chain: polygonAmoyOverride, amount: '1' },
            });
        } catch (e) {
            console.error('Funding error', e);
        } finally {
            setFunding(false);
        }
    };

    if (!account) return null;

    return (
        <button
            onClick={handleFund}
            disabled={funding || !ready}
            title="Add POL to your wallet"
            style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                borderRadius: 20, padding: '8px 14px',
                fontSize: 13, fontWeight: 600, cursor: funding ? 'wait' : 'pointer',
            }}
        >
            {funding ? 'Opening...' : <><Wallet size={14} /> Add funds</>}
        </button>
    );
}

export default React.memo(WalletFunding);