import axios from "axios"

interface DesignData {
	colors: string[]
}

interface Color {
	r: number
	g: number
	b: number
	a?: number
}
interface FigmaNode {
	id: string
	name: string
	type: string
	fills?: Array<{
		type: string
		color: Color
		visible?: boolean
	}>
	background?: Array<{
		type: string
		color: Color
	}>
	strokes?: Array<{
		type: string
		color: Color
	}>
	children?: FigmaNode[]
}

export interface FigmaFile {
	document: any
	name: string
	lastModified: string
	thumbnailUrl: string
	version: string
	role: string
	components: any
	componentsSets: any
	styles: any
}

function parseFigmaJson(figmaJson: { document: FigmaNode }): DesignData {
	const result = {
		colors: new Set<string>(),
	}

	function traverse(node: FigmaNode): void {
		// Extract colors from fills
		if (node.fills?.length) {
			node.fills
				.filter((fill) => fill?.type === "SOLID" && fill.visible !== false)
				.forEach((fill) => {
					if (fill.color) {
						const colorHex = rgbaToHex(fill.color)
						result.colors.add(colorHex)
					}
				})
		}

		// Extract colors from backgrounds
		if (node.background?.length) {
			node.background
				.filter((bg) => bg?.type === "SOLID")
				.forEach((bg) => {
					if (bg.color) {
						const colorHex = rgbaToHex(bg.color)
						result.colors.add(colorHex)
					}
				})
		}

		// Extract colors from strokes
		if (node.strokes?.length) {
			node.strokes
				.filter((stroke) => stroke?.type === "SOLID")
				.forEach((stroke) => {
					if (stroke.color) {
						const colorHex = rgbaToHex(stroke.color)
						result.colors.add(colorHex)
					}
				})
		}

		// Recursively process children
		node.children?.forEach((child) => traverse(child))
	}

	traverse(figmaJson.document)
	return {
		colors: Array.from(result.colors),
	}
}

function rgbaToHex(color: Color): string {
	const r = Math.round(color.r * 255)
	const g = Math.round(color.g * 255)
	const b = Math.round(color.b * 255)
	const a = color.a !== undefined ? Math.round(color.a * 255) : 255

	const hex = [r, g, b, a].map((x) => x.toString(16).padStart(2, "0")).join("")

	return `#${hex.slice(0, 6)}${a === 255 ? "" : hex.slice(6)}`
}

export class FigmaService {
	private readonly baseUrl = "https://api.figma.com/v1"

	constructor(private accessToken: string) {}

	async getFile(fileId: string, nodeId: string): Promise<FigmaFile> {
		try {
			console.log(this.accessToken)

			const response = await axios.get(`${this.baseUrl}/files/${fileId}?ids=${nodeId}`, {
				headers: {
					"X-Figma-Token": this.accessToken,
				},
			})
			return response.data
		} catch (error) {
			console.error("Error fetching Figma file:", error)
			throw new Error("Failed to fetch Figma file")
		}
	}

	async getImage(fileId: string, nodeId: string) {
		try {
			const response = await axios.get(`${this.baseUrl}/images/${fileId}?ids=${nodeId}&format=png`, {
				headers: {
					"X-Figma-Token": this.accessToken,
				},
			})

			if (response.data.err) {
				throw new Error(response.data.err)
			}
			console.log("Figma API Response:", response.data.images)
			const images = response.data.images || {}
			const imageUrl = images[nodeId.replace("-", ":")]
			if (!imageUrl) {
				throw new Error(`No image URL returned from Figma for node ${nodeId}`)
			}

			// Download the image and convert to base64
			const imageResponse = await axios.get(imageUrl, {
				responseType: "arraybuffer",
			})
			const base64 = Buffer.from(imageResponse.data, "binary").toString("base64")
			return { base64: `data:image/png;base64,${base64}`, url: imageUrl }
		} catch (error) {
			console.error("Error fetching Figma image:", error)
			throw new Error("Failed to fetch Figma image")
		}
	}

	async parseFileForDevelopment(fileId: string, nodeId: string | null): Promise<string> {
		try {
			if (!nodeId) {
				throw new Error("Please Give Specific Page It is too big to process all pages")
			}
			const file = await this.getFile(fileId, nodeId)
			const colors = parseFigmaJson(file)
			return JSON.stringify(colors, null, 2)
		} catch (error) {
			console.error("Error parsing Figma file:", error)
			throw new Error(error.message)
		}
	}

	static extractFileId(url: string): string | null {
		const match = url.split("/").at(4)
		return match ?? null
	}
	static extractNodeId(url: string): string | null {
		const match = url
			.split("?")
			.at(1)
			?.split("&")
			.find((param) => param.startsWith("node-id="))
			?.split("=")[1]
		return match ?? null
	}
}
