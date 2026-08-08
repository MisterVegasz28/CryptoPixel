import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useBetaAccess } from "../hooks/useBetaAccess";
import type { ReactNode } from "react";
import React from "react";
import "./BetaGate.css";

export function BetaGate({ children }: { children: ReactNode }) {
    const { isConnected } = useAccount();
    const status = useBetaAccess();

    if (!isConnected) {
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
                        Closed Beta. Connect your wallet to check your access.
                    </p>
                    <div className="beta-gate__connect">
                        <ConnectButton />
                    </div>
                </div>
            </div>
        );
    }

    if (status === "loading") {
        return (
            <div className="beta-gate">
                <PixelField />
                <div className="beta-gate__content">
                    <p className="beta-gate__status beta-gate__status--loading">
                        Verifying access...
                        <span className="beta-gate__dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </span>
                    </p>
                </div>
            </div>
        );
    }

    if (status === "denied") {
        return (
            <div className="beta-gate">
                <PixelField />
                <div className="beta-gate__content">
                    <span className="beta-gate__eyebrow beta-gate__eyebrow--denied">
                        Access denied
                    </span>
                    <h1 className="beta-gate__title">CryptoPixel</h1>
                    <p className="beta-gate__subtitle">
                        This wallet is not whitelisted for the closed beta.
                    </p>
                    <div className="beta-gate__connect">
                        <a
                            href="https://discord.gg/XDwZ33KHGG"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="beta-gate__discord-link"
                        >
                            Join our Discord and request access!
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    if (status !== "allowed") return null;

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