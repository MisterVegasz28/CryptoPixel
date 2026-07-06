import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, Contract } from 'ethers';
import { CheckCircle2, XCircle, PartyPopper, Gift } from 'lucide-react';

interface AirdropClaimProps {
  account: string | null;
  readContract: Contract | null;
  totalFrozen: number; // déjà dispo dans App via state
  txStatus: string | null;
  onClaim: () => Promise<void>;
}

interface Eligibility {
  hasClaimed: boolean;
  frozenCount: number;
  minFrozen: number;
  balance: string;
  minBalance: string;
  airdropAmount: string;
  claimantsLeft: number | null;
  unlockThreshold: number;
}

const fmtNum = (n: number) => n.toLocaleString('en-US');

function  AirdropClaim({ account, readContract, totalFrozen, txStatus, onClaim }: AirdropClaimProps) {
  const [data, setData]         = useState<Eligibility | null>(null);
  const [loading, setLoading]   = useState(false);
  const [claiming, setClaiming] = useState(false);

  const constantsCacheRef = useRef<{
  minBalance: string;
  minFrozen: number;
  airdropAmount: string;
  maxClaimants: number;
  unlockThreshold: number;
} | null>(null);

const fetchEligibility = useCallback(async () => {
  if (!account || !readContract) return;
  setLoading(true);
  try {
    let constants = constantsCacheRef.current;
    if (!constants) {
      const [minPaint, minFrozen, amount, maxClaimants, threshold] = await Promise.all([
        readContract.MIN_PAINT_HOLD(),
        readContract.MIN_FROZEN_COUNT(),
        readContract.AIRDROP_AMOUNT(),
        readContract.MAX_CLAIMANTS(),
        readContract.UNLOCK_FREEZE_THRESHOLD(),
      ]);
      constants = {
        minBalance: ethers.formatEther(minPaint),
        minFrozen: Number(minFrozen),
        airdropAmount: ethers.formatEther(amount),
        maxClaimants: Number(maxClaimants),
        unlockThreshold: Number(threshold),
      };
      constantsCacheRef.current = constants;
    }

    const [claimed, frozenCount, balance, totalClaimants] = await Promise.all([
      readContract.hasClaimed(account),
      readContract.frozenCountByAddress(account),
      readContract.balanceOf(account),
      readContract.totalClaimants(),
    ]);

    setData({
      hasClaimed: claimed,
      frozenCount: Number(frozenCount),
      minFrozen: constants.minFrozen,
      balance: ethers.formatEther(balance),
      minBalance: constants.minBalance,
      airdropAmount: constants.airdropAmount,
      claimantsLeft: constants.maxClaimants - Number(totalClaimants),
      unlockThreshold: constants.unlockThreshold,
    });
  } catch (e) {
    console.error('Error fetching airdrop eligibility', e);
  } finally {
    setLoading(false);
  }
}, [account, readContract]);

  useEffect(() => { fetchEligibility(); }, [fetchEligibility]);

  if (!account) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: '20px 0' }}>
        Connect your wallet to see your airdrop eligibility.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, padding: '20px 0' }}>
        Loading...
      </div>
    );
  }

  if (!data) return null;

  const isBusy       = claiming || txStatus === 'pending' || txStatus === 'mining';
  const meetsBalance  = parseFloat(data.balance) >= parseFloat(data.minBalance);
  const meetsFrozen   = data.frozenCount >= data.minFrozen;
  const meetsGlobal   = totalFrozen >= data.unlockThreshold;
  const spotsLeft     = data.claimantsLeft !== null && data.claimantsLeft > 0;
  const isEligible    = meetsBalance && meetsFrozen && meetsGlobal && spotsLeft && !data.hasClaimed;

  const checklistItem = (met: boolean, label: string, detail: string) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px',
      background: met ? 'var(--color-green-dim)' : 'var(--bg-surface-2)',
      border: `1px solid ${met ? 'var(--color-green)' : 'var(--border-default)'}`,
      borderRadius: 8,
    }}>
      <span style={{ display: 'inline-flex' }}>
        {met ? <CheckCircle2 size={16} color="var(--color-green)" /> : <XCircle size={16} color="var(--color-red)" />}
      </span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: met ? 'var(--color-green)' : 'var(--text-primary)' }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {detail}
        </div>
      </div>
    </div>
  );

  if (data.hasClaimed) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
          <PartyPopper size={32} color="var(--color-green)" />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-green)' }}>
          Airdrop already claimed!
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          You have received {data.airdropAmount} PAINT.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '10px 14px',
        background: 'linear-gradient(135deg, var(--color-primary-dim), var(--color-purple-dim))',
        border: '1px solid var(--border-primary)',
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Gift size={14} color="var(--color-primary)" /> Airdrop — {data.airdropAmount} PAINT
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Meet all the conditions below to claim.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {checklistItem(
          meetsBalance,
          `Hold ${data.minBalance} PAINT`,
          `${parseFloat(data.balance).toFixed(2)} / ${data.minBalance} PAINT`
        )}
        {checklistItem(
          meetsFrozen,
          `Freeze ${data.minFrozen} pixels`,
          `${data.frozenCount} / ${data.minFrozen} pixels frozen`
        )}
        {checklistItem(
          meetsGlobal,
          `Global canvas milestone`,
          `${fmtNum(totalFrozen)} / ${fmtNum(data.unlockThreshold)} pixels frozen (across all players)`
        )}
        {checklistItem(
          spotsLeft,
          `Spots available`,
          spotsLeft ? `${fmtNum(data.claimantsLeft ?? 0)} spots left` : 'Airdrop full'
        )}
      </div>

      <button
        className="btn-primary"
        onClick={async () => {
          setClaiming(true);
          try { await onClaim(); } finally { setClaiming(false); fetchEligibility(); }
        }}
        disabled={!isEligible || isBusy}
        style={{ opacity: isEligible ? 1 : 0.5, cursor: isEligible ? 'pointer' : 'not-allowed' }}
      >
        {isBusy ? 'Processing...' : isEligible ? `Claim ${data.airdropAmount} PAINT` : 'Conditions not met'}
      </button>
    </div>
  );
}
export default React.memo(AirdropClaim);