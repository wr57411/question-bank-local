declare module '*.css' {
  const content: string;
  export default content;
}

declare const __TEST_PHONE__: string;
declare const __TEST_PASSWORD__: string;

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
