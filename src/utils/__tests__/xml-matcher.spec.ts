import { XmlMatcher } from "../xml-matcher"

describe("XmlMatcher", () => {
	it("only match at position 0", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("<think>data</think>"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "data",
			},
		])
	})
	it("tag with space", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("< think >data</ think >"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "data",
			},
		])
	})

	it("invalid tag", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("< think 1>data</ think >"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: false,
				data: "< think 1>data</ think >",
			},
		])
	})

	it("anonymous tag", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("<>data</>"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: false,
				data: "<>data</>",
			},
		])
	})

	it("streaming push", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [
			...matcher.update("<thi"),
			...matcher.update("nk"),
			...matcher.update(">dat"),
			...matcher.update("a</"),
			...matcher.update("think>"),
		]
		expect(chunks).toHaveLength(2)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "dat",
			},
			{
				matched: true,
				data: "a",
			},
		])
	})

	it("nested tag", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("<think>X<think>Y</think>Z</think>"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "X<think>Y</think>Z",
			},
		])
	})

	it("nested invalid tag", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("<think>X<think>Y</thxink>Z</think>"), ...matcher.final()]
		expect(chunks).toHaveLength(2)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "X<think>Y</thxink>Z",
			},
			{
				matched: true,
				data: "</think>",
			},
		])
	})

	it("Wrong matching position", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("1<think>data</think>"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: false,
				data: "1<think>data</think>",
			},
		])
	})

	it("Unclosed tag", () => {
		const matcher = new XmlMatcher("think")
		const chunks = [...matcher.update("<think>data"), ...matcher.final()]
		expect(chunks).toHaveLength(1)
		expect(chunks).toEqual([
			{
				matched: true,
				data: "data",
			},
		])
	})
})
