import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import {
	type HandoffPresentation,
	handoffQrFitsIn,
} from "../../../commands/handoff";

/**
 * Renders the handoff QR inside the TUI. The QR rows arrive without ANSI so the
 * colours are set here as renderer props — black on white, because an inverted QR
 * does not scan on either terminal theme.
 *
 * In a window too short for the whole code the QR is dropped rather than clipped:
 * a half-drawn QR cannot be scanned but looks like it should be, which is the
 * worst outcome. The deep link is always shown, so there is always a way through.
 */
export function HandoffQrContent(
	ctx: ChoiceContext<boolean> & {
		presentation: HandoffPresentation;
		availableRows: number;
	},
) {
	useDialogKeyboard((key) => {
		if (key.name === "escape" || key.name === "return" || key.name === "q") {
			ctx.dismiss();
		}
	}, ctx.dialogId);

	const { presentation } = ctx;
	const showQr = handoffQrFitsIn(presentation, ctx.availableRows);
	return (
		<box flexDirection="column" paddingX={1}>
			<text>{presentation.headline}</text>
			{showQr ? (
				<box flexDirection="column" marginTop={1}>
					{presentation.qrBlockLines.map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: QR rows are a fixed matrix; the row position IS the identity and repeats as content.
						<text key={`qr-row-${index}`} fg="black" bg="white">
							{line}
						</text>
					))}
				</box>
			) : (
				<text fg="yellow" marginTop={1}>
					Window is too short to draw a scannable QR — copy the link below, or
					make the terminal taller and run /handoff again.
				</text>
			)}
			<text marginTop={1}>
				{showQr
					? presentation.instruction
					: "Open this on your phone with Cline Code:"}
			</text>
			{/* On its own line, unindented: this is the copy/paste fallback. */}
			<text fg="cyan">{presentation.uri}</text>
			<box flexDirection="column" marginTop={1}>
				{presentation.details.map((detail) => (
					<text key={detail} fg="gray">
						{detail}
					</text>
				))}
			</box>
			<text fg="gray" marginTop={1}>
				<em>Esc to close</em>
			</text>
		</box>
	);
}
