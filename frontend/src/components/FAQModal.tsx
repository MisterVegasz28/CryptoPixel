import React, { useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';

const FAQ_ITEMS = [
    { q: "What's the difference between painting and freezing?", a: "Painting is free and off-chain — anyone can repaint over an unfrozen pixel later. Freezing permanently etches the pixel on the blockchain, burns PAINT, and makes it impossible for anyone else to repaint." },
    { q: "Is freezing reversible?", a: "No, never. Once frozen, a pixel is yours forever and can't change owner." },
    { q: "How does the PAINT balance work?", a: "1 PAINT = 1 pixel you own off-chain (painted). Freezing a pixel additionally burns 1 PAINT per pixel, permanently." },
    { q: "How do I unlock the airdrop?", a: "You need to meet every condition shown in the Airdrop tab: a minimum balance, frozen pixels, and a global canvas milestone." },
    // ... complète avec le reste de ton contenu
];

function FAQItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ borderBottom: '1px solid var(--border-default)', padding: '10px 0' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, padding: 0, textAlign: 'left',
                }}
            >
                {q}
                <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
            </button>
            {open && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{a}</p>}
        </div>
    );
}

export default function FAQModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    if (!isOpen) return null;
    return (
        <div
            style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'var(--overlay-bg)', zIndex: 1200, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
        >
            <div
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--color-primary-border)', padding: 24, borderRadius: 16, width: 380, maxHeight: '80vh', overflowY: 'auto' }}
                onClick={e => e.stopPropagation()}
            >
                <h2 style={{ color: 'var(--text-primary)', textAlign: 'center', marginTop: 0, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <HelpCircle size={18} color="var(--color-primary)" /> FAQ
                </h2>
                {FAQ_ITEMS.map((item, i) => <FAQItem key={i} {...item} />)}
                <button onClick={onClose} style={{ width: '100%', marginTop: 20, padding: 10, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                    Close
                </button>
            </div>
        </div>
    );
}