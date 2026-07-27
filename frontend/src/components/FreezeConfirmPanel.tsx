import React from 'react';
import { AlertTriangle, Snowflake } from 'lucide-react';

interface FreezeConfirmPanelProps {
    title: string;
    pixelCount: number;
    cost: number;
    disabled?: boolean;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    glassPanel?: React.CSSProperties;   // ← optionnel maintenant
    zoomBtnBase?: (busy: boolean) => React.CSSProperties;  // ← optionnel
    inline?: boolean;   // ← nouveau : true = flux normal, false/absent = overlay canvas
}

export default function FreezeConfirmPanel({
    title, pixelCount, cost, disabled, busy, onCancel, onConfirm, glassPanel, zoomBtnBase, inline,
}: FreezeConfirmPanelProps) {
    const containerStyle: React.CSSProperties = inline
        ? {
            border: '1px solid var(--color-purple-border)',
            borderRadius: 12, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
            fontSize: 12, background: 'var(--bg-hover)',
        }
        : {
            position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
            ...glassPanel,
            border: '1px solid var(--color-purple-border)',
            borderRadius: 16, padding: '18px 22px',
            display: 'flex', flexDirection: 'column', gap: 14,
            fontSize: 13, zIndex: 60, minWidth: 320,
        };

    const cancelBtnStyle: React.CSSProperties = zoomBtnBase
        ? { ...zoomBtnBase(!!busy), flex: 1 }
        : {
            flex: 1, padding: '9px 0', borderRadius: 8,
            background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)',
            color: 'var(--text-primary)', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
        };

    return (
        <div onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} style={containerStyle}>
            <span style={{ color: 'var(--color-purple)', fontSize: 11, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Snowflake size={13} /> {title}
            </span>

            <div style={{ background: 'var(--color-red-dim)', border: '1px solid var(--color-red-border)', borderRadius: 10, padding: '10px 12px', color: 'var(--color-red-text)', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                    <strong>Warning:</strong> this action is irreversible. {pixelCount > 1 ? `These ${pixelCount} pixel(s)` : 'This pixel'} will be permanently etched on the blockchain.
                    {` Cost: `}<strong>{cost} PAINT</strong>{` (burned forever).`}
                </span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onCancel} disabled={busy} style={cancelBtnStyle}>Cancel</button>
                <button
                    onClick={onConfirm}
                    disabled={disabled}
                    style={{ flex: 2, padding: '9px 0', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, background: disabled ? 'var(--color-purple-dim)' : 'linear-gradient(135deg, var(--color-purple), var(--color-purple-dark))', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                    {busy ? 'Freezing...' : <><Snowflake size={14} /> Confirm freeze</>}
                </button>
            </div>
        </div>
    );
}