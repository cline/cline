import { describe, it } from "mocha"
import "should"
import { buildServerKey, hashServerName } from "../server-key"

describe("hashServerName", () => {
	it("should produce a 5-character alphanumeric string", () => {
		const hash = hashServerName("my-server")
		hash.length.should.equal(5)
		;/^[a-z0-9]{5}$/.test(hash).should.be.true()
	})

	it("should be deterministic — same input always yields same output", () => {
		const first = hashServerName("test-server")
		const second = hashServerName("test-server")
		first.should.equal(second)
	})

	it("should produce different hashes for different server names", () => {
		const a = hashServerName("server-alpha")
		const b = hashServerName("server-beta")
		a.should.not.equal(b)
	})

	it("should handle empty strings", () => {
		const hash = hashServerName("")
		hash.length.should.equal(5)
		;/^[a-z0-9]{5}$/.test(hash).should.be.true()
	})

	it("should handle special characters in server names", () => {
		const hash = hashServerName("my-server/v2@latest!")
		hash.length.should.equal(5)
		;/^[a-z0-9]{5}$/.test(hash).should.be.true()
	})

	it("should handle very long server names", () => {
		const hash = hashServerName("a".repeat(1000))
		hash.length.should.equal(5)
		;/^[a-z0-9]{5}$/.test(hash).should.be.true()
	})
})

describe("buildServerKey", () => {
	it("should produce a 6-character key starting with 'c'", () => {
		const key = buildServerKey("my-server")
		key.length.should.equal(6)
		key[0].should.equal("c")
	})

	it("should be deterministic across calls", () => {
		const first = buildServerKey("my-mcp-server")
		const second = buildServerKey("my-mcp-server")
		first.should.equal(second)
	})

	it("should match 'c' + hashServerName", () => {
		const key = buildServerKey("test-server")
		const hash = hashServerName("test-server")
		key.should.equal(`c${hash}`)
	})

	it("should only contain alphanumeric characters safe for function names", () => {
		const key = buildServerKey("a server with spaces & symbols!")
		;/^c[a-z0-9]{5}$/.test(key).should.be.true()
	})
})
