/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
