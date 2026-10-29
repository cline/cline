import type { GeneratedMedia } from "@cline/shared";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
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

describe("native playback loading recovery", () => {
	const audioImplementation = vi
		.mocked(useAudioPlayerStatus)
		.getMockImplementation();
	const videoImplementation = vi.mocked(useVideoPlayer).getMockImplementation();
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.mocked(useAudioPlayerStatus).mockImplementation(audioImplementation!);
		vi.mocked(useVideoPlayer).mockImplementation(videoImplementation!);
		vi.useRealTimers();
	});
	function mountAudio() {
		let status = {
			isLoaded: false,
			playing: false,
			currentTime: 0,
			duration: 0,
			didJustFinish: false,
			error: null,
			playbackState: "unknown",
		};
		vi.mocked(useAudioPlayerStatus).mockImplementation(
			() => status as ReturnType<typeof useAudioPlayerStatus>,
		);
		const media: GeneratedMedia = {
			id: "guard-audio",
			modality: "audio",
			mediaType: "audio/mpeg",
			source: { type: "url", url: "https://example.com/slow.mp3" },
		};
		const mounted = render(<GeneratedMediaBlock media={media} />);
		const press = (label: string) =>
			act(() =>
				mounted.root
					.findAll(
						(n) =>
							typeof n.type === "string" &&
							n.props.accessibilityLabel === label,
					)
					.at(0)!
					.props.onPress(),
			);
		const has = (label: string) =>
			mounted.root.findAll(
				(n) =>
					typeof n.type === "string" && n.props.accessibilityLabel === label,
			).length > 0;
		const update = (next: Partial<typeof status>) => {
			status = { ...status, ...next };
			act(() => mounted.renderer.update(<GeneratedMediaBlock media={media} />));
		};
		press("Load audio");
		return { ...mounted, press, has, update };
	}
	it("turns a missing native audio terminal event into retry, latches failure against late ready, and resets only on explicit retry", () => {
		const m = mountAudio();
		act(() => {
			vi.advanceTimersByTime(14999);
		});
		expect(m.has("Retry audio")).toBe(false);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(m.has("Retry audio")).toBe(true);
		m.update({ isLoaded: true });
		expect(m.has("Retry audio")).toBe(true);
		m.update({ isLoaded: false });
		m.press("Retry audio");
		expect(m.has("Retry audio")).toBe(false);
		act(() => {
			vi.advanceTimersByTime(14999);
		});
		expect(m.has("Retry audio")).toBe(false);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(m.has("Retry audio")).toBe(true);
		expect(
			vi.mocked(useAudioPlayer).mock.results.at(-1)!.value.play,
		).not.toHaveBeenCalled();
		m.unmount();
	});
	it("accepts a valid slow audio load before the deadline and cancels the guard after readiness", () => {
		const m = mountAudio();
		act(() => {
			vi.advanceTimersByTime(14000);
		});
		m.update({ isLoaded: true, duration: 5 });
		act(() => {
			vi.advanceTimersByTime(60000);
		});
		expect(m.has("Retry audio")).toBe(false);
		expect(m.has("Play audio")).toBe(true);
		expect(
			vi.mocked(useAudioPlayer).mock.results.at(-1)!.value.play,
		).not.toHaveBeenCalled();
		m.unmount();
	});
	it("uses an already-failed native audio snapshot even when its one-shot error event was missed", () => {
		const m = mountAudio();
		m.update({ playbackState: "failed" });
		expect(m.has("Retry audio")).toBe(true);
		m.update({ playbackState: "readyToPlay", isLoaded: true });
		expect(m.has("Retry audio")).toBe(true);
		m.unmount();
	});
	it("clears the pending audio deadline when the user closes the playback surface", () => {
		const m = mountAudio();
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		m.press("Close audio");
		expect(vi.getTimerCount()).toBe(0);
		act(() => {
			vi.advanceTimersByTime(60000);
		});
		expect(m.has("Load audio")).toBe(true);
		expect(m.has("Retry audio")).toBe(false);
		m.unmount();
	});
	it("bounds video loading without a terminal event and rejects late ready until explicit retry", () => {
		let listener: ((event: { status: string }) => void) | undefined;
		const player = {
			status: "loading",
			play: vi.fn(),
			pause: vi.fn(),
			addListener: vi.fn((_event: string, next: typeof listener) => {
				listener = next;
				return { remove: vi.fn() };
			}),
		};
		vi.mocked(useVideoPlayer).mockReturnValue(
			player as unknown as ReturnType<typeof useVideoPlayer>,
		);
		const m = render(
			<GeneratedMediaBlock
				media={{
					id: "guard-video",
					modality: "video",
					mediaType: "video/mp4",
					source: { type: "url", url: "https://example.com/slow.mp4" },
				}}
			/>,
		);
		const press = (label: string) =>
			act(() =>
				m.root
					.findAll(
						(n) =>
							typeof n.type === "string" &&
							n.props.accessibilityLabel === label,
					)
					.at(0)!
					.props.onPress(),
			);
		const has = (label: string) =>
			m.root.findAll(
				(n) =>
					typeof n.type === "string" && n.props.accessibilityLabel === label,
			).length > 0;
		press("Load video");
		act(() => {
			vi.advanceTimersByTime(15000);
		});
		expect(has("Retry video")).toBe(true);
		act(() => listener?.({ status: "readyToPlay" }));
		expect(has("Retry video")).toBe(true);
		press("Retry video");
		expect(has("Retry video")).toBe(false);
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		act(() => listener?.({ status: "readyToPlay" }));
		act(() => {
			vi.advanceTimersByTime(60000);
		});
		expect(has("Retry video")).toBe(false);
		expect(player.play).not.toHaveBeenCalled();
		press("Close video");
		expect(vi.getTimerCount()).toBe(0);
		m.unmount();
	});
});
