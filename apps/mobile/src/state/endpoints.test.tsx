import { Text } from "react-native";
import { act } from "react-test-renderer";
import { expect, it } from "vitest";
import { type ConnectionDescriptor, SavedEndpointsStore } from "@/connection";
import { render } from "@/ui/__testing__/render";
import { EndpointsProvider, useEndpoints } from "./endpoints";

it("offers only Cloud after hydration and updates without deleting saved computers", async () => {
	const computer: ConnectionDescriptor = {
		mode: "local",
		url: "ws://computer.example:7777",
	};
	const cloud: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://session.example/first",
	};
	let persisted = JSON.stringify([computer, cloud]);
	const store = new SavedEndpointsStore({
		getItem: async () => persisted,
		setItem: async (_key, value) => {
			persisted = value;
		},
		deleteItem: async () => {
			persisted = "[]";
		},
	});
	function AvailableSessions() {
		const { endpoints, hydrated } = useEndpoints();
		return (
			<Text testID="available-sessions">
				{JSON.stringify({ endpoints, hydrated })}
			</Text>
		);
	}
	const result = render(
		<EndpointsProvider store={store}>
			<AvailableSessions />
		</EndpointsProvider>,
	);
	await act(async () => {});
	const available = () =>
		JSON.parse(
			result.root.find((node) => node.props.testID === "available-sessions")
				.props.children,
		);
	expect(available()).toEqual({ endpoints: [cloud], hydrated: true });
	const secondCloud: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://session.example/second",
	};
	await act(async () => {
		await store.save({ ...computer, label: "Saved computer" });
		await store.save(secondCloud);
	});
	expect(available()).toEqual({
		endpoints: [secondCloud, cloud],
		hydrated: true,
	});
	expect(JSON.parse(persisted)).toContainEqual({
		...computer,
		label: "Saved computer",
	});
	result.unmount();
});
