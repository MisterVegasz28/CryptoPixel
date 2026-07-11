import React, { useState } from 'react';
import { X, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';

const TUTORIAL_STORAGE_KEY = 'cp-tutorial-seen';
// Filet de sécurité mémoire : si localStorage est inaccessible, on évite au
// moins que le tutoriel ne se redéclenche en boucle DANS la même session
// (ex: changement d'onglet, remount du composant App), sans pour autant
// priver silencieusement un nouvel utilisateur de l'onboarding.
let sessionSeenFallback = false;

interface TutorialStep {
  title: string;
  content: string;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to CryptoPixel',
    content: 'A shared canvas of 1 billion pixels. Paint for free, or freeze pixels forever on the blockchain. Let\'s do a quick tour.',
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
}

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'true';
  } catch {
    return sessionSeenFallback;
  }
}

export default function Tutorial({ onClose }: TutorialProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;

  const finish = () => {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
  } catch {
    sessionSeenFallback = true;
  }
  onClose();
};

  const current = STEPS[step];

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
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
          {current.content}
        </p>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
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