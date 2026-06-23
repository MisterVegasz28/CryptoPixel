import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// Reconstruction fidèle de _publicSupply() du contrat V3
// V3 : virtualSupply = totalSupply + frozenPixels * 1e18  (plus de claimedPixels)
const PREMINE_WEI = BigInt("300000") * BigInt(1e18);

export default function TokenPanel({ account, tokenBalance, readContract, onBuy, onSell, txStatus }) {
  const [buyAmount, setBuyAmount]   = useState('1');
  const [sellAmount, setSellAmount] = useState('1');
  const [buyPrice, setBuyPrice]     = useState(null);
  const [sellPrice, setSellPrice]   = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [activeMode, setActiveMode] = useState('buy');

  const fetchPrices = useCallback(async () => {
    if (!readContract) return;
    setLoadingPrice(true);
    try {
      // V3 : plus de totalClaimedPixels — uniquement totalSupply + frozenPixels
      const [supply, frozen] = await Promise.all([
        readContract.totalSupply(),
        readContract.totalFrozenPixels(),
      ]);

      const frozenWei     = BigInt(frozen.toString()) * BigInt(1e18);
      const virtualSupply = BigInt(supply.toString()) + frozenWei;
      const publicSupply  = virtualSupply > PREMINE_WEI ? virtualSupply - PREMINE_WEI : 0n;
      const publicSupplyTokens = publicSupply / BigInt(1e18);

      const buyAmt  = BigInt(Math.max(1, Math.floor(Number(buyAmount)  || 1)));
      const sellAmt = BigInt(Math.max(1, Math.floor(Number(sellAmount) || 1)));

      const bPrice = await readContract.getPrice(publicSupplyTokens, buyAmt);
      setBuyPrice(ethers.formatEther(bPrice));

      const sBase  = publicSupplyTokens > sellAmt ? publicSupplyTokens - sellAmt : 0n;
      const sPrice = await readContract.getPrice(sBase, sellAmt);
      setSellPrice(ethers.formatEther(sPrice));
    } catch (e) {
      console.error("Error fetching bonding curve price", e);
    } finally {
      setLoadingPrice(false);
    }
  }, [readContract, buyAmount, sellAmount]);

  useEffect(() => { fetchPrices(); }, [readContract]);

  useEffect(() => {
    const t = setTimeout(fetchPrices, 400);
    return () => clearTimeout(t);
  }, [buyAmount, sellAmount]);

  const isBusy  = txStatus === 'pending' || txStatus === 'mining';
  const maxSell = Math.floor(parseFloat(tokenBalance) || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={{ display: 'flex', background: '#12121a', borderRadius: 8, padding: 2 }}>
        {['buy', 'sell'].map(mode => (
          <button
            key={mode}
            onClick={() => setActiveMode(mode)}
            style={{
              flex: 1, padding: '6px 0', border: 'none',
              background: activeMode === mode ? 'rgba(0,212,255,0.1)' : 'transparent',
              color: activeMode === mode ? '#00d4ff' : '#6b7280',
              borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            {mode === 'buy' ? 'BUY Tokens' : 'SELL Tokens'}
          </button>
        ))}
      </div>

      {activeMode === 'buy' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 4 }}>AMOUNT TO BUY</label>
            <input
              type="number" min="1" value={buyAmount}
              onChange={e => setBuyAmount(e.target.value)}
              style={{ width: '100%', background: '#12121a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
          </div>
          <div style={{ padding: 10, background: 'rgba(0,212,255,0.03)', border: '1px solid rgba(0,212,255,0.1)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Estimated Cost:</span>
            <span style={{ color: '#00d4ff', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
              {loadingPrice ? '...' : buyPrice ? `${parseFloat(buyPrice).toFixed(6)} MATIC` : '—'}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              AMOUNT TO SELL
              <span style={{ color: '#4b5563', fontWeight: 400, marginLeft: 8 }}>(max: {maxSell})</span>
            </label>
            <input
              type="number" min="1" max={maxSell} value={sellAmount}
              onChange={e => setSellAmount(e.target.value)}
              style={{ width: '100%', background: '#12121a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
          </div>
          <div style={{ padding: 10, background: 'rgba(168,85,247,0.03)', border: '1px solid rgba(168,85,247,0.1)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Estimated Return:</span>
            <span style={{ color: '#a855f7', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
              {loadingPrice ? '...' : sellPrice ? `${parseFloat(sellPrice).toFixed(6)} MATIC` : '—'}
            </span>
          </div>
          <button
            className="btn-primary"
            onClick={() => onSell(sellAmount)}
            style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', color: '#fff' }}
            disabled={!account || isBusy || parseInt(sellAmount) < 1 || parseInt(sellAmount) > maxSell}
          >
            {isBusy ? 'Processing...' : `Sell ${parseInt(sellAmount) || 0} PAINT`}
          </button>
        </div>
      )}

      <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
        <div style={{ color: '#9ca3af', fontWeight: 600, marginBottom: 4 }}>Token Economics</div>
        <div>• 1 PAINT token = 1 pixel tile claim.</div>
        <div>• Price increases with supply (bonding curve).</div>
        <div>• Sell anytime to recover MATIC from the pool.</div>
      </div>
    </div>
  );
}