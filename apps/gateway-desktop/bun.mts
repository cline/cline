/// <reference types="@types/bun" />
// Production build orchestrator: static webview export + broker sidecar.
import { $ } from "bun";

await $`next build webview`;
await $`bun run build:broker:bin`;
