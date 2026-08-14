// Multichat: deterministic per-backend colors for the chat transcript. Purely
// a function of the backend's name (a simple string hash into a fixed
// palette), so a color stays stable across renames-elsewhere-in-state,
// reordering, or a backend later being deleted from settings — it never
// depends on lookup against the current settings list.
const PALETTE = [
	"#e57373", // red
	"#64b5f6", // blue
	"#81c784", // green
	"#ffb74d", // orange
	"#ba68c8", // purple
	"#4db6ac", // teal
	"#f06292", // pink
	"#a1887f", // brown
	"#90a4ae", // slate
	"#dce775", // lime
]

export function backendColor(name: string | undefined): string | undefined {
	const trimmed = name?.trim()
	if (!trimmed) {
		return undefined
	}
	let hash = 0
	for (let i = 0; i < trimmed.length; i++) {
		hash = (hash * 31 + trimmed.charCodeAt(i)) | 0
	}
	return PALETTE[Math.abs(hash) % PALETTE.length]
}
