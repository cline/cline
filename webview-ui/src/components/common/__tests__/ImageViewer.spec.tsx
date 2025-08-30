// npx vitest run src/components/common/__tests__/ImageViewer.spec.tsx

import { render, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { ImageViewer } from "../ImageViewer"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Import the mocked vscode after the mock is set up
import { vscode } from "@src/utils/vscode"

describe("ImageViewer", () => {
	it("should render image with webview URI", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(webviewUri)
		expect(img?.alt).toBe("Test image")
	})

	it("should render image with vscode-resource URI", () => {
		const vscodeResourceUri = "vscode-resource://file///path/to/image.png"
		const { container } = render(<ImageViewer imageUri={vscodeResourceUri} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(vscodeResourceUri)
	})

	it("should handle base64 images", () => {
		const base64Image =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
		const { container } = render(<ImageViewer imageUri={base64Image} alt="Base64 image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(base64Image)
	})

	it("should use imageUri for rendering and imagePath for display", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const filePath = "/Users/test/project/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		// Should use imageUri for src
		expect(img?.src).toBe(webviewUri)

		// Should display imagePath below image
		const pathElement = container.querySelector(".text-xs.text-vscode-descriptionForeground")
		expect(pathElement).toBeTruthy()
		expect(pathElement?.textContent).toContain("image.png")
	})

	it("should handle click to open in editor", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const filePath = "/Users/test/project/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()

		// Clear previous calls
		vi.clearAllMocks()

		// Click the image
		fireEvent.click(img!)

		// Check if vscode.postMessage was called to open the image with the actual path
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openImage",
			text: filePath,
		})
	})

	it("should handle error state gracefully", () => {
		const invalidUri = "invalid://uri"
		const { container } = render(<ImageViewer imageUri={invalidUri} alt="Invalid image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()

		// Trigger error event
		fireEvent.error(img!)

		// Image should still be rendered but might have error styling
		expect(img).toBeTruthy()
	})

	it("should show no image message when imageUri is empty", () => {
		const { container } = render(<ImageViewer imageUri="" alt="Empty image" />)

		// Should show no image message
		expect(container.textContent).toContain("common:image.noData")
	})

	it("should display path below image when provided", () => {
		const filePath = "/Users/test/rc1/path/to/image.png"
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		// Check if path is displayed as relative path
		const pathElement = container.querySelector(".text-xs.text-vscode-descriptionForeground")
		expect(pathElement).toBeTruthy()
		// Accept filename or relative path depending on environment
		expect(pathElement?.textContent).toContain("image.png")
	})
})
