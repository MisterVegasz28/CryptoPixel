import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import React from "react";
import "./BetaGate.css";

export function BetaGate({ children }: { children: ReactNode }) {
    const { isConnected } = useAccount();
    const [guestMode, setGuestMode] = useState(false);

    if (!isConnected && !guestMode) {
        return (
            <div className="beta-gate">
                <PixelField />
                <div className="beta-gate__content">
                    <span className="beta-gate__eyebrow">Polygon mainnet</span>
                    <h1 className="beta-gate__title">
                        CryptoPixel
                        <span className="beta-gate__cursor" aria-hidden="true" />
                    </h1>
                    <p className="beta-gate__subtitle">
                        Connect your wallet to get started.
                    </p>
                    <div className="beta-gate__connect">
                        <ConnectButton />
                    </div>
                    <button
                        onClick={() => setGuestMode(true)}
                        className="beta-gate__guest-link"
                    >
                        Continue without connecting
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

/**
 * Grille de pixels qui s'allument aléatoirement en arrière-plan,
 * clin d'œil au canvas collaboratif du produit lui-même.
 */
const HUES = ["262", "189", "330", "45", "155"] as const;

function PixelField() {
    const columns = 24;
    const rows = 14;
    const cells = Array.from({ length: columns * rows });

    return (
        <div
            className="beta-gate__field"
            style={{ ["--cols" as string]: columns, ["--rows" as string]: rows }}
            aria-hidden="true"
        >
            {cells.map((_, i) => (
                <span
                    key={i}
                    className="beta-gate__pixel"
                    style={{
                        animationDelay: `${(Math.random() * -6).toFixed(2)}s`,
                        ["--hue" as string]: HUES[Math.floor(Math.random() * HUES.length)],
                    }}
                />
            ))}
        </div>
    );
}