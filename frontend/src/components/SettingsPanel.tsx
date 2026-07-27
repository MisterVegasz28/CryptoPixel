import React, { useState, useRef, useEffect } from 'react';
import { Pencil, Sun, Moon, ChevronDown, Check, HelpCircle } from 'lucide-react';

interface AccentOption {
  id: string;
  label: string;
  dark: string;
  light: string;
}

export const ACCENT_COLORS: AccentOption[] = [
  { id: 'default', label: 'Cyan', dark: '#00d4ff', light: '#0099cc' },
  { id: 'red', label: 'Red', dark: '#ef4444', light: '#dc2626' },
  { id: 'blue', label: 'Blue', dark: '#3b82f6', light: '#2563eb' },
  { id: 'yellow', label: 'Yellow', dark: '#eab308', light: '#ca8a04' },
  { id: 'pink', label: 'Pink', dark: '#ec4899', light: '#db2777' },
  { id: 'purple', label: 'Purple', dark: '#a855f7', light: '#7c3aed' },
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
  onReplayTutorial?: () => void;
  onOpenFAQ?: () => void;
}

export default function SettingsPanel({ isOpen, onClose, theme, setTheme, accent, setAccent, account, onEditProfile, onOpenFAQ, onReplayTutorial }: SettingsPanelProps) {
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
          Settings
        </h2>

        {/* ── Toggle Light / Dark ─────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Appearance
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
              <Sun size={14} /> Light
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
              <Moon size={14} /> Dark
            </button>
          </div>
        </div>

        {/* ── Dropdown couleur ─────────────────────────────────────── */}
        <div ref={colorMenuRef} style={{ position: 'relative' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Theme color
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
            <span style={{
              color: 'var(--text-muted)', display: 'inline-flex',
              transform: colorMenuOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}>
              <ChevronDown size={12} />
            </span>
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
                    {active && <span style={{ marginLeft: 'auto', color: c, display: 'inline-flex' }}><Check size={14} strokeWidth={3} /></span>}
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
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Pencil size={14} /> Edit my profile
          </button>
        )}

        <button
          onClick={() => { onReplayTutorial?.(); onClose(); }}
          style={{
            width: '100%', marginTop: 12, padding: 10,
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <HelpCircle size={14} /> Replay tutorial
        </button>

        <button
          onClick={() => { onOpenFAQ?.(); onClose(); }}
          style={{ width: '100%', marginTop: 12, padding: 10, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <HelpCircle size={14} /> FAQ
        </button>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-default)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>
            Found a bug? Reach out at{' '}
            <a href="mailto:contact@tondomaine.com?subject=CryptoPixel%20-%20Bug%20report" style={{ color: 'var(--color-primary)' }}>
              contact@tondomaine.com
            </a>
          </p>
          <p style={{ marginTop: 10, fontSize: 11 }}>
            <a href="/privacy" style={{ color: 'var(--color-primary)' }}>Privacy Policy</a>
            {' · '}
            <a href="/terms" style={{ color: 'var(--color-primary)' }}>Terms of Service</a>
          </p>
        </div>

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
          Close
        </button>
      </div>
    </div>
  );
}