declare namespace Deno {
  export const args: string[];
  export function exit(code?: number): never;
  export const env: {
    get(key: string): string | undefined;
  };
  export function cwd(): string;
  export function readTextFile(path: string): Promise<string>;
  export function writeTextFile(path: string, data: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readDir(path: string): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
  }>;
  export function stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
  }>;
  export class Command {
    constructor(cmd: string, options?: {
      args?: string[];
      stdout?: "piped";
      stderr?: "piped";
    });
    output(): Promise<{
      stdout: Uint8Array;
      stderr: Uint8Array;
    }>;
  }
  export const permissions: {
    query(desc: { name: string; path?: string }): Promise<{ state: "granted" | "denied" }>;
  };
  export const errors: {
    PermissionDenied: typeof Error;
  };
  export const stdout: {
    write(data: Uint8Array): Promise<number>;
  };
}
