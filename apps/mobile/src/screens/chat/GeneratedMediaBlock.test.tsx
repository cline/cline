import type { GeneratedMedia } from "@cline/shared";
import { useAudioPlayer } from "expo-audio";
import { File } from "expo-file-system";
import { useVideoPlayer } from "expo-video";
import { AppState } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import {
	GeneratedMediaBlock,
	isSafeRemoteImageUrl,
	isTrustedRemoteImageUrl,
} from "./GeneratedMediaBlock";

describe("GeneratedMediaBlock", () => {
	it("shows a readable error and retries failed image loads without changing the URI", () => {
		const uri = "https://assets.cline.bot/image.png";
		const { root } = render(
			<GeneratedMediaBlock
				media={{
					id: "image",
					modality: "image",
					mediaType: "image/png",
					source: { type: "url", url: uri },
				}}
			/>,
		);
		const images = () =>
			root.findAll(
				(node) => node.type === "Image" && node.props.source?.uri === uri,
			);
		act(() => images()[0]?.props.onError());
		expect(images()).toHaveLength(0);
		const retry = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "Retry image",
			)
			.at(0);
		expect(retry).toBeDefined();
		act(() => retry?.props.onPress());
		expect(images().length).toBeGreaterThan(0);
	});
	it("renders an HTTPS image returned by a resumed Cloud session", () => {
		const media: GeneratedMedia = {
			id: "image-1",
			modality: "image",
			mediaType: "image/png",
			name: "Architecture diagram",
			source: { type: "url", url: "https://assets.cline.bot/image.png" },
		};
		const { root } = render(<GeneratedMediaBlock media={media} />);
		const image = root
			.findAll(
				(node) =>
					node.props.source?.uri === "https://assets.cline.bot/image.png",
			)
			.at(0);
		expect(image?.props.source).toEqual({
			uri: "https://assets.cline.bot/image.png",
		});
		act(() => {
			root
				.find(
					(node) => node.props.accessibilityLabel === "Architecture diagram",
				)
				.props.onPress();
		});
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Close image"),
		).not.toHaveLength(0);
	});

	it("does not ask the native image loader to fetch cleartext or invalid URLs", () => {
		expect(isSafeRemoteImageUrl("https://assets.cline.bot/image.png")).toBe(
			true,
		);
		expect(isSafeRemoteImageUrl("http://assets.cline.bot/image.png")).toBe(
			false,
		);
		expect(isSafeRemoteImageUrl("not a url")).toBe(false);
	});

	it("requires a tap before fetching an image from an external origin", () => {
		const media: GeneratedMedia = {
			id: "image-2",
			modality: "image",
			mediaType: "image/png",
			source: { type: "url", url: "https://example.com/image.png" },
		};
		const { root } = render(<GeneratedMediaBlock media={media} />);
		expect(root.findAll((node) => node.props.source)).toHaveLength(0);
		act(() => {
			root
				.find((node) => node.props.accessibilityLabel === "Load image")
				.props.onPress();
		});
		expect(
			root.findAll(
				(node) => node.props.source?.uri === "https://example.com/image.png",
			),
		).not.toHaveLength(0);
	});

	it("only trusts Cline-owned media origins for automatic loading", () => {
		expect(isTrustedRemoteImageUrl("https://assets.cline.bot/image.png")).toBe(
			true,
		);
		expect(isTrustedRemoteImageUrl("https://cline.bot/image.png")).toBe(true);
		expect(isTrustedRemoteImageUrl("https://cline.bot.example/image.png")).toBe(
			false,
		);
	});
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("generated audio and video", () => {
	it.each([
		"audio",
		"video",
	] as const)("loads HTTPS %s only on request, does not autoplay, and pauses on leaving", (modality) => {
		const media: GeneratedMedia = {
			id: modality,
			modality,
			mediaType: `${modality}/mp4`,
			source: { type: "url", url: `https://example.com/${modality}.mp4` },
		};
		const mounted = render(<GeneratedMediaBlock media={media} />);
		const hook = modality === "audio" ? useAudioPlayer : useVideoPlayer;
		expect(hook).not.toHaveBeenCalled();
		act(() =>
			mounted.root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === `Load ${modality}`,
				)
				.at(-1)!
				.props.onPress(),
		);
		const player = vi.mocked(hook).mock.results.at(-1)!.value;
		expect(vi.mocked(hook).mock.calls.at(-1)?.[0]).toBe(
			`https://example.com/${modality}.mp4`,
		);
		expect(player.play).not.toHaveBeenCalled();
		const listener = vi.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
		act(() => listener("background"));
		expect(player.pause).toHaveBeenCalledOnce();
		mounted.unmount();
		expect(player.pause).toHaveBeenCalledTimes(2);
	});

	it("requires a new request if an external source changes", () => {
		const media: GeneratedMedia = {
			id: "same",
			modality: "audio",
			mediaType: "audio/mpeg",
			source: { type: "url", url: "https://example.com/one.mp3" },
		};
		const mounted = render(<GeneratedMediaBlock media={media} />);
		act(() =>
			mounted.root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Load audio",
				)
				.at(-1)!
				.props.onPress(),
		);
		vi.mocked(useAudioPlayer).mockClear();
		act(() =>
			mounted.renderer.update(
				<GeneratedMediaBlock
					media={{
						...media,
						source: { type: "url", url: "https://example.com/two.mp3" },
					}}
				/>,
			),
		);
		expect(useAudioPlayer).not.toHaveBeenCalled();
		mounted.unmount();
	});

	it.each([
		"http://example.com/file.mp4",
		"file:///private/file.mp4",
		"not a url",
	])("does not pass unsafe media URL %s to a player", (url) => {
		const { root } = render(
			<GeneratedMediaBlock
				media={{
					id: "video",
					modality: "video",
					mediaType: "video/mp4",
					source: { type: "url", url },
				}}
			/>,
		);
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Load video"),
		).toHaveLength(0);
		expect(useVideoPlayer).not.toHaveBeenCalled();
	});

	it("writes valid inline audio only on request and removes its cache file on close", () => {
		const write = vi.spyOn(File.prototype, "write");
		const remove = vi.spyOn(File.prototype, "delete");
		const { root } = render(
			<GeneratedMediaBlock
				media={{
					id: "inline",
					modality: "audio",
					mediaType: "audio/wav",
					source: { type: "base64", data: "UklGRg==" },
				}}
			/>,
		);
		expect(write).not.toHaveBeenCalled();
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Load audio",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(write).toHaveBeenCalledExactlyOnceWith("UklGRg==", {
			encoding: "base64",
		});
		expect(vi.mocked(useAudioPlayer).mock.calls.at(-1)?.[0]).toMatch(
			/^file:\/\/\/cache\/generated-.*\.wav$/,
		);
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Close audio",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(remove).toHaveBeenCalledOnce();
	});

	it.each([
		"invalid-base64",
		"A".repeat(8 * 1024 * 1024 + 4),
	])("rejects malformed or oversized inline media before writing or playing", (data) => {
		const write = vi.spyOn(File.prototype, "write");
		const { root } = render(
			<GeneratedMediaBlock
				media={{
					id: "invalid",
					modality: "video",
					mediaType: "video/mp4",
					source: { type: "base64", data },
				}}
			/>,
		);
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Load video",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(write).not.toHaveBeenCalled();
		expect(useVideoPlayer).not.toHaveBeenCalled();
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Retry video")
				.length,
		).toBeGreaterThan(0);
	});
});
