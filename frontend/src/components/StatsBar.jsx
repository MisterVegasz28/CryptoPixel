import React, { useState, useEffect } from 'react';

export default function StatsBar({ totalSupply, totalFrozen, account, supabase, showFrozenOverlay, onToggleFrozenOverlay }) {
  // Supabase est passé en prop pour rester cohérent avec le reste de l'app
  // (un seul client partagé, créé dans App.jsx)

  const [paintedCount, setPaintedCount] = useState(null);

  // Mise à jour en temps réel via Supabase Realtime — visible sans wallet connecté.
  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    let channel;

    const fetchCount = async () => {
      try {
        const { count, error } = await supabase
          .from('offchain_canvas')
          .select('*', { count: 'exact', head: true });
        
        if (cancelled) return;

        if (error) {
          console.error("Supabase Error (fetchCount):", error.message);
          // Fallback : on met à 0 uniquement si on n'avait pas déjà une valeur
          setPaintedCount(prev => prev !== null ? prev : 0);
          return;
        }

        setPaintedCount(count ?? 0);
      } catch (err) {
        if (!cancelled) {
          console.error("Network Exception (fetchCount):", err);
          setPaintedCount(prev => prev !== null ? prev : 0);
        }
      }
    };

    // 1. Premier appel initial
    fetchCount();

    // 2. Création et souscription au canal avec un nom précis
    channel = supabase
      .channel('public:offchain_canvas:stats')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'offchain_canvas' }, 
        () => {
          // Relance le count à chaque modification (insert, update, delete)
          fetchCount();
        }
      )
      .subscribe((status, err) => {
        if (err) console.error("Erreur de souscription Realtime :", err);
      });

    // 3. Cleanup sécurisé au démontage du composant
    return () => {
      cancelled = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [supabase]);

  const formatSupply = (val) => {
    if (val === undefined || val === null) return '0';
    try {
      return parseFloat(val.toString()).toFixed(0);
    } catch (e) {
      return '0';
    }
  };

  const stats = [
    {
      label: 'Total PAINT Supply',
      value: formatSupply(totalSupply),
      color: '#00d4ff',
      icon: '◈'
    },
    {
      label: 'Painted Pixels',
      value: paintedCount === null ? '...' : paintedCount,
      color: '#ec4899',
      icon: '🎨'
    },
    {
      label: 'Frozen Pixels',
      value: totalFrozen || '0',
      color: '#a855f7',
      icon: '❄'
    },
  ];

  return (
    <div style={{
      display: 'flex', gap: 0,
      background: 'rgba(10,10,15,0.9)',
      borderBottom: '1px solid rgba(0,212,255,0.08)',
      height: 50, width: '100%', flexShrink: 0
    }}>
     {stats.map((s, i) => (
        <div key={i} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 20px',
          borderRight: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
        }}>
          <span style={{ fontSize: 14, color: s.color }}>{s.icon}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div>
              <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'Space Mono', monospace" }}>{s.value}</div>
            </div>
            {s.label === 'Frozen Pixels' && (
              <button
                onClick={onToggleFrozenOverlay}
                style={{
                  marginLeft: 'auto',
                  padding: '3px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'Space Mono', monospace",
                  cursor: 'pointer',
                  borderRadius: 6,
                  border: showFrozenOverlay
                    ? '1px solid rgba(168, 85, 247, 0.7)'
                    : '1px solid rgba(255,255,255,0.1)',
                  background: showFrozenOverlay
                    ? 'rgba(168, 85, 247, 0.2)'
                    : 'rgba(255,255,255,0.05)',
                  color: showFrozenOverlay ? '#c084fc' : '#6b7280',
                  transition: 'all 0.2s',
                }}
              >
                {showFrozenOverlay ? '❄️ ON' : '❄️ OFF'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}