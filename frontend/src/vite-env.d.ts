/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INDEXER_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PRIVY_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import('ethers').Eip1193Provider & {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
}