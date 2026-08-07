import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

export function useBetaAccess() {
    const { address, isConnected } = useAccount();
    const [status, setStatus] = useState<"idle" | "loading" | "allowed" | "denied">("idle");

    useEffect(() => {
        if (!isConnected || !address) {
            setStatus("idle");
            return;
        }
        setStatus("loading");
        fetch(`/.netlify/functions/check-allowlist?address=${address}`)
            .then((r) => r.json())
            .then((data) => setStatus(data.allowed ? "allowed" : "denied"))
            .catch(() => setStatus("denied"));
    }, [address, isConnected]);

    return status;
}