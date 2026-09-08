import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import ClineLogoSanta from "./ClineLogoSanta"
import ClineLogoVariable from "./ClineLogoVariable"
import ClineLogoWhite from "./ClineLogoWhite"

describe("Cline logo treatments", () => {
	it("renders the revised outline silhouette in theme-aware and white variants", () => {
		for (const logo of [<ClineLogoVariable />, <ClineLogoWhite />]) {
			const markup = renderToStaticMarkup(logo)
			expect(markup).toContain('viewBox="0 0 113 113"')
			expect(markup.match(/<rect/g)).toHaveLength(2)
			expect(markup).toContain("M56.4998 8.99805")
		}
	})

	it("keeps the Santa hat above the revised silhouette", () => {
		const markup = renderToStaticMarkup(<ClineLogoSanta />)
		expect(markup).toContain('transform="translate(9.3 14) scale(.42)"')
		expect(markup).toContain('fill="#CC3333"')
		expect(markup).toContain("M56.4998 8.99805")
	})
})
