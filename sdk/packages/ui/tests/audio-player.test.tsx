import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	AudioPlayer,
	AudioPlayerControlBar,
	AudioPlayerElement,
	AudioPlayerPlayButton,
	AudioPlayerTimeDisplay,
	AudioPlayerTimeRange,
} from "../components/index.js";

describe("AudioPlayer", () => {
	it("composes a URL-backed player from the public package export", () => {
		const markup = renderToStaticMarkup(
			<AudioPlayer>
				<AudioPlayerElement src="https://example.com/audio.mp3" />
				<AudioPlayerControlBar>
					<AudioPlayerPlayButton />
					<AudioPlayerTimeRange />
					<AudioPlayerTimeDisplay noToggle remaining />
				</AudioPlayerControlBar>
			</AudioPlayer>,
		);

		expect(markup).toContain("cline-ui-audio-player");
		expect(markup).toContain('src="https://example.com/audio.mp3"');
		expect(markup).toContain('data-slot="audio-player-play-button"');
		expect(markup).toContain('data-slot="audio-player-time-range"');
	});
});
