import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import EditProfileModal from './EditProfileModal';
import { INDEXER_URL } from '../App';
import SettingsPanel from './SettingsPanel';
import logo from '../assets/cryptopixel-logo-64.webp';
import GoogleSignInButton from './GoogleSignInButton';
import { Trophy, Copy, Check, Snowflake, Flame, Search, Settings, AtSign, Image, Send, Gamepad2, Gift } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { shortAddr, getBadge, BADGE_TIERS } from '../lib/format';
import WalletFunding from './WalletFunding';
import FAQModal from './FAQModal';

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
  polBalance: string;
  onConnect: () => void;
  onGoogleConnect: () => void;
  onDisconnect: () => void;
  txStatus: string | null;
  config: { title: string };
  onOpenLeaderboard: () => void;
  leaderboard: LeaderboardItem[];
  showLeaderboard: boolean;
  onCloseLeaderboard: () => void;
  isLoadingLeaderboard?: boolean;
  hasClaimedAirdrop?: boolean;
  signer: ethers.Signer | null;
  theme: string;
  setTheme: (theme: string) => void;
  accent: string;
  setAccent: (accent: string) => void;
  onReplayTutorial?: () => void;
  ready: boolean;
}

interface BurnerPopoverProps { burner: LeaderboardItem; top: number; left: number; }

const SOCIAL_ICONS: Record<SocialKey, LucideIcon> = {
  twitter: AtSign, instagram: Image, telegram: Send, discord: Gamepad2,
};
const SOCIAL_COLORS: Record<SocialKey, string> = {
  twitter: '#1DA1F2', instagram: '#E1306C', telegram: '#229ED9', discord: '#5865F2',
};
const SOCIAL_LABELS: Record<SocialKey, string> = { twitter: 'Twitter / X', instagram: 'Instagram', telegram: 'Telegram', discord: 'Discord' };

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--color-amber)',
  mining: 'var(--color-purple)',
  success: 'var(--color-green)',
  error: 'var(--color-red)',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting confirmation...',
  mining: 'Mining...',
  success: 'Confirmed!',
  error: 'Failed',
};

// ── BurnerPopover ─────────────────────────────────────────────────────────────
function BurnerPopover({ burner, top, left }: BurnerPopoverProps) {
  const socials = (['twitter', 'instagram', 'telegram', 'discord'] as SocialKey[]).filter(k => burner[k]);
  if (!burner.message && socials.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top, left, transform: 'translateY(-50%)',
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
              {React.createElement(SOCIAL_ICONS[key], { size: 12, color: SOCIAL_COLORS[key] })}
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
function Header({
  account, tokenBalance, onConnect, onGoogleConnect, onDisconnect,
  txStatus, config, onOpenLeaderboard, leaderboard, showLeaderboard,
  onCloseLeaderboard, onReplayTutorial, isLoadingLeaderboard,
  hasClaimedAirdrop, signer, theme, setTheme, accent, setAccent, polBalance,
  ready, // ← ajouté
}: HeaderProps) {
  const title = config?.title || 'CryptoPixel';
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [hoveredBurner, setHoveredBurner] = useState<{ address: string; top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBadgeInfo, setShowBadgeInfo] = useState(false);
  const [myPseudo, setMyPseudo] = useState('');
  const [myFrozenCount, setMyFrozenCount] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [myProfile, setMyProfile] = useState<{
    pseudo: string; message: string; instagram: string;
    telegram: string; twitter: string; discord: string;
  } | null>(null);
  const [myProfileNotFound, setMyProfileNotFound] = useState(false);

  useEffect(() => {
    if (!account) { setMyPseudo(''); setMyFrozenCount(0); setMyProfile(null); setMyProfileNotFound(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(`${INDEXER_URL}/burners/${account.toLowerCase()}`, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (res.status === 404) {
          if (!cancelled) { setMyPseudo(''); setMyFrozenCount(0); setMyProfile(null); setMyProfileNotFound(true); }
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setMyPseudo(data.pseudo || '');
          setMyFrozenCount(Number(data.totalFrozen) || 0);
          setMyProfile({
            pseudo: data.pseudo || '',
            message: data.message || '',
            instagram: data.instagram || '',
            telegram: data.telegram || '',
            twitter: data.twitter || '',
            discord: data.discord || '',
          });
          setMyProfileNotFound(false);
        }
      } catch (e) { console.error('Error loading own pseudo', e); }
    })();
    return () => { cancelled = true; };
  }, [account, profileRefreshKey]);

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

  const handleCloseSettings = useCallback(() => setShowSettings(false), []);
  const handleCloseFAQ = useCallback(() => setShowFAQ(false), []);
  const handleCloseEditProfile = useCallback(() => setShowEditProfile(false), []);
  const handleProfileSavedInHeader = useCallback(() => {
    setProfileRefreshKey(k => k + 1);
    onOpenLeaderboard();
  }, [onOpenLeaderboard]);
  const handleOpenEditProfileFromSettings = useCallback(() => {
    setShowSettings(false);
    setShowEditProfile(true);
  }, []);

  const statusColor = txStatus ? STATUS_COLOR[txStatus] ?? null : null;
  const statusLabel = txStatus ? STATUS_LABEL[txStatus] ?? null : null;

  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const filteredLeaderboard = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return leaderboard;
    return leaderboard.filter(b =>
      b.pseudo.toLowerCase().includes(q) || b.address.toLowerCase().includes(q)
    );
  }, [debouncedQuery, leaderboard]);

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
          <img
            src={logo}
            alt="CryptoPixel"
            width="34"
            height="34"
            style={{
              width: 34, height: 34, borderRadius: 8, objectFit: 'cover',
              border: '1px solid var(--color-primary)',
            }}
          />
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

          {/* Statut tx — slot réservé, crossfade au lieu de mount/unmount pour ne plus décaler le reste */}
          <div style={{
            maxWidth: statusLabel ? 260 : 0,
            overflow: 'hidden',
            opacity: statusLabel ? 1 : 0,
            transition: 'opacity 0.15s, max-width 0.15s',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 12,
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-default)',
              whiteSpace: 'nowrap',
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
          </div>

          {/* Bouton paramètres */}
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
            style={{
              background: 'var(--color-primary-dim)',
              border: '1px solid var(--color-primary-border)',
              color: 'var(--color-primary)',
              width: 32, height: 32, borderRadius: '50%',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', transition: 'all 0.2s',
            }}
          >
            <Settings size={16} />
          </button>

          {/* Top Burners */}
          <button
            onClick={onOpenLeaderboard}
            disabled={isLoadingLeaderboard}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg-hover)', border: '1px solid var(--border-default)',
              color: 'var(--text-primary)', borderRadius: 20, padding: '8px 16px',
              cursor: isLoadingLeaderboard ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
              opacity: isLoadingLeaderboard ? 0.6 : 1,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Trophy size={14} /> {isLoadingLeaderboard ? 'Loading...' : 'Top Burners'}
            </span>
          </button>

          {/* Compte / Connect — slot à largeur réservée pour absorber le switch sans décaler Settings/Top Burners */}
          <div style={{ minWidth: 290, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
            {!ready ? null : account ? (
              <>

                <WalletFunding account={account} />

                <div ref={menuRef} style={{ position: 'relative' }}>
                  <div
                    onClick={() => setAccountMenuOpen(o => !o)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      minWidth: 250, boxSizing: 'border-box',
                      background: 'var(--color-primary-dim)',
                      border: '1px solid var(--color-primary-border)',
                      padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: myPseudo ? 'var(--color-purple)' : 'var(--color-primary)',
                      fontFamily: myPseudo ? 'inherit' : "'Space Mono', monospace",
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {/* Slot fixe pour le badge — toujours monté, opacity au lieu de mount/unmount */}
                      <span style={{
                        display: 'inline-flex', width: 12, justifyContent: 'center',
                        opacity: getBadge(myFrozenCount) ? 1 : 0,
                      }}>
                        {(() => {
                          const badge = getBadge(myFrozenCount);
                          return badge ? <badge.icon size={12} color={badge.color} /> : null;
                        })()}
                      </span>
                      {/* Slot fixe pour le gift icon — idem */}
                      <span title="Has succeeded their airdrop" style={{
                        display: 'inline-flex', width: 12, justifyContent: 'center',
                        opacity: hasClaimedAirdrop ? 1 : 0,
                      }}>
                        <Gift size={12} color="var(--color-green)" />
                      </span>
                      {/* minWidth pour absorber pseudo court vs adresse courte (~10 caractères) */}
                      <span style={{ minWidth: 60, display: 'inline-block' }}>
                        {myPseudo || shortAddr(account)}
                      </span>
                    </span>
                    <div style={{ width: 1, height: 14, background: 'var(--color-primary-border)' }} />
                    {/* minWidth + textAlign right : les chiffres ne poussent plus le reste quand ils s'allongent */}
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-purple)', fontFamily: "'Space Mono', monospace", minWidth: 60, textAlign: 'right', display: 'inline-block' }}>
                      {parseFloat(tokenBalance).toFixed(2)} PAINT
                    </span>
                    <div style={{ width: 1, height: 14, background: 'var(--color-primary-border)' }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace", minWidth: 60, textAlign: 'right', display: 'inline-block' }}>
                      {parseFloat(polBalance).toFixed(3)} POL
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
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
                        }}
                        title="Click to copy"
                      >
                        <span style={{ wordBreak: 'break-all' }}>
                          {addressCopied ? 'Copied to clipboard!' : account}
                        </span>
                        <span style={{ marginLeft: 8, flexShrink: 0, transform: addressCopied ? 'scale(1.3)' : 'scale(1)', transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease', display: 'inline-flex' }}>
                          {addressCopied ? <Check size={14} /> : <Copy size={14} />}
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
              </>
            ) : (
              <>
                <button
                  onClick={onConnect}
                  className="btn-primary"
                  style={{ borderRadius: 20, fontSize: 14, padding: '10px 22px', boxShadow: '0 0 16px var(--color-primary-glow)' }}
                >
                  Connect Wallet
                </button>
                <div style={{ marginLeft: 8 }}>
                  <GoogleSignInButton onClick={onGoogleConnect} />
                </div>
              </>
            )}
          </div>
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
            onClick={e => { e.stopPropagation(); setShowBadgeInfo(false); }}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <h2 style={{ color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Flame size={18} color="#f97316" /> Top Burners
              </h2>
              <button
                onClick={e => { e.stopPropagation(); setShowBadgeInfo(v => !v); }}
                aria-label="Badge system information"
                title="Badge system"
                style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, padding: 0,
                }}
              >
                i
              </button>

              {showBadgeInfo && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                    marginTop: 8, width: 240, zIndex: 50,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 12, padding: '12px 14px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8 }}>
                    BADGE TIERS
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {BADGE_TIERS.map(t => (
                      <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <t.icon size={14} color={t.color} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t.label}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                          {t.threshold}+ frozen
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {leaderboard.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No pixels frozen yet...</p>
            ) : (
              <>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    id="leaderboard-search"
                    name="leaderboard-search"
                    aria-label="Search by username or address"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by username or address..."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '8px 12px 8px 32px',
                      background: 'var(--bg-hover)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 8, color: 'var(--text-primary)', fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </div>

                {filteredLeaderboard.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
                    No results for &quot;{searchQuery}&quot;
                  </p>
                ) : (
                  <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
                    {filteredLeaderboard.map(burner => {
                      const badge = getBadge(burner.totalFrozen);
                      return (
                        <div
                          key={burner.address}
                          style={{
                            position: 'relative',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: '1px solid var(--border-default)',
                            cursor: (burner.message || burner.twitter || burner.instagram || burner.telegram || burner.discord) ? 'help' : 'default',
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredBurner({ address: burner.address, top: rect.top + rect.height / 2, left: rect.right });
                          }}
                          onMouseLeave={() => setHoveredBurner(null)}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                              {burner.rank}.
                              {badge && (
                                <span title={badge.label} style={{ display: 'inline-flex' }}>
                                  <badge.icon size={13} color={badge.color} />
                                </span>
                              )}
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
                          <span style={{ color: 'var(--color-primary)', fontWeight: 'bold', fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {burner.totalFrozen} <Snowflake size={13} />
                          </span>
                          {hoveredBurner?.address === burner.address && (
                            <BurnerPopover burner={burner} top={hoveredBurner.top} left={hoveredBurner.left} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

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

      {/* ── Panneau paramètres (indépendant, toujours monté) ─────────────── */}
      <SettingsPanel
        isOpen={showSettings}
        theme={theme}
        setTheme={setTheme}
        accent={accent}
        setAccent={setAccent}
        account={account}
        onClose={handleCloseSettings}
        onEditProfile={handleOpenEditProfileFromSettings}
        onReplayTutorial={onReplayTutorial}
        onOpenFAQ={() => setShowFAQ(true)}
      />

      {/* ── Modale edit profile ──────────────────────────────────────────── */}
      {showEditProfile && account && (
        <EditProfileModal
          account={account}
          signer={signer}
          onClose={handleCloseEditProfile}
          onSaved={handleProfileSavedInHeader}
          initialProfile={myProfile}
          initialNotBurner={myProfileNotFound}
        />
      )}
      <FAQModal isOpen={showFAQ} onClose={handleCloseFAQ} />
    </>
  );
}
export default React.memo(Header);