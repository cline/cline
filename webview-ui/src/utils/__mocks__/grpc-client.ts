// Mock gRPC clients for Storybook

// Mock WebServiceClient
export const WebServiceClient = {
	checkIsImageUrl: async (request: { value: string }) => {
		// Mock image URL detection - return true for common image extensions and placeholder URLs
		const url = request.value
		const isImage =
			/\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|tif|avif)$/i.test(url) ||
			url.includes("placeholder") ||
			url.includes("image") ||
			url.includes("via.placeholder.com") ||
			url.includes("picsum.photos") ||
			url.includes("unsplash.com")

		// Add a small delay to simulate network request
		await new Promise((resolve) => setTimeout(resolve, 100))

		return { isImage }
	},

	fetchOpenGraphData: async (request: { value: string }) => {
		// Mock Open Graph data for demo purposes with more realistic content
		const url = request.value
		let hostname: string

		try {
			hostname = new URL(url).hostname
		} catch {
			hostname = "example.com"
		}

		// Add a small delay to simulate network request
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Provide different mock data based on the URL
		if (url.includes("docs") || url.includes("documentation")) {
			return {
				title: `📚 Documentation - ${hostname}`,
				description: `Comprehensive documentation and guides for developers. Learn how to integrate and use our APIs effectively with detailed examples and best practices.`,
				image: `https://via.placeholder.com/400x300/28a745/ffffff?text=📚+Docs`,
				url: url,
				siteName: hostname,
				type: "website",
			}
		}

		if (url.includes("api") || url.includes("reference")) {
			return {
				title: `🔧 API Reference - ${hostname}`,
				description: `Complete API reference with endpoints, parameters, and response examples. Everything you need to integrate with our services.`,
				image: `https://via.placeholder.com/400x300/007bff/ffffff?text=🔧+API`,
				url: url,
				siteName: hostname,
				type: "website",
			}
		}

		if (url.includes("tutorial") || url.includes("guide")) {
			return {
				title: `🎓 Tutorial - ${hostname}`,
				description: `Step-by-step tutorials and guides to help you get started quickly. From basic setup to advanced configurations.`,
				image: `https://via.placeholder.com/400x300/6f42c1/ffffff?text=🎓+Tutorial`,
				url: url,
				siteName: hostname,
				type: "website",
			}
		}

		if (url.includes("example") || url.includes("demo")) {
			return {
				title: `💡 Examples & Demos - ${hostname}`,
				description: `Live examples and interactive demos showcasing real-world implementations and use cases.`,
				image: `https://via.placeholder.com/400x300/ffc107/000000?text=💡+Examples`,
				url: url,
				siteName: hostname,
				type: "website",
			}
		}

		if (url.includes("github.com")) {
			const pathParts = url.split("/")
			const repo = pathParts.length > 4 ? `${pathParts[3]}/${pathParts[4]}` : "repository"
			return {
				title: `⚡ ${repo} - GitHub`,
				description: `Open source repository on GitHub. Contribute, report issues, or explore the codebase.`,
				image: `https://via.placeholder.com/400x300/24292e/ffffff?text=⚡+GitHub`,
				url: url,
				siteName: "GitHub",
				type: "website",
			}
		}

		// Default mock data
		return {
			title: `🌐 ${hostname}`,
			description: `This is a mock link preview for ${url}. In the real application, this would show the actual page title, description, and preview image from the website's Open Graph metadata.`,
			image: `https://via.placeholder.com/400x300/0066cc/ffffff?text=${encodeURIComponent(hostname)}`,
			url: url,
			siteName: hostname,
			type: "website",
		}
	},

	openInBrowser: async (request: { value: string }) => {
		// Mock opening in browser - just log for demo
		console.log("Mock: Opening URL in browser:", request.value)

		// Add a small delay to simulate the action
		await new Promise((resolve) => setTimeout(resolve, 50))

		return {}
	},
}
