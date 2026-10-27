import { describe, expect, it } from "vitest";
import {
	buildWebviewHtml,
	httpEndpointFromWs,
	parseBackendReadyLine,
	rewriteAssetUrls,
} from "./webview-html";

const resolveAsset = (path: string) =>
	`https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/${path}`;

describe("rewriteAssetUrls", () => {
	it("rewrites root-relative script/link/img references", () => {
		const html =
			'<script src="/_next/static/chunks/a.js"></script><link href="/_next/static/chunks/a.css"/><img src="/icon.png"/>';
		const out = rewriteAssetUrls(html, resolveAsset);
		expect(out).toContain(`src="${resolveAsset("_next/static/chunks/a.js")}"`);
		expect(out).toContain(
			`href="${resolveAsset("_next/static/chunks/a.css")}"`,
		);
		expect(out).toContain(`src="${resolveAsset("icon.png")}"`);
	});

	it("rewrites chunk references inside the inlined React Flight payload", () => {
		const html =
			'<script>self.__next_f.push([1,"2:I[814120,[\\"/_next/static/chunks/a.js\\",\\"/_next/static/chunks/b.js\\"],\\"Comp\\"]\\n"])</script>';
		const out = rewriteAssetUrls(html, resolveAsset);
		expect(out).toContain(`\\"${resolveAsset("_next/static/chunks/a.js")}\\"`);
		expect(out).toContain(`\\"${resolveAsset("_next/static/chunks/b.js")}\\"`);
		expect(out).not.toContain('\\"/_next/');
		expect(out).toContain('\\"Comp\\"');
	});

	it("leaves the bare root link and absolute URLs alone", () => {
		const html =
			'<link rel="preconnect" href="/" crossorigin=""/><a href="https://cline.bot">x</a>';
		expect(rewriteAssetUrls(html, resolveAsset)).toBe(html);
	});
});

describe("buildWebviewHtml", () => {
	const html =
		"<!DOCTYPE html><html><head><title>Cline</title></head><body></body></html>";
	const built = buildWebviewHtml({
		html,
		resolveAsset,
		cspSource: "https://*.vscode-cdn.net",
		wsEndpoint: "ws://127.0.0.1:4242/transport?approval_token=tok",
		hostCommands: ["pick_workspace_directory"],
		chunkBaseUrl: resolveAsset("_next/"),
	});

	it("injects CSP allowing the backend loopback endpoints", () => {
		expect(built).toContain("Content-Security-Policy");
		expect(built).toContain("ws://127.0.0.1:4242");
		expect(built).toContain("http://127.0.0.1:4242");
	});

	it("publishes the endpoint and host shell before the app", () => {
		expect(built).toContain(
			'window.__SIDECAR_WS_ENDPOINT__ = "ws://127.0.0.1:4242/transport?approval_token=tok"',
		);
		expect(built).toContain(
			'window.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: ["pick_workspace_directory"] }',
		);
		expect(built).toContain(
			`window.TURBOPACK_CHUNK_BASE_PATH = "${resolveAsset("_next/")}"`,
		);
		expect(built.indexOf("__SIDECAR_WS_ENDPOINT__")).toBeLessThan(
			built.indexOf("<title>"),
		);
	});

	it("throws when the export has no head", () => {
		expect(() =>
			buildWebviewHtml({
				html: "<html><body></body></html>",
				resolveAsset,
				cspSource: "x",
				wsEndpoint: "ws://127.0.0.1:1/transport",
				hostCommands: [],
				chunkBaseUrl: "x/_next/",
			}),
		).toThrow(/<head>/);
	});
});

describe("httpEndpointFromWs", () => {
	it("strips /transport and the approval token", () => {
		expect(
			httpEndpointFromWs("ws://127.0.0.1:3126/transport?approval_token=t"),
		).toBe("http://127.0.0.1:3126");
	});
});

describe("parseBackendReadyLine", () => {
	it("parses the sidecar ready line", () => {
		expect(
			parseBackendReadyLine(
				'{"type":"ready","endpoint":"http://127.0.0.1:3126","wsEndpoint":"ws://127.0.0.1:3126/transport?approval_token=x","pid":42,"mode":"sidecar"}',
			),
		).toEqual({
			endpoint: "http://127.0.0.1:3126",
			wsEndpoint: "ws://127.0.0.1:3126/transport?approval_token=x",
			pid: 42,
		});
	});

	it("ignores log lines and other JSON", () => {
		expect(parseBackendReadyLine("Desktop sidecar starting")).toBeUndefined();
		expect(parseBackendReadyLine('{"type":"log"}')).toBeUndefined();
		expect(parseBackendReadyLine("{not json")).toBeUndefined();
	});
});
