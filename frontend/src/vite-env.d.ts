/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "snapshot" builds the static public version that reads /snapshot/*.json. */
  readonly VITE_DATA_MODE?: "live" | "snapshot";
}
