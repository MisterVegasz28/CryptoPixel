import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, Contract } from 'ethers';

interface TokenPanelProps {
  account: string | null;
  tokenBalance: string;
  publicSupplyTokens: bigint;
  readContract: Contract | null;
  onBuy: (amount: string) => void;
  onSell: (amount: string) => void;
  txStatus: string | null;
}

function TokenPanel({ account, tokenBalance, publicSupplyTokens, readContract, onBuy, onSell, txStatus }: TokenPanelProps) {
  const [buyAmount, setBuyAmount]       = useState('1');
  const [sellAmount, setSellAmount]     = useState('1');
  const [buyPrice, setBuyPrice]         = useState<string | null>(null);
  const [sellPrice, setSellPrice]       = useState<string | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [activeMode, setActiveMode]     = useState<'buy' | 'sell'>('buy');
  const isInitialAmountRender = useRef(true);

// publicSupplyTokens vient désormais de App.tsx (déjà tenu à jour via
  // refreshChainData/loadPublicStats) — plus besoin de refetch totalSupply()
  // et totalFrozenPixels() ici à chaque frappe. Seul getPrice() (qui dépend
  // du montant tapé) reste un appel RPC réactif.
  const fetchPrices = useCallback(async () => {
    if (!readContract) return;
    setLoadingPrice(true);
    try {
      const buyAmt  = BigInt(Math.max(1, Math.floor(Number(buyAmount)  || 1)));
      const sellAmt = BigInt(Math.max(1, Math.floor(Number(sellAmount) || 1)));

      const bPrice = await readContract.getPrice(publicSupplyTokens, buyAmt);
      setBuyPrice(ethers.formatEther(bPrice));

      const sBase  = publicSupplyTokens > sellAmt ? publicSupplyTokens - sellAmt : 0n;
      const sPrice = await readContract.getPrice(sBase, sellAmt);
      setSellPrice(ethers.formatEther(sPrice));
    } catch (e) {
      console.error('Error fetching bonding curve price', e);
    } finally {
      setLoadingPrice(false);
    }
  }, [readContract, publicSupplyTokens, buyAmount, sellAmount]);

  useEffect(() => { fetchPrices(); }, [readContract]);
  useEffect(() => {
    if (isInitialAmountRender.current) {
      isInitialAmountRender.current = false;
      return;
    }
    const t = setTimeout(fetchPrices, 400);
    return () => clearTimeout(t);
  }, [buyAmount, sellAmount]);

  const isBusy  = txStatus === 'pending' || txStatus === 'mining';
  const maxSell = Math.floor(parseFloat(tokenBalance) || 0);

  /* ── Styles partagés ─────────────────────────────────────────────────── */
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 600,
    display: 'block',
    marginBottom: 4,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Mode switcher ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', background: 'var(--bg-surface-2)', borderRadius: 8, padding: 2 }}>
        {(['buy', 'sell'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setActiveMode(mode)}
            style={{
              flex: 1, padding: '6px 0', border: 'none',
              background: activeMode === mode ? 'var(--color-primary-dim)' : 'transparent',
              color: activeMode === mode ? 'var(--color-primary)' : 'var(--text-muted)',
              borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            {mode === 'buy' ? 'BUY Tokens' : 'SELL Tokens'}
          </button>
        ))}
      </div>

      {/* ── BUY ───────────────────────────────────────────────────────── */}
      {activeMode === 'buy' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>AMOUNT TO BUY</label>
            <input
              type="number" min="1" value={buyAmount}
              onChange={e => setBuyAmount(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{
            padding: 10,
            background: 'var(--color-primary-dim)',
            border: '1px solid var(--border-primary)',
            borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>Estimated Cost:</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
              {loadingPrice ? '...' : buyPrice ? (
                <>
                  {parseFloat(buyPrice).toFixed(6)} POL
                  <br />
                  <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>
                    (max {(parseFloat(buyPrice) * 1.03).toFixed(6)} avec slippage)
                  </span>
                </>
              ) : '—'}
            </span>
          </div>

          <button
            className="btn-primary"
            onClick={() => onBuy(buyAmount)}
            disabled={!account || isBusy || parseInt(buyAmount) < 1}
          >
            {isBusy ? 'Processing...' : `Buy ${parseInt(buyAmount) || 0} PAINT`}
          </button>
        </div>

      ) : (
      /* ── SELL ─────────────────────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>
              AMOUNT TO SELL
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 8 }}>(max: {maxSell})</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number" min="1" max={maxSell} value={sellAmount}
                onChange={e => setSellAmount(e.target.value)}
                style={{ ...inputStyle, width: 'auto', flex: 1 }}
              />
              <button
                onClick={() => setSellAmount(maxSell.toString())}
                style={{
                  padding: '8px 12px',
                  background: 'var(--color-purple-dim)',
                  border: '1px solid var(--color-purple-border)',
                  borderRadius: 6,
                  color: 'var(--color-purple)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                MAX
              </button>
            </div>
          </div>

          <div style={{
            padding: 10,
            background: 'var(--color-purple-dim)',
            border: '1px solid var(--color-purple-border)',
            borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>Estimated Return:</span>
            <span style={{ color: 'var(--color-purple)', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
              {loadingPrice ? '...' : sellPrice ? `${parseFloat(sellPrice).toFixed(6)} POL` : '—'}
            </span>
          </div>

          <button
            className="btn-primary"
            onClick={() => onSell(sellAmount)}
            style={{ background: 'linear-gradient(135deg, var(--color-red), var(--color-red-dark))', color: '#fff' }}
            disabled={!account || isBusy || parseInt(sellAmount) < 1 || parseInt(sellAmount) > maxSell}
          >
            {isBusy ? 'Processing...' : `Sell ${parseInt(sellAmount) || 0} PAINT`}
          </button>
        </div>
      )}

      {/* ── Token economics info ───────────────────────────────────────── */}
      <div style={{
        padding: 12,
        background: 'var(--bg-hover)',
        borderRadius: 8, fontSize: 11,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
      }}>
        <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>Token Economics</div>
        <div>• 1 PAINT token = 1 pixel tile claim.</div>
        <div>• Price increases with supply (bonding curve).</div>
        <div>• Sell anytime to recover POL from the pool.</div>
      </div>
    </div>
  );
}
export default React.memo(TokenPanel);