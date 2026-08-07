import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useBetaAccess } from "../hooks/useBetaAccess";
import type { ReactNode } from "react";
import React from "react";

export function BetaGate({ children }: { children: ReactNode }) {
    const { isConnected } = useAccount();
    const status = useBetaAccess();

    if (!isConnected) {
        return (
            <div className="beta-gate">
                <h1>Beta fermée 🔒</h1>
                <ConnectButton />
            </div>
        );
    }

    if (status === "loading") return <p>Vérification de ton accès...</p>;
    if (status === "denied") return <p>Ce wallet n est pas whitelisté pour la beta.</p>;
    if (status !== "allowed") return null;

    return <>{children}</>;
}