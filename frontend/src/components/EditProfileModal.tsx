import React, { useState, useEffect } from 'react';
import { Signer } from 'ethers';
import { INDEXER_URL } from '../App';
import { Pencil } from 'lucide-react';
import { shortAddr } from '../lib/format';

const LIMITS = { pseudo: 32, bio: 280, social: 64 };

interface EditProfileModalProps {
  account: string | null;
  signer: Signer | null;
  onClose: () => void;
  onSaved?: () => void;
  initialProfile?: IncomingProfileData | null;
  initialNotBurner?: boolean;
}

interface IncomingProfileData {
  pseudo: string;
  message: string;
  instagram: string;
  telegram: string;
  twitter: string;
  discord: string;
}

function EditProfileModal({ account, signer, onClose, onSaved, initialProfile, initialNotBurner }: EditProfileModalProps) {
  const [pseudo, setPseudo] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [telegram, setTelegram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [discord, setDiscord] = useState('');

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notBurner, setNotBurner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account) return;

      // Header a déjà chargé ce profil pour ce compte — on réutilise
      // au lieu de refaire le même appel réseau.
      if (initialProfile) {
        setPseudo(initialProfile.pseudo);
        setBio(initialProfile.message);
        setInstagram(initialProfile.instagram);
        setTelegram(initialProfile.telegram);
        setTwitter(initialProfile.twitter);
        setDiscord(initialProfile.discord);
        setLoadingProfile(false);
        return;
      }
      if (initialNotBurner) {
        setNotBurner(true);
        setLoadingProfile(false);
        return;
      }

      // Fallback : Header n'a pas encore fini son fetch (race au tout
      // premier rendu après connexion) — on refait l'appel nous-mêmes.
      setLoadingProfile(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${INDEXER_URL}/burners/${account.toLowerCase()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
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
  }, [account, initialProfile, initialNotBurner]);

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
      const domain = { name: 'CryptoPixel', version: '1', chainId: Number(import.meta.env.VITE_TARGET_CHAIN_ID), verifyingContract: import.meta.env.VITE_CONTRACT_ADDRESS };
      const types = {
        Profile: [
          { name: 'painter', type: 'address' },
          { name: 'pseudo', type: 'string' },
          { name: 'message', type: 'string' },
          { name: 'instagram', type: 'string' },
          { name: 'telegram', type: 'string' },
          { name: 'twitter', type: 'string' },
          { name: 'discord', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      };
      const value = { painter: addr, pseudo, message: bio, instagram, telegram, twitter, discord, timestamp };
      const signature = await signer.signTypedData(domain, types, value);

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
        background: 'var(--overlay-bg)', zIndex: 1100,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--color-primary)',
          padding: 24, borderRadius: 16, width: 340,
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 0 30px var(--color-primary-glow)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ color: 'var(--text-primary)', textAlign: 'center', marginTop: 0, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Pencil size={18} color="var(--color-primary)" /> Edit my profile
        </h2>
        <p style={{
          color: 'var(--text-faint)', fontSize: 11, textAlign: 'center',
          fontFamily: "'Space Mono', monospace", marginBottom: 20,
        }}>
          {shortAddr(account)}
        </p>

        {loadingProfile ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>Loading...</p>
        ) : notBurner ? (
          <p style={{ color: 'var(--color-amber)', textAlign: 'center', fontSize: 13, lineHeight: 1.5 }}>
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
              <div style={{
                color: 'var(--color-red)', fontSize: 12,
                padding: '8px 10px',
                background: 'var(--color-red-dim)',
                border: '1px solid var(--color-red-border)',
                borderRadius: 8,
              }}>
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
  const fieldId = `profile-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label htmlFor={fieldId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Space Mono', monospace" }}>
          {value.length}/{maxLength}
        </span>
      </div>
      <Tag
        id={fieldId}
        name={fieldId}
        value={value}
        onChange={e => onChange(e.target.value.slice(0, maxLength))}
        placeholder={placeholder}
        rows={textarea ? 3 : undefined}
        style={{
          width: '100%',
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: 8, padding: '8px 12px',
          color: 'var(--text-primary)', fontSize: 12, outline: 'none',
          resize: textarea ? 'vertical' : 'none',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    </label>
  );
}
export default React.memo(EditProfileModal);