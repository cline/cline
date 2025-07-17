/**
 * Utility function to append new images to existing images array
 * while respecting the maximum image limit
 *
 * @param currentImages - The current array of images
 * @param newImages - The new images to append
 * @param maxImages - The maximum number of images allowed
 * @returns The updated images array
 */
export function appendImages(currentImages: string[], newImages: string[] | undefined, maxImages: number): string[] {
	const imagesToAdd = newImages ?? []
	if (imagesToAdd.length === 0) {
		return currentImages
	}

	return [...currentImages, ...imagesToAdd].slice(0, maxImages)
}
