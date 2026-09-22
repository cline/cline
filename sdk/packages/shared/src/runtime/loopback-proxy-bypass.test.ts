import { describe, expect, it } from "vitest";
import { ensureLoopbackProxyBypass } from "./loopback-proxy-bypass";

const LOOPBACK_LIST = "localhost,127.0.0.1,::1,[::1]";

describe("ensureLoopbackProxyBypass", () => {
	it("does nothing when no proxy variable is set", () => {
		const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
		ensureLoopbackProxyBypass(env);
		expect(env).toEqual({ PATH: "/usr/bin" });
	});

	it("does nothing when proxy variables are set but empty", () => {
		const env: Record<string, string | undefined> = { HTTP_PROXY: "  " };
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBeUndefined();
		expect(env.no_proxy).toBeUndefined();
	});

	it.each([
		"HTTP_PROXY",
		"http_proxy",
		"HTTPS_PROXY",
		"https_proxy",
	])("adds every loopback spelling when %s is set", (key) => {
		const env: Record<string, string | undefined> = {
			[key]: "http://127.0.0.1:7890",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(LOOPBACK_LIST);
		expect(env.no_proxy).toBe(LOOPBACK_LIST);
	});

	it("appends missing loopback hosts to an existing NO_PROXY", () => {
		const env: Record<string, string | undefined> = {
			HTTPS_PROXY: "http://proxy.corp:8080",
			NO_PROXY: ".corp.example.com, localhost",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(
			".corp.example.com,localhost,127.0.0.1,::1,[::1]",
		);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("reads an existing lowercase no_proxy", () => {
		const env: Record<string, string | undefined> = {
			http_proxy: "http://127.0.0.1:7890",
			no_proxy: "127.0.0.1",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.no_proxy).toBe("127.0.0.1,localhost,::1,[::1]");
		expect(env.NO_PROXY).toBe(env.no_proxy);
	});

	// NO_PROXY and no_proxy can be populated independently (launcher vs shell
	// profile) and different tools read different casings; synchronizing both
	// to one casing's value would drop the other's exemptions and route
	// previously exempt traffic through the proxy.
	it("merges the union when both casings carry different exemptions", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://proxy.corp:8080",
			NO_PROXY: ".corp.example.com",
			no_proxy: "internal.db, 10.0.0.5",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(
			".corp.example.com,internal.db,10.0.0.5,localhost,127.0.0.1,::1,[::1]",
		);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("dedupes entries across casings case-insensitively, first spelling wins", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://proxy.corp:8080",
			NO_PROXY: "Corp.Example.COM,localhost",
			no_proxy: "corp.example.com,LOCALHOST,extra.host",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(
			"Corp.Example.COM,localhost,extra.host,127.0.0.1,::1,[::1]",
		);
		expect(env.no_proxy).toBe(env.NO_PROXY);
	});

	it("leaves both casings alone when either contains a wildcard", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://proxy.corp:8080",
			NO_PROXY: ".corp.example.com",
			no_proxy: "*",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(".corp.example.com");
		expect(env.no_proxy).toBe("*");
	});

	it("is idempotent", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://127.0.0.1:7890",
		};
		ensureLoopbackProxyBypass(env);
		const first = env.NO_PROXY;
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe(first);
	});

	it("matches loopback entries case-insensitively", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://127.0.0.1:7890",
			NO_PROXY: "LOCALHOST,127.0.0.1,::1,[::1]",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe("LOCALHOST,127.0.0.1,::1,[::1]");
	});

	it("leaves a wildcard NO_PROXY alone", () => {
		const env: Record<string, string | undefined> = {
			HTTP_PROXY: "http://127.0.0.1:7890",
			NO_PROXY: "*",
		};
		ensureLoopbackProxyBypass(env);
		expect(env.NO_PROXY).toBe("*");
		expect(env.no_proxy).toBeUndefined();
	});
});
