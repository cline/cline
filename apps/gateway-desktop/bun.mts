/// <reference types="@types/bun" />
// Production build orchestrator: static webview export + native sidecars.
import { $ } from "bun";

await $`next build webview`;
await $`GATEWAY_DESKTOP_PREPARE_SIGNING=1 bun run build:sidecars`;
