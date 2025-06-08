# JSON File Writing Must Be Atomic

- MUST ALWAYS use `safeWriteJson(filePath: string, data: any): Promise<void>` from `src/utils/safeWriteJson.ts` instead of `JSON.stringify` with file-write operations
- `safeWriteJson` prevents data corruption via atomic writes with locking and streams the write to minimize memory footprint
- Test files are exempt from this rule
