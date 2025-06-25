# JSON File Writing Must Be Atomic

- You MUST use `safeWriteJson(filePath: string, data: any): Promise<void>` from `src/utils/safeWriteJson.ts` instead of `JSON.stringify` with file-write operations
- `safeWriteJson` will create parent directories if necessary, so do not call `mkdir` prior to `safeWriteJson`
- `safeWriteJson` prevents data corruption via atomic writes with locking and streams the write to minimize memory footprint
- Test files are exempt from this rule
