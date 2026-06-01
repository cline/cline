/**
 * In-memory cache for raster image payloads.
 *
 * Raster images can be several MB each — too large to ship through the
 * gRPC/proto metadata path. We keep them here and pass only a lightweight
 * sentinel through gRPC. The renderer looks here first.
 *
 * We store a pre-loaded `HTMLImageElement` (not a data URL string) because
 * deck.gl's BitmapLayer hands strings to `@loaders.gl/images` which uses
 * `fetch()` internally — and the VS Code webview CSP `connect-src` directive
 * does NOT permit `data:` URLs (only `https:` and the cspSource). Passing a
 * pre-loaded `HTMLImageElement` bypasses that fetch entirely, since image
 * loading goes through the `img-src` directive (which does allow `data:`).
 *
 * `rawPixels` stores the underlying Float32 band values so the user can
 * re-apply a different colormap without re-loading the file. Only available
 * for user-loaded GeoTIFFs; Python-pushed rasters arrive as pre-colored PNGs.
 *
 * Data survives for the lifetime of the webview page (lost on VS Code restart,
 * which is acceptable since the user can just reload the file).
 */

export interface RasterPixels {
	data: Float32Array
	width: number
	height: number
	min: number
	max: number
}

interface RasterEntry {
	image: HTMLImageElement
	bounds: [number, number, number, number]
	colormap?: string
	rawPixels?: RasterPixels
	stretchMin?: number
	stretchMax?: number
}

// ─── Colormap tables ─────────────────────────────────────────────────────────
// Each ramp is an array of [R, G, B] stops linearly interpolated across [0,1].

const COLORMAPS: Record<string, number[][]> = {
	viridis: [
		[68, 1, 84],
		[59, 82, 139],
		[33, 144, 141],
		[93, 201, 99],
		[253, 231, 37],
	],
	viridis_r: [
		[253, 231, 37],
		[93, 201, 99],
		[33, 144, 141],
		[59, 82, 139],
		[68, 1, 84],
	],
	YlOrRd: [
		[255, 255, 178],
		[254, 204, 92],
		[253, 141, 60],
		[227, 26, 28],
		[177, 0, 38],
	],
	Blues: [
		[247, 251, 255],
		[198, 219, 239],
		[107, 174, 214],
		[33, 113, 181],
		[8, 69, 148],
	],
	RdYlGn: [
		[215, 48, 39],
		[254, 224, 139],
		[217, 239, 139],
		[145, 207, 96],
		[26, 152, 80],
	],
	plasma: [
		[13, 8, 135],
		[126, 3, 168],
		[203, 71, 120],
		[248, 149, 64],
		[240, 249, 33],
	],
	magma: [
		[0, 0, 4],
		[62, 9, 102],
		[178, 24, 43],
		[251, 135, 97],
		[252, 253, 191],
	],
	cividis: [
		[0, 32, 76],
		[75, 88, 140],
		[149, 144, 155],
		[219, 192, 123],
		[253, 231, 55],
	],
}

function sampleRamp(ramp: number[][], t: number): [number, number, number] {
	const clamped = Math.max(0, Math.min(1, t))
	const x = clamped * (ramp.length - 1)
	const lo = Math.floor(x)
	const hi = Math.min(ramp.length - 1, lo + 1)
	const f = x - lo
	const a = ramp[lo]
	const b = ramp[hi]
	return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

// ─── Public API ──────────────────────────────────────────────────────────────

const cache = new Map<string, RasterEntry>()

/** Tracks layer IDs that have a colormap re-render in flight. */
const recolorInFlight = new Set<string>()

/** Convert a data URL to a fully loaded HTMLImageElement. */
export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = (e) => reject(new Error(`Failed to load image: ${String(e)}`))
		img.src = dataUrl
	})
}

/**
 * Render raw pixel values through a named colormap into an HTMLImageElement.
 * NaN / non-finite pixels become fully transparent.
 */
export function applyColormap(
	rawPixels: RasterPixels,
	colormapName: string,
	stretchMin?: number,
	stretchMax?: number,
): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const ramp = COLORMAPS[colormapName] ?? COLORMAPS["viridis"]
		const { data, width, height, min, max } = rawPixels
		const lo = stretchMin ?? min
		const hi = stretchMax ?? max
		const range = hi - lo || 1

		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext("2d")
		if (!ctx) {
			reject(new Error("No 2d context"))
			return
		}

		const imgData = ctx.createImageData(width, height)
		const nLen = data.length

		for (let i = 0; i < nLen; i++) {
			const v = data[i]
			const off = i * 4
			if (!Number.isFinite(v)) {
				imgData.data[off + 3] = 0
				continue
			}
			const t = (v - lo) / range
			const [r, g, b] = sampleRamp(ramp, t)
			imgData.data[off] = r
			imgData.data[off + 1] = g
			imgData.data[off + 2] = b
			imgData.data[off + 3] = 230
		}

		ctx.putImageData(imgData, 0, 0)

		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = (e) => reject(new Error(`Failed to load recolored image: ${String(e)}`))
		img.src = canvas.toDataURL("image/png")
	})
}

export const rasterCache = {
	set(id: string, entry: RasterEntry): void {
		cache.set(id, entry)
	},

	get(id: string): RasterEntry | undefined {
		return cache.get(id)
	},

	delete(id: string): void {
		cache.delete(id)
	},

	has(id: string): boolean {
		return cache.has(id)
	},
}

export const rasterRecolorInFlight = {
	has: (id: string): boolean => recolorInFlight.has(id),
	add: (id: string): void => {
		recolorInFlight.add(id)
	},
	delete: (id: string): void => {
		recolorInFlight.delete(id)
	},
}
