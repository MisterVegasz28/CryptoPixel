import React, { useState } from 'react';
import { X, ArrowRight, ArrowLeft, Sparkles, Wifi, Check, AlertTriangle } from 'lucide-react';

const TUTORIAL_STORAGE_KEY = 'cp-tutorial-seen';
let sessionSeenFallback = false;

type NetworkStatus = 'idle' | 'pending' | 'success' | 'error';

interface TutorialStep {
  title: string;
  content: string;
  isNetworkStep?: boolean;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to CryptoPixel',
    content: 'A shared canvas of 1 billion pixels. Paint for free, or freeze pixels forever on the blockchain. Let\'s do a quick tour.',
  },
  {
    title: 'Connect to Polygon (CryptoPixel)',
    content: 'We\'ll add a dedicated "Polygon (CryptoPixel)" network to your wallet, tuned for reliable painting and freezing. Heads up: this network only works for CryptoPixel — it can\'t be used to interact with other apps or contracts on Polygon. If you already have a regular Polygon network configured, keep it — just switch between the two depending on what you\'re using.',
    isNetworkStep: true,
  },
  {
    title: 'Explore the canvas',
    content: 'Drag to pan around, scroll to zoom. Use the "Go to…" button in the bottom-left corner to jump straight to any coordinates.',
  },
  {
    title: 'Paint for free',
    content: 'Pick a color, click any pixel, then hit "Paint" to save your drawing off-chain. Anyone can repaint over an unfrozen pixel later.',
  },
  {
    title: 'Freeze forever',
    content: 'Freezing burns PAINT tokens and writes the pixel permanently on-chain. Once frozen, it\'s yours forever and can\'t be repainted by anyone else.',
  },
  {
    title: 'Freeze a whole zone',
    content: 'Toggle Zone Mode, drag a rectangle over your painted pixels, and freeze them all in a single transaction.',
  },
  {
    title: 'Track your pixels',
    content: 'The "My Pixels" tab shows everything you own. You can always replay this tutorial later from Settings.',
  },
];

interface TutorialProps {
  onClose: () => void;
  onAddNetwork: () => Promise<void>;
}

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'true';
  } catch {
    return sessionSeenFallback;
  }
}

export default function Tutorial({ onClose, onAddNetwork }: TutorialProps) {
  const [step, setStep] = useState(0);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('idle');
  const [networkErrorMsg, setNetworkErrorMsg] = useState<string | null>(null);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  const finish = () => {
    try {
      localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    } catch {
      sessionSeenFallback = true;
    }
    onClose();
  };

  const addPolygonNetwork = async () => {
    setNetworkStatus('pending');
    setNetworkErrorMsg(null);
    try {
      await onAddNetwork();
      setNetworkStatus('success');
    } catch (err: unknown) {
      setNetworkStatus('error');
      const code = (err as { code?: number })?.code;
      const message = err instanceof Error ? err.message : undefined;
      setNetworkErrorMsg(
        code === 4001
          ? 'Request rejected. You can retry, or configure it later from your wallet settings.'
          : message ?? 'Failed to switch network. You can add it manually in your wallet settings.'
      );
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--color-primary-border)',
        borderRadius: 16, padding: 28, width: 380,
        boxShadow: '0 0 30px var(--color-primary-glow)',
        position: 'relative',
      }}>
        <button
          onClick={finish}
          title="Skip tutorial"
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex',
          }}
        >
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="var(--color-primary)" />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 1 }}>
            STEP {step + 1} / {STEPS.length}
          </span>
        </div>

        <h2 style={{ color: 'var(--text-primary)', fontSize: 18, margin: '0 0 10px' }}>
          {current.title}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: current.isNetworkStep ? 16 : 24 }}>
          {current.content}
        </p>

        {current.isNetworkStep && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={addPolygonNetwork}
              disabled={networkStatus === 'pending' || networkStatus === 'success'}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 8, cursor: networkStatus === 'success' ? 'default' : 'pointer',
                border: '1px solid var(--color-primary-border)',
                background: 'var(--bg-surface-2)',
                color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
                opacity: networkStatus === 'pending' ? 0.7 : 1,
              }}
            >
              {networkStatus === 'success' ? (
                <><Check size={14} color="var(--color-primary)" /> Network added</>
              ) : networkStatus === 'pending' ? (
                'Confirm in your wallet…'
              ) : (
                <><Wifi size={14} /> Add Polygon to my wallet</>
              )}
            </button>

            {networkStatus === 'error' && (
              <div style={{
                display: 'flex', gap: 6, marginTop: 8, padding: '8px 10px',
                borderRadius: 6, background: 'rgba(255,100,100,0.08)',
                border: '1px solid rgba(255,100,100,0.25)',
              }}>
                <AlertTriangle size={13} color="#ff6464" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11.5, color: '#ff9a9a', lineHeight: 1.5 }}>
                  {networkErrorMsg}
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
          {STEPS.map((s, i) => (
            <span key={s.title} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: i === step ? 'var(--color-primary)' : 'var(--border-default)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)',
                color: 'var(--text-primary)', fontSize: 13,
              }}
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <button
            onClick={() => isLast ? finish() : setStep(s => s + 1)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 14px', borderRadius: 8, cursor: 'pointer', border: 'none',
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-border))',
              color: '#000', fontWeight: 700, fontSize: 13,
            }}
          >
            {isLast ? 'Start painting!' : <>Next <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}