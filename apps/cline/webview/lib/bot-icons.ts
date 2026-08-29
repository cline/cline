export const BOT_ICON_PRESETS = Array.from({ length: 9 }, (_, index) => {
	const id = String(index + 1).padStart(3, "0");
	return {
		id,
		path: `/bot-icons/${id}.png`,
		label: id,
	};
});

export type BotIconId = (typeof BOT_ICON_PRESETS)[number]["id"];
