import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import EditProfileModal from './EditProfileModal';
import { INDEXER_URL } from '../App';

type SocialKey = 'twitter' | 'instagram' | 'telegram' | 'discord';

interface LeaderboardItem {
  rank: number;
  address: string;
  totalFrozen: number;
  pseudo: string;
  message: string;
  twitter: string;
  instagram: string;
  telegram: string;
  discord: string;
}

interface HeaderProps {
  account: string | null;
  tokenBalance: string;
  onConnect: () => void;
  onDisconnect: () => void;
  txStatus: string | null;
  config: { title: string };
  onOpenLeaderboard: () => void;
  leaderboard: LeaderboardItem[];
  showLeaderboard: boolean;
  onCloseLeaderboard: () => void;
  isLoadingLeaderboard?: boolean;
  airdropUnlocked?: boolean;
  signer: ethers.Signer | null;
  theme: string;
  setTheme: (theme: string) => void;
}

interface BurnerPopoverProps { burner: LeaderboardItem; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(a: string | null | undefined): string {
  if (!a) return '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

const SOCIAL_ICONS: Record<SocialKey, string>  = { twitter: '𝕏', instagram: '📷', telegram: '✈️', discord: '🎮' };
const SOCIAL_LABELS: Record<SocialKey, string> = { twitter: 'Twitter / X', instagram: 'Instagram', telegram: 'Telegram', discord: 'Discord' };

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--color-amber)',
  mining:  'var(--color-purple)',
  success: 'var(--color-green)',
  error:   'var(--color-red)',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting confirmation...',
  mining:  'Mining...',
  success: 'Confirmed!',
  error:   'Failed',
};

// ── BurnerPopover ─────────────────────────────────────────────────────────────
function BurnerPopover({ burner }: BurnerPopoverProps) {
  const socials = (['twitter', 'instagram', 'telegram', 'discord'] as SocialKey[]).filter(k => burner[k]);
  if (!burner.message && socials.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
      marginLeft: 10, width: 220, zIndex: 1200,
      background: 'var(--bg-surface)',
      border: '1px solid var(--color-purple-border)',
      borderRadius: 12, padding: '12px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: burner.message || socials.length ? 8 : 0 }}>
        <span style={{ color: 'var(--color-purple)', fontWeight: 700, fontSize: 13 }}>
          {burner.pseudo || shortAddr(burner.address)}
        </span>
      </div>
      {burner.message && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5, margin: '0 0 8px 0' }}>
          {burner.message}
        </p>
      )}
      {socials.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {socials.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span>{SOCIAL_ICONS[key]}</span>
              <span style={{ color: 'var(--text-muted)' }}>{SOCIAL_LABELS[key]}:</span>
              <span style={{ color: 'var(--color-primary)', fontFamily: "'Space Mono', monospace" }}>{burner[key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
export default function Header({
  account, tokenBalance, onDisconnect, onConnect, txStatus,
  config, onOpenLeaderboard, leaderboard, showLeaderboard, onCloseLeaderboard,
  signer, theme, setTheme,
}: HeaderProps) {
  const title = config?.title || 'CryptoPixel';
  const [showEditProfile, setShowEditProfile]   = useState(false);
  const [hoveredBurner, setHoveredBurner]       = useState<string | null>(null);
  const [myPseudo, setMyPseudo]                 = useState('');
  const [accountMenuOpen, setAccountMenuOpen]   = useState(false);
  const [addressCopied, setAddressCopied]       = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!account) { setMyPseudo(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${INDEXER_URL}/burners/${account.toLowerCase()}`);
        if (res.status === 404) { if (!cancelled) setMyPseudo(''); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setMyPseudo(data.pseudo || '');
      } catch (e) { console.error('Error loading own pseudo', e); }
    })();
    return () => { cancelled = true; };
  }, [account, showEditProfile]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const copyAddress = () => {
    if (account) {
      navigator.clipboard?.writeText(account);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    }
  };

  const statusColor = txStatus ? STATUS_COLOR[txStatus] ?? null : null;
  const statusLabel = txStatus ? STATUS_LABEL[txStatus] ?? null : null;

  return (
    <>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 56,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-primary)',
        flexShrink: 0, position: 'relative', zIndex: 100,
      }}>
        {/* ── Logo + titre ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34,
            background: 'linear-gradient(135deg, var(--color-primary-dim), var(--color-purple-dim))',
            border: '1px solid var(--color-primary)',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', color: 'var(--color-primary)', fontSize: 14,
          }}>CP</div>
          <h1 style={{
            fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em',
            background: 'linear-gradient(90deg, var(--text-primary), var(--text-muted))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            {title}
          </h1>
        </div>

        {/* ── Contrôles droite ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>

          {/* Statut tx */}
          {statusLabel && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 12,
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-default)',
            }}>
              <div
                className={txStatus === 'pending' || txStatus === 'mining' ? 'spinner' : ''}
                style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: txStatus === 'pending' || txStatus === 'mining' ? 'transparent' : (statusColor ?? undefined),
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{statusLabel}</span>
            </div>
          )}

          {/* Bouton thème */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            style={{
              background: 'var(--color-primary-dim)',
              border: '1px solid var(--color-primary-border)',
              color: 'var(--color-primary)',
              width: 32, height: 32, borderRadius: '50%',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, transition: 'all 0.2s',
            }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Top Burners */}
          <button
            onClick={onOpenLeaderboard}
            style={{
              background: 'var(--color-purple-dim)',
              border: '1px solid var(--color-purple-border)',
              color: 'var(--color-purple)',
              padding: '6px 14px', borderRadius: 20,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            🏆 Top Burners
          </button>

          {/* Compte / Connect */}
          {account ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <div
                onClick={() => setAccountMenuOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'var(--color-primary-dim)',
                  border: '1px solid var(--color-primary-border)',
                  padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                }}
              >
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: myPseudo ? 'var(--color-purple)' : 'var(--color-primary)',
                  fontFamily: myPseudo ? 'inherit' : "'Space Mono', monospace",
                }}>
                  {myPseudo || shortAddr(account)}
                </span>
                <div style={{ width: 1, height: 14, background: 'var(--color-primary-border)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-purple)', fontFamily: "'Space Mono', monospace" }}>
                  {parseFloat(tokenBalance).toFixed(2)} PAINT
                </span>
                <span style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  transform: accountMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
                }}>▼</span>
              </div>

              {accountMenuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 8,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--color-primary-border)',
                  borderRadius: 12, padding: 10, width: 240,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200,
                }}>
                  {myPseudo && (
                    <div style={{ fontSize: 12, color: 'var(--color-purple)', fontWeight: 700, marginBottom: 6 }}>
                      {myPseudo}
                    </div>
                  )}
                  <div
                    onClick={copyAddress}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 11, fontFamily: "'Space Mono', monospace",
                      padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 8,
                      color: addressCopied ? 'var(--color-green)' : 'var(--text-secondary)',
                       background: addressCopied ? 'var(--color-green-dim)' : 'var(--bg-hover)',
                      border: `1px solid ${addressCopied ? 'var(--color-green-border)' : 'transparent'}`,
                      transition: 'all 0.2s ease',
                    }}
                    title="Click to copy"
                  >
                    <span style={{ wordBreak: 'break-all' }}>
                      {addressCopied ? 'Copied to clipboard!' : account}
                    </span>
                    <span style={{ marginLeft: 8, flexShrink: 0, transform: addressCopied ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.2s ease' }}>
                      {addressCopied ? '✅' : '📋'}
                    </span>
                  </div>
                  <button
                    onClick={() => { setAccountMenuOpen(false); onDisconnect(); }}
                    style={{
                      width: '100%', padding: 8,
                      background: 'var(--color-red-dim)',
                      border: '1px solid var(--color-red-border)',
                      color: 'var(--color-red)',
                      borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onConnect}
              className="btn-primary"
              style={{ borderRadius: 20, fontSize: 12, padding: '8px 20px', boxShadow: '0 0 16px var(--color-primary-glow)' }}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* ── Modale leaderboard ───────────────────────────────────────────── */}
      {showLeaderboard && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'var(--overlay-bg)', zIndex: 1000,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            backdropFilter: 'blur(4px)',
          }}
          onClick={onCloseLeaderboard}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--color-purple-border)',
              padding: 24, borderRadius: 16, width: 320,
              boxShadow: `0 0 30px var(--color-purple-glow)`,
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ color: 'var(--text-primary)', textAlign: 'center', marginTop: 0, marginBottom: 12 }}>🔥 Top Burners</h2>

            {account && (
              <button
                onClick={() => setShowEditProfile(true)}
                style={{
                  width: '100%', marginBottom: 16, padding: 8,
                  background: 'var(--color-primary-dim)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--color-primary)',
                  borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
              >
                ✏️ Edit my profile
              </button>
            )}

            {leaderboard.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No pixels frozen yet...</p>
            ) : leaderboard.map(burner => (
              <div
                key={burner.address}
                style={{
                  position: 'relative',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-default)',
                  cursor: (burner.message || burner.twitter || burner.instagram || burner.telegram || burner.discord) ? 'help' : 'default',
                }}
                onMouseEnter={() => setHoveredBurner(burner.address)}
                onMouseLeave={() => setHoveredBurner(null)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13 }}>
                    {burner.rank}.{' '}
                    {burner.pseudo
                      ? <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{burner.pseudo}</span>
                      : shortAddr(burner.address)
                    }
                  </span>
                  {burner.pseudo && (
                    <span style={{ color: 'var(--text-faint)', fontSize: 10, fontFamily: 'monospace' }}>
                      {shortAddr(burner.address)}
                    </span>
                  )}
                </div>
                <span style={{ color: 'var(--color-primary)', fontWeight: 'bold', fontFamily: 'monospace' }}>
                  {burner.totalFrozen} ❄️
                </span>
                {hoveredBurner === burner.address && <BurnerPopover burner={burner} />}
              </div>
            ))}

            <button
              onClick={onCloseLeaderboard}
              style={{
                width: '100%', marginTop: 20, padding: 10,
                background: 'transparent',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Modale edit profile ──────────────────────────────────────────── */}
      {showEditProfile && account && (
        <EditProfileModal
          account={account}
          signer={signer}
          onClose={() => setShowEditProfile(false)}
          onSaved={onOpenLeaderboard}
        />
      )}
    </>
  );
}