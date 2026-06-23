import React, { useState, useEffect, useRef } from 'react';
import EditProfileModal from './EditProfileModal.jsx';
import { INDEXER_URL } from '../App.jsx';

function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

const SOCIAL_ICONS = {
  twitter: '𝕏',
  instagram: '📷',
  telegram: '✈️',
  discord: '🎮',
};

const SOCIAL_LABELS = {
  twitter: 'Twitter / X',
  instagram: 'Instagram',
  telegram: 'Telegram',
  discord: 'Discord',
};

// ── Popover affiché au survol d'un burner du classement ──────────────────────
function BurnerPopover({ burner }) {
  const socials = ['twitter', 'instagram', 'telegram', 'discord'].filter(key => burner[key]);
  const hasContent = burner.message || socials.length > 0;

  if (!hasContent) return null;

  return (
    <div
      style={{
        position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
        marginLeft: 10, width: 220, zIndex: 1200,
        background: '#0d0d14', border: '1px solid #a855f7',
        borderRadius: 12, padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: burner.message ? 8 : (socials.length ? 8 : 0) }}>
        <span style={{ color: '#a855f7', fontWeight: 700, fontSize: 13 }}>
          {burner.pseudo || shortAddr(burner.address)}
        </span>
      </div>

      {burner.message && (
        <p style={{ color: '#d1d5db', fontSize: 11, lineHeight: 1.5, margin: '0 0 8px 0' }}>
          {burner.message}
        </p>
      )}

      {socials.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {socials.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span>{SOCIAL_ICONS[key]}</span>
              <span style={{ color: '#6b7280' }}>{SOCIAL_LABELS[key]}:</span>
              <span style={{ color: '#00d4ff', fontFamily: "'Space Mono', monospace" }}>{burner[key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header({ 
  account, 
  tokenBalance, 
  onDisconnect,
  onConnect, 
  txStatus, 
  config, 
  onOpenLeaderboard, 
  leaderboard, 
  showLeaderboard, 
  onCloseLeaderboard,
  signer,
}) {
  const title = config?.title || 'CryptoPixel';
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [hoveredBurner, setHoveredBurner] = useState(null);

  // CORRECTION : pseudo de l'utilisateur connecté + menu déroulant pour
  // consulter l'adresse complète sans avoir à la mémoriser.
  const [myPseudo, setMyPseudo] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Charge mon propre pseudo (si déjà défini) pour l'afficher à la place de l'adresse
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
      } catch (e) {
        console.error('Error loading own pseudo', e);
      }
    })();
    return () => { cancelled = true; };
  }, [account, showEditProfile]); // re-fetch après fermeture de la modale edit (pseudo a pu changer)

  // Ferme le menu déroulant au clic en dehors
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [addressCopied, setAddressCopied] = useState(false);

  const copyAddress = () => {
    if (account) {
      navigator.clipboard?.writeText(account);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    }
  };

  const statusColor = {
    pending: '#f59e0b',
    mining: '#a855f7',
    success: '#22c55e',
    error: '#ef4444'
  }[txStatus] || null;

  const statusLabel = {
    pending: 'Awaiting confirmation...',
    mining: 'Mining...',
    success: 'Confirmed!',
    error: 'Failed'
  }[txStatus] || null;

  return (
    <>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 56,
        background: 'rgba(10,10,15,0.98)',
        borderBottom: '1px solid rgba(0,212,255,0.1)',
        flexShrink: 0, position: 'relative', zIndex: 100
      }}>
        {/* Logo + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34,
            background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.2))',
            border: '1px solid #00d4ff', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', color: '#00d4ff', fontSize: 14
          }}>CP</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #fff, #888)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {title}
          </h1>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {statusLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className={txStatus === 'pending' || txStatus === 'mining' ? 'spinner' : ''} style={{ width: 10, height: 10, borderRadius: '50%', background: txStatus === 'pending' || txStatus === 'mining' ? 'transparent' : statusColor }} />
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{statusLabel}</span>
            </div>
          )}

          {/* Bouton Classement */}
          <button 
            onClick={onOpenLeaderboard} 
            style={{ 
              background: 'rgba(168, 85, 247, 0.1)', 
              border: '1px solid #a855f7', 
              color: '#a855f7', 
              padding: '6px 14px', 
              borderRadius: 20, 
              cursor: 'pointer', 
              fontSize: 12,
              fontWeight: 600
            }}
          >
            🏆 Top Burners
          </button>

          {account ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <div
                onClick={() => setAccountMenuOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.15)',
                  padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                }}
              >
                {/* CORRECTION : pseudo affiché si défini, sinon adresse tronquée */}
                <span style={{ fontSize: 12, fontWeight: 700, color: myPseudo ? '#a855f7' : '#00d4ff', fontFamily: myPseudo ? 'inherit' : "'Space Mono', monospace" }}>
                  {myPseudo || shortAddr(account)}
                </span>
                <div style={{ width: 1, height: 14, background: 'rgba(0,212,255,0.2)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', fontFamily: "'Space Mono', monospace" }}>
                  {parseFloat(tokenBalance).toFixed(2)} PAINT
                </span>
                <span style={{ fontSize: 9, color: '#6b7280', transform: accountMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
              </div>

              {/* Menu déroulant : adresse complète + actions */}
              {accountMenuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 8,
                  background: '#0d0d14', border: '1px solid rgba(0,212,255,0.2)',
                  borderRadius: 12, padding: 10, width: 240,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200,
                }}>
                  {myPseudo && (
                    <div style={{ fontSize: 12, color: '#a855f7', fontWeight: 700, marginBottom: 6 }}>
                      {myPseudo}
                    </div>
                  )}
                  <div
                    onClick={copyAddress}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 11, fontFamily: "'Space Mono', monospace",
                      padding: '8px 10px', borderRadius: 8,
                      cursor: 'pointer', marginBottom: 8,
                      color: addressCopied ? '#22c55e' : '#9ca3af',
                      background: addressCopied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${addressCopied ? 'rgba(34,197,94,0.3)' : 'transparent'}`,
                      transition: 'all 0.2s ease',
                    }}
                    title="Click to copy"
                  >
                    <span style={{ wordBreak: 'break-all' }}>
                      {addressCopied ? 'Copied to clipboard!' : account}
                    </span>
                    <span style={{
                      marginLeft: 8, flexShrink: 0,
                      transform: addressCopied ? 'scale(1.3)' : 'scale(1)',
                      transition: 'transform 0.2s ease',
                    }}>
                      {addressCopied ? '✅' : '📋'}
                    </span>
                  </div>
                  <button
                    onClick={() => { setAccountMenuOpen(false); onDisconnect(); }}
                    style={{
                      width: '100%', padding: 8, background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.2)', color: '#f87171',
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
              style={{ borderRadius: 20, fontSize: 12, padding: '8px 20px', boxShadow: '0 0 16px rgba(0,212,255,0.25)' }}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* MODALE CLASSEMENT */}
      {showLeaderboard && (
        <div 
          style={{ 
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
            background: 'rgba(0,0,0,0.85)', zIndex: 1000, 
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            backdropFilter: 'blur(4px)'
          }} 
          onClick={onCloseLeaderboard}
        >
          <div 
            style={{ 
              background: '#0d0d14', border: '1px solid #a855f7', 
              padding: 24, borderRadius: 16, width: 320,
              boxShadow: '0 0 30px rgba(168, 85, 247, 0.2)'
            }} 
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ color: '#fff', textAlign: 'center', marginTop: 0, marginBottom: 12 }}>🔥 Top Burners</h2>

            {account && (
              <button
                onClick={() => setShowEditProfile(true)}
                style={{
                  width: '100%', marginBottom: 16, padding: 8,
                  background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)',
                  color: '#00d4ff', borderRadius: 8, cursor: 'pointer',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                ✏️ Edit my profile
              </button>
            )}
            
            {leaderboard.length === 0 ? (
              <p style={{ color: '#6b7280', textAlign: 'center' }}>No pixels frozen yet...</p>
            ) : (
              leaderboard.map((burner) => (
                <div
                  key={burner.address}
                  style={{
                    position: 'relative',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    cursor: (burner.message || burner.twitter || burner.instagram || burner.telegram || burner.discord) ? 'help' : 'default',
                  }}
                  onMouseEnter={() => setHoveredBurner(burner.address)}
                  onMouseLeave={() => setHoveredBurner(null)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: 13 }}>
                      {burner.rank}. {burner.pseudo ? (
                        <span style={{ color: '#a855f7', fontWeight: 700 }}>{burner.pseudo}</span>
                      ) : shortAddr(burner.address)}
                    </span>
                    {burner.pseudo && (
                      <span style={{ color: '#4b5563', fontSize: 10, fontFamily: 'monospace' }}>
                        {shortAddr(burner.address)}
                      </span>
                    )}
                  </div>
                  <span style={{ color: '#00d4ff', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {burner.totalFrozen} ❄️
                  </span>

                  {hoveredBurner === burner.address && <BurnerPopover burner={burner} />}
                </div>
              ))
            )}
            
            <button 
              onClick={onCloseLeaderboard}
              style={{ 
                width: '100%', marginTop: 20, padding: 10, 
                background: 'transparent', border: '1px solid #374151', 
                color: '#fff', borderRadius: 8, cursor: 'pointer' 
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODALE EDIT PROFILE */}
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