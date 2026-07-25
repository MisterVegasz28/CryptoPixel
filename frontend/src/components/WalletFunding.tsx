import React, { useState } from 'react';
import { useFundWallet } from '@privy-io/react-auth';
import { Wallet, Copy, Check, ExternalLink } from 'lucide-react';
import { polygonAmoyOverride } from '../main'; // adapte le chemin si besoin

interface WalletFundingProps {
    account: string | null;
}

function WalletFunding({ account }: WalletFundingProps) {
    const { fundWallet } = useFundWallet();
    const [copied, setCopied] = useState(false);
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

    const handleCopy = async () => {
        if (!account) return;
        await navigator.clipboard.writeText(account);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!account) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
            }}>
                <Wallet size={14} /> Add POL to your wallet
            </div>

            {/* Bouton principal : ouvre le modal Privy (carte / exchange / wallet externe) */}
            <button
                onClick={handleFund}
                disabled={funding}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
                {funding ? 'Opening...' : <><ExternalLink size={14} /> Add funds</>}
            </button>

            {/* Fallback manuel : afficher/copier l'adresse pour un transfert direct */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-default)', borderRadius: 8,
            }}>
                <span style={{
                    fontSize: 11, fontFamily: "'Space Mono', monospace",
                    color: 'var(--text-secondary)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180,
                }}>
                    {account}
                </span>
                <button
                    onClick={handleCopy}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copied ? 'var(--color-green)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center',
                    }}
                    title="Copy address"
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
            </div>

            {/* Lien faucet — utile tant que tu es sur testnet, à retirer au passage mainnet */}
            <a
                href="https://faucet.polygon.technology/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    fontSize: 10, color: 'var(--text-faint)', textAlign: 'center',
                    textDecoration: 'underline',
                }}
            >
                Need testnet POL? Use the official faucet
            </a>
        </div >
    );
}

export default React.memo(WalletFunding);