import type { Metadata } from "next";
import { ModelCatalog } from "@/components/model-catalog";
import { requireUser } from "@/lib/auth";
import { getOrCreateSettings } from "@/lib/profile";

export const metadata: Metadata = { title: "Models" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
	const user = await requireUser();
	const settings = await getOrCreateSettings(user.id);

	return (
		<div className="space-y-6">
			<header>
				<p className="eyebrow">Models</p>
				<h1 className="display mt-2 text-3xl font-semibold">OpenRouter catalog</h1>
				<p className="mt-2 max-w-2xl text-sm text-mist-500">
					Live model discovery with context windows, per-million-token pricing and tool support.
					Only models that advertise tool calling can run agent tasks.
				</p>
			</header>
			<ModelCatalog defaultModel={settings.default_model} />
		</div>
	);
}
