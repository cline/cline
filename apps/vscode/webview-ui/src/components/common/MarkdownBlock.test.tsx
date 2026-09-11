import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/common/MermaidBlock", () => ({
	default: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

vi.mock("@/components/common/UnsafeImage", () => ({
	default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt ?? ""} {...props} />,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mode: "act" }),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		ifFileExistsRelativePath: vi.fn().mockResolvedValue({ value: false }),
		openFileRelativePath: vi.fn(),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(),
	},
}))

import MarkdownBlock from "./MarkdownBlock"

describe("MarkdownBlock bidirectional text", () => {
	it("uses content-majority direction and isolates an English identifier in Persian prose", () => {
		const { container } = render(<MarkdownBlock markdown="React یک کتابخانه جاوااسکریپت بسیار محبوب است." />)
		const paragraph = container.querySelector("p")
		const isolate = paragraph?.querySelector("bdi")

		expect(paragraph?.getAttribute("dir")).toBe("rtl")
		expect(isolate?.getAttribute("dir")).toBe("ltr")
		expect(isolate?.textContent).toBe("React")
	})

	it("uses LTR direction for English-majority prose containing Persian", () => {
		const { container } = render(<MarkdownBlock markdown="React is a popular کتابخانه for the web." />)

		expect(container.querySelector("p")?.getAttribute("dir")).toBe("ltr")
	})

	it("does not annotate pure LTR prose", () => {
		const { container } = render(<MarkdownBlock markdown="React is a popular JavaScript library." />)
		const paragraph = container.querySelector("p")

		expect(paragraph?.hasAttribute("dir")).toBe(false)
		expect(paragraph?.hasAttribute("data-bidilens-block")).toBe(false)
		expect(paragraph?.querySelector("bdi")).toBeNull()
	})
})
