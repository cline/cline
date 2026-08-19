import { rm } from "node:fs/promises"
import path from "node:path"

const viteCachePath = path.join(import.meta.dirname, "..", "webview-ui", "node_modules", ".vite")

await rm(viteCachePath, { recursive: true, force: true })
