import React, { useState, useEffect } from 'react';
import { Signer } from 'ethers';
import { INDEXER_URL } from '../App';

const LIMITS = { pseudo: 32, bio: 280, social: 64 };

function shortAddr(a: string): string {
  if (!a) return '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

interface ProfileFields {
  pseudo: string;
  bio: string;
  instagram: string;
  telegram: string;
  twitter: string;
  discord: string;
}

const buildProfileMessage = (
  addr: string,
  { pseudo, bio, instagram, telegram, twitter, discord }: ProfileFields,
  timestamp: number
): string =>
  `CryptoPixel profile update\n` +
  `address: ${addr}\n` +
  `pseudo: ${pseudo}\n` +
  `message: ${bio}\n` +
  `instagram: ${instagram}\n` +
  `telegram: ${telegram}\n` +
  `twitter: ${twitter}\n` +
  `discord: ${discord}\n` +
  `timestamp: ${timestamp}`;

interface EditProfileModalProps {
  account: string | null;
  signer: Signer | null;
  onClose: () => void;
  onSaved?: () => void;
}

export default function EditProfileModal({ account, signer, onClose, onSaved }: EditProfileModalProps) {
  const [pseudo, setPseudo]       = useState('');
  const [bio, setBio]             = useState('');
  const [instagram, setInstagram] = useState('');
  const [telegram, setTelegram]   = useState('');
  const [twitter, setTwitter]     = useState('');
  const [discord, setDiscord]     = useState('');

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [notBurner, setNotBurner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account) return;
      setLoadingProfile(true);
      try {
        const res = await fetch(`${INDEXER_URL}/burners/${account.toLowerCase()}`);
        if (res.status === 404) {
          if (!cancelled) setNotBurner(true);
          return;
        }
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        if (cancelled) return;
        setPseudo(data.pseudo || '');
        setBio(data.message || '');
        setInstagram(data.instagram || '');
        setTelegram(data.telegram || '');
        setTwitter(data.twitter || '');
        setDiscord(data.discord || '');
      } catch (e) {
        console.error('Load profile error', e);
        if (!cancelled) setError('Could not load your current profile.');
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const handleSave = async () => {
    if (!account || !signer) return;
    setError('');

    if (pseudo.length > LIMITS.pseudo) return setError(`Pseudo must be <= ${LIMITS.pseudo} characters.`);
    if (bio.length > LIMITS.bio) return setError(`Message must be <= ${LIMITS.bio} characters.`);
    for (const [label, val] of [['Instagram', instagram], ['Telegram', telegram], ['Twitter', twitter], ['Discord', discord]]) {
      if (val.length > LIMITS.social) return setError(`${label} must be <= ${LIMITS.social} characters.`);
    }

    setSaving(true);
    try {
      const addr = account.toLowerCase();
      const timestamp = Math.floor(Date.now() / 1000);
      const fields: ProfileFields = { pseudo, bio, instagram, telegram, twitter, discord };
      const messageToSign = buildProfileMessage(addr, fields, timestamp);
      const signature = await signer.signMessage(messageToSign);

      const res = await fetch(`${INDEXER_URL}/burners/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: addr,
          signature,
          timestamp,
          pseudo,
          message: bio,
          instagram,
          telegram,
          twitter,
          discord,
        }),
      });
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to save profile');

      onSaved?.();
      onClose();
    } catch (e) {
      const err = e as Error;
      console.error('Save profile error', err);
      const msg = /reject/i.test(err.message || '') ? 'Signature cancelled.' : (err.message || 'Failed to save profile');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'rgba(0,0,0,0.85)', zIndex: 1100,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0d0d14', border: '1px solid #00d4ff',
          padding: 24, borderRadius: 16, width: 340,
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 0 30px rgba(0,212,255,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ color: '#fff', textAlign: 'center', marginTop: 0, marginBottom: 4 }}>✏️ Edit my profile</h2>
        <p style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', fontFamily: "'Space Mono', monospace", marginBottom: 20 }}>
          {shortAddr(account ?? '')}
        </p>

        {loadingProfile ? (
          <p style={{ color: '#6b7280', textAlign: 'center', fontSize: 13 }}>Loading...</p>
        ) : notBurner ? (
          <p style={{ color: '#f59e0b', textAlign: 'center', fontSize: 13, lineHeight: 1.5 }}>
            You need to freeze at least one pixel before you can set up a profile.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pseudo" value={pseudo} onChange={setPseudo} maxLength={LIMITS.pseudo} placeholder="Your display name" />
            <Field label="Message" value={bio} onChange={setBio} maxLength={LIMITS.bio} placeholder="A short message..." textarea />
            <Field label="Twitter / X" value={twitter} onChange={setTwitter} maxLength={LIMITS.social} placeholder="@handle" />
            <Field label="Instagram" value={instagram} onChange={setInstagram} maxLength={LIMITS.social} placeholder="@handle" />
            <Field label="Telegram" value={telegram} onChange={setTelegram} maxLength={LIMITS.social} placeholder="@handle" />
            <Field label="Discord" value={discord} onChange={setDiscord} maxLength={LIMITS.social} placeholder="username" />

            {error && (
              <div style={{ color: '#ef4444', fontSize: 12, padding: '8px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
              style={{
                width: '100%', marginTop: 4, padding: 10, borderRadius: 8,
                fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Signing & saving...' : 'Save profile'}
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: 12, padding: 10,
            background: 'transparent', border: '1px solid #374151',
            color: '#fff', borderRadius: 8, cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  maxLength: number;
  placeholder: string;
  textarea?: boolean;
}

function Field({ label, value, onChange, maxLength, placeholder, textarea }: FieldProps) {
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 10, color: '#4b5563', fontFamily: "'Space Mono', monospace" }}>
          {value.length}/{maxLength}
        </span>
      </div>
      <Tag
        value={value}
        onChange={e => onChange(e.target.value.slice(0, maxLength))}
        placeholder={placeholder}
        rows={textarea ? 3 : undefined}
        style={{
          width: '100%', background: '#12121a',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 12px',
          color: '#fff', fontSize: 12, outline: 'none',
          resize: textarea ? 'vertical' : 'none',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}