import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const id = randomUUID();
const directory = dirname(fileURLToPath(import.meta.url));
export default {
	name: "duplicate",
	manifest: { capabilities: ["commands"] },
	setup(api, ctx) {
		const settings = JSON.parse(
			readFileSync(join(directory, "fixture-settings.json"), "utf8"),
		);
		if (settings.failedPlugin === "later" && !existsSync(settings.gate))
			throw new Error("not ready");
		ctx.onDispose(() => appendFileSync(settings.disposed, `later:${id}\n`));
		api.registerCommand({ name: "same", handler: () => `later:${id}` });
	},
};
