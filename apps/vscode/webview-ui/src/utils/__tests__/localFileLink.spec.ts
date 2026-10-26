import { describe, expect, it } from "vitest"
import { localFileLink } from "../localFileLink"

describe("localFileLink", () => {
	it("recognises absolute paths as the shell writes them", () => {
		for (const href of [
			"/Users/jay/project/index.html",
			"C:\\Users\\jay\\project\\index.html",
			"c:/Users/jay/project/index.html",
			"\\\\server\\share$\\project\\index.html",
		]) {
			expect(localFileLink(href), href).toEqual({ kind: "absolute", path: href })
		}
	})

	it("decodes what the markdown parser percent-encoded in the destination", () => {
		expect(localFileLink("C:%5CUsers%5Cjay%5Cproject%5Cindex.html")).toEqual({
			kind: "absolute",
			path: "C:\\Users\\jay\\project\\index.html",
		})
		expect(localFileLink("%5C%5Cserver%5Cshare$%5Cproject%5Cindex.html")).toEqual({
			kind: "absolute",
			path: "\\\\server\\share$\\project\\index.html",
		})
		expect(localFileLink("/Users/jay/my%20project/index.html")).toEqual({
			kind: "absolute",
			path: "/Users/jay/my project/index.html",
		})
		expect(localFileLink("docs/release%20notes.md")).toEqual({ kind: "relative", path: "docs/release notes.md" })
	})

	it("drops a fragment but keeps an encoded # that belongs to the file name", () => {
		expect(localFileLink("docs/setup.md#install")).toEqual({ kind: "relative", path: "docs/setup.md" })
		expect(localFileLink("/Users/jay/notes/a%23b.md#top")).toEqual({ kind: "absolute", path: "/Users/jay/notes/a#b.md" })
	})

	it("passes file URLs on as URLs", () => {
		for (const href of [
			"file:///Users/jay/my%20project/index.html",
			"file:///C:/Users/jay/project/index.html",
			"FILE:///Users/jay/project/index.html",
		]) {
			expect(localFileLink(href), href).toEqual({ kind: "absolute", path: href })
		}
	})

	it("treats scheme-less hrefs as paths relative to the workspace", () => {
		for (const href of ["index.html", "html_demos/index.html", "./src/app.ts", "../other/README.md"]) {
			expect(localFileLink(href), href).toEqual({ kind: "relative", path: href })
		}
	})

	it("leaves web links, other schemes, anchors and empty hrefs alone", () => {
		for (const href of [
			"https://example.com/index.html",
			"//example.com/docs",
			"mailto:jay@example.com",
			"vscode://file/x",
			"#top",
			"",
		]) {
			expect(localFileLink(href), href).toBeUndefined()
		}
	})
})
