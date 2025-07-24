import { HostProvider } from "@/hosts/host-provider"

/**
 * Supports processing of images and other file types
 * For models which don't support images, will not allow them to be selected
 */
export async function selectFiles(imagesAllowed: boolean): Promise<{ images: string[]; files: string[] }> {
	// Use HostProvider.file.selectFiles() which will route to the correct implementation
	// (VSCode native API, IntelliJ hostbridge, etc.)
	const response = await HostProvider.file.selectFiles({ value: imagesAllowed })

	// The hostbridge returns StringArrays with:
	// values1: image data URLs (base64)
	// values2: file paths
	const images = response.values1 || []
	const files = response.values2 || []

	return { images, files }
}
