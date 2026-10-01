/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Public Key of your domain (Integration > API keys in the analytics dashboard). */
  readonly VITE_SHIELDLABS_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
