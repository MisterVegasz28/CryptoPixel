import React, { useState, useRef, useEffect } from 'react';

interface AccentOption {
  id: string;
  label: string;
  dark: string;
  light: string;
}

export const ACCENT_COLORS: AccentOption[] = [
  { id: 'default', label: 'Cyan',   dark: '#00d4ff', light: '#0099cc' },
  { id: 'red',     label: 'Rouge',  dark: '#ef4444', light: '#dc2626' },
  { id: 'blue',    label: 'Bleu',   dark: '#3b82f6', light: '#2563eb' },
  { id: 'yellow',  label: 'Jaune',  dark: '#eab308', light: '#ca8a04' },
  { id: 'pink',    label: 'Rose',   dark: '#ec4899', light: '#db2777' },
  { id: 'purple',  label: 'Violet', dark: '#a855f7', light: '#7c3aed' },
];

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
  setTheme: (t: string) => void;
  accent: string;
  setAccent: (a: string) => void;
  account?: string | null;
  onEditProfile?: () => void;
}

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

export default function SettingsPanel({ isOpen, onClose, theme, setTheme, accent, setAccent, account, onEditProfile, }: SettingsPanelProps) {
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
  // N'attacher l'écouteur que si le menu est VRAIMENT ouvert
  if (!colorMenuOpen) return; 
  
  const handleClickOutside = (e: MouseEvent) => {
    if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
      setColorMenuOpen(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [colorMenuOpen]); // Dépendance ajoutée

  if (!isOpen) return null;

  const currentAccent = ACCENT_COLORS.find(a => a.id === accent) ?? ACCENT_COLORS[0];
  const swatchColor = theme === 'dark' ? currentAccent.dark : currentAccent.light;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'var(--overlay-bg)', zIndex: 1000,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--color-primary-border)',
          padding: 24, borderRadius: 16, width: 300,
          boxShadow: '0 0 30px var(--color-primary-glow)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ color: 'var(--text-primary)', textAlign: 'center', marginTop: 0, marginBottom: 20, fontSize: 16 }}>
          Paramètres
        </h2>

        {/* ── Toggle Light / Dark ─────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Apparence
          </label>
          <div style={{
            position: 'relative', display: 'flex',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-default)',
            borderRadius: 10, padding: 3, height: 38,
          }}>
            <div style={{
              position: 'absolute', top: 3, left: 3,
              width: 'calc(50% - 3px)', height: 32,
              background: 'var(--color-primary)',
              borderRadius: 7,
              transform: theme === 'dark' ? 'translateX(100%)' : 'translateX(0)',
              transition: 'transform 0.25s ease',
            }} />
            <button
              onClick={() => setTheme('light')}
              style={{
                position: 'relative', zIndex: 1, flex: 1, border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: theme === 'light' ? '#000' : 'var(--text-secondary)',
              }}
            >
              <SunIcon /> Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              style={{
                position: 'relative', zIndex: 1, flex: 1, border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: theme === 'dark' ? '#000' : 'var(--text-secondary)',
              }}
            >
              <MoonIcon /> Dark
            </button>
          </div>
        </div>

        {/* ── Dropdown couleur ─────────────────────────────────────── */}
        <div ref={colorMenuRef} style={{ position: 'relative' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Couleur du thème
          </label>
          <div
            onClick={() => setColorMenuOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%',
                background: swatchColor, boxShadow: `0 0 8px ${swatchColor}`,
                display: 'inline-block',
              }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                {currentAccent.label}
              </span>
            </div>
            <span style={{ color: 'var(--text-muted)' }}><ChevronIcon open={colorMenuOpen} /></span>
          </div>

          {colorMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 10, padding: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 10,
            }}>
              {ACCENT_COLORS.map(a => {
                const c = theme === 'dark' ? a.dark : a.light;
                const active = a.id === accent;
                return (
                  <div
                    key={a.id}
                    onClick={() => { setAccent(a.id); setColorMenuOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                    }}
                  >
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: c, boxShadow: `0 0 8px ${c}`,
                      display: 'inline-block',
                    }} />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{a.label}</span>
                    {active && <span style={{ marginLeft: 'auto', color: c }}><CheckIcon /></span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {account && onEditProfile && (
          <button
            onClick={onEditProfile}
            style={{
              width: '100%', marginTop: 20, padding: 10,
              background: 'var(--color-primary-dim)',
              border: '1px solid var(--border-strong)',
              color: 'var(--color-primary)',
              borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            ✏️ Edit my profile
          </button>
        )}
        
        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: 24, padding: 10,
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            borderRadius: 8, cursor: 'pointer', fontSize: 13,
          }}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}