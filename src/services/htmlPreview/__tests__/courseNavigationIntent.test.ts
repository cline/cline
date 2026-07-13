import { expect } from "chai"
import { resolveCourseNavigationIntent } from "../courseNavigationIntent"

describe("HTML Preview agent navigation intent", () => {
	const now = 20_000

	it("accepts a fresh intent exactly once", () => {
		const first = resolveCourseNavigationIntent(
			{ courseId: "course-1", moduleId: "module-2", reason: "next", timestamp: now - 1 },
			0,
			now,
		)
		expect(first.intent).to.deep.equal({
			courseId: "course-1",
			moduleId: "module-2",
			reason: "next",
			timestamp: now - 1,
		})
		expect(resolveCourseNavigationIntent({ moduleId: "module-2", timestamp: now - 1 }, first.lastTimestamp, now).intent).to.be
			.undefined
	})

	it("refuses stale and malformed intents", () => {
		const stale = resolveCourseNavigationIntent({ moduleId: "module-2", timestamp: now - 10_001 }, 0, now)
		expect(stale.intent).to.be.undefined
		expect(stale.lastTimestamp).to.equal(now - 10_001)
		expect(resolveCourseNavigationIntent({ timestamp: now }, 0, now).intent).to.be.undefined
		expect(resolveCourseNavigationIntent("invalid", 0, now).intent).to.be.undefined
	})
})
