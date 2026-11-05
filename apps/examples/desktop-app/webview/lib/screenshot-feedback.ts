import { desktopClient } from "@/lib/desktop-client";

/** A user note pinned to a point (or box) on a UX verification screenshot. */
export type ScreenshotNote = {
	id: string;
	sessionId: string;
	artifactId: string;
	screenshotTitle: string;
	/** Fractions of the image size, from the top-left corner. */
	x: number;
	y: number;
	width?: number;
	height?: number;
	text: string;
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

function describeLocation(note: ScreenshotNote): string {
	if (note.width && note.height) {
		return `box from (${percent(note.x)}, ${percent(note.y)}) to (${percent(note.x + note.width)}, ${percent(note.y + note.height)})`;
	}
	return `marker at (${percent(note.x)}, ${percent(note.y)})`;
}

/** Notes are numbered by their position in the list, matching the drawn markers. */
export function formatScreenshotFeedback(
	prompt: string,
	notes: ScreenshotNote[],
	imagesAttached: boolean,
): string {
	if (notes.length === 0) return prompt;
	const heading = imagesAttached
		? "Feedback on UX verification screenshots (numbered markers are drawn on the attached images; positions are x, y from the top-left):"
		: "Feedback on UX verification screenshots (positions are x, y from the top-left):";
	const lines = notes.map(
		(note, index) =>
			`${index + 1}. "${note.screenshotTitle}", ${describeLocation(note)}: ${note.text}`,
	);
	return [prompt, [heading, ...lines].join("\n")].filter(Boolean).join("\n\n");
}

const MARKER_COLOR = "#8b5cf6";

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Screenshot could not be decoded"));
		image.src = src;
	});
}

async function renderAnnotatedScreenshot(
	notes: Array<{ note: ScreenshotNote; number: number }>,
	index: number,
): Promise<File> {
	const { sessionId, artifactId } = notes[0].note;
	const { mediaType, data } = await desktopClient.invoke<{
		mediaType: string;
		data: string;
	}>("read_artifact_image", { sessionId, artifactId });
	const image = await loadImage(`data:${mediaType};base64,${data}`);
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas is unavailable");
	context.drawImage(image, 0, 0);
	const scale = Math.max(1, canvas.width / 1200);
	const radius = 13 * scale;
	for (const { note, number } of notes) {
		const x = note.x * canvas.width;
		const y = note.y * canvas.height;
		if (note.width && note.height) {
			context.lineWidth = 3 * scale;
			context.strokeStyle = "white";
			context.strokeRect(
				x,
				y,
				note.width * canvas.width,
				note.height * canvas.height,
			);
			context.lineWidth = 2 * scale;
			context.strokeStyle = MARKER_COLOR;
			context.strokeRect(
				x,
				y,
				note.width * canvas.width,
				note.height * canvas.height,
			);
		}
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fillStyle = MARKER_COLOR;
		context.fill();
		context.lineWidth = 2.5 * scale;
		context.strokeStyle = "white";
		context.stroke();
		context.fillStyle = "white";
		context.font = `600 ${14 * scale}px sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(String(number), x, y + scale);
	}
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/jpeg", 0.9),
	);
	if (!blob) throw new Error("Screenshot could not be encoded");
	return new File([blob], `screenshot-feedback-${index + 1}.jpg`, {
		type: "image/jpeg",
	});
}

/** One annotated image per screenshot; screenshots that fail to load are skipped. */
export async function renderScreenshotFeedbackImages(
	notes: ScreenshotNote[],
): Promise<File[]> {
	const byScreenshot = new Map<
		string,
		Array<{ note: ScreenshotNote; number: number }>
	>();
	notes.forEach((note, index) => {
		const key = `${note.sessionId}\n${note.artifactId}`;
		byScreenshot.set(key, [
			...(byScreenshot.get(key) ?? []),
			{ note, number: index + 1 },
		]);
	});
	const results = await Promise.allSettled(
		[...byScreenshot.values()].map(renderAnnotatedScreenshot),
	);
	return results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
}
