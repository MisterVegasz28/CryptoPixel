import { Snowflake, Sparkles, Gem, Crown, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Raccourcit une adresse pour l'affichage (0xAbCd...1234).
 * Accepte null/undefined pour éviter de re-écrire une garde à chaque call site.
 */
export function shortAddr(a: string | null | undefined): string {
    if (!a) return '';
    return a.slice(0, 6) + '...' + a.slice(-4);
}

/** Formatte un nombre avec séparateurs de milliers (en-US). */
export function fmtNum(n: number): string {
    return n.toLocaleString('en-US');
}

export interface Badge {
    icon: LucideIcon;
    label: string;
    color: string;
}

interface BadgeTier extends Badge {
    threshold: number;
}

// Source unique de vérité pour les paliers de badges — getBadge() et l'UI
// (liste des paliers dans le popover, etc.) lisent tous les deux ce tableau,
// donc plus jamais besoin de synchroniser deux implémentations à la main.
export const BADGE_TIERS: BadgeTier[] = [
    { icon: Snowflake, label: 'Novice', threshold: 1, color: '#7dd3fc' },
    { icon: Sparkles, label: 'Freezer', threshold: 10, color: '#38bdf8' },
    { icon: Gem, label: 'Elite', threshold: 50, color: '#a78bfa' },
    { icon: Crown, label: 'Master', threshold: 200, color: '#facc15' },
    { icon: Star, label: 'Legend', threshold: 1000, color: '#f97316' },
];

/** Retourne le badge le plus élevé atteint pour un nombre de pixels gelés donné. */
export function getBadge(frozenCount: number): Badge | null {
    let result: Badge | null = null;
    for (const tier of BADGE_TIERS) {
        if (frozenCount >= tier.threshold) result = tier;
    }
    return result;
}