// Déclarations minimales des modules de Node utilisés par les tests (le projet n'embarque pas @types/node).
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
