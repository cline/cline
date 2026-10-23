import { act } from "react-test-renderer";
import { Appearance, Text, useColorScheme } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { useTheme } from "@/ui/theme";
import { AppearanceProvider, useAppearance } from "./appearance";

function Output(props: ReturnType<typeof useAppearance> & { mode: string }) {
	return <Text>{props.mode}</Text>;
}
function Probe() {
	const appearance = useAppearance();
	const theme = useTheme();
	return <Output {...appearance} mode={theme.mode} />;
}
afterEach(() => {
	vi.mocked(useColorScheme).mockReturnValue("dark");
	vi.clearAllMocks();
});
describe("appearance preference", () => {
	it("follows the system until an override is saved, and restores that override on launch", async () => {
		let saved: string | null = null;
		const storage = {
			getItem: async () => saved,
			setItem: async (_key: string, value: string) => {
				saved = value;
			},
		};
		vi.mocked(useColorScheme).mockReturnValue("light");
		const view = render(
			<AppearanceProvider storage={storage}>
				<Probe />
			</AppearanceProvider>,
		);
		await act(async () => {});
		const current = () => view.root.findAll((node) => node.type === Output)[0];
		expect(current().props).toMatchObject({
			mode: "light",
			preference: "system",
			hydrated: true,
		});
		await act(async () => current().props.setPreference("dark"));
		expect(current().props).toMatchObject({ mode: "dark", preference: "dark" });
		expect(Appearance.setColorScheme).toHaveBeenLastCalledWith("dark");
		view.unmount();
		const restored = render(
			<AppearanceProvider storage={storage}>
				<Probe />
			</AppearanceProvider>,
		);
		await act(async () => {});
		const restoredState = () =>
			restored.root.findAll((node) => node.type === Output)[0];
		expect(restoredState().props).toMatchObject({
			mode: "dark",
			preference: "dark",
			hydrated: true,
		});
		await act(async () => restoredState().props.setPreference("system"));
		expect(restoredState().props).toMatchObject({
			mode: "light",
			preference: "system",
		});
		expect(Appearance.setColorScheme).toHaveBeenLastCalledWith("unspecified");
		vi.mocked(useColorScheme).mockReturnValue("dark");
		act(() =>
			restored.renderer.update(
				<AppearanceProvider storage={storage}>
					<Probe />
				</AppearanceProvider>,
			),
		);
		expect(restoredState().props.mode).toBe("dark");
		restored.unmount();
	});
	it("recovers from unreadable storage and retains the current theme when saving fails", async () => {
		const storage = {
			getItem: async () => {
				throw new Error("unavailable");
			},
			setItem: async () => {
				throw new Error("unavailable");
			},
		};
		const view = render(
			<AppearanceProvider storage={storage}>
				<Probe />
			</AppearanceProvider>,
		);
		await act(async () => {});
		const current = () => view.root.findAll((node) => node.type === Output)[0];
		expect(current().props).toMatchObject({
			hydrated: true,
			preference: "system",
		});
		await act(async () => {
			await expect(current().props.setPreference("light")).rejects.toThrow(
				"unavailable",
			);
		});
		expect(current().props).toMatchObject({
			preference: "system",
			saving: false,
		});
		view.unmount();
	});
});
