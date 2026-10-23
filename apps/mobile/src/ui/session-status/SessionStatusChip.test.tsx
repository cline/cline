import { describe, expect, it } from "vitest";
import { withTiming } from "react-native-reanimated";
import {
	findAllByType,
	hasStyle,
	render,
	setReducedMotion,
} from "../__testing__/render";
import { StatusDot } from "../primitives/StatusDot";
import { SessionStatusChip } from ".";

describe("SessionStatusChip", () => {
	it.each([
		{ status: "running", unread: true, pending: true, tone: "pending" },
		{ status: "provisioning", unread: true, pending: false, tone: "pending" },
		{ status: "running", unread: true, pending: false, tone: "running" },
		{ status: "failed", unread: true, pending: false, tone: "unread" },
		{ status: "failed", unread: false, pending: false, tone: "neutral" },
		{ status: "completed", unread: false, pending: false, tone: "neutral" },
		{ status: "suspended", unread: false, pending: false, tone: "neutral" },
	] as const)("sidebar priority: $status / unread $unread / pending $pending", ({
		tone,
		...props
	}) => {
		const { root, unmount } = render(<SessionStatusChip {...props} sidebar />);
		expect(root.findAll((node) => node.type === StatusDot)[0]?.props.tone).toBe(
			tone,
		);
		if (tone === "neutral")
			expect(
				root.findAll((node) => node.type === StatusDot)[0]?.props.style,
			).toEqual({ opacity: 0 });
		unmount();
	});
	it.each([
		true,
		false,
	])("provisioning pulse respects Reduce Motion = %s", (reduced) => {
		setReducedMotion(reduced);
		const before = (withTiming as unknown as { mock: { calls: unknown[] } })
			.mock.calls.length;
		try {
			const { unmount } = render(
				<SessionStatusChip status="provisioning" sidebar />,
			);
			expect(
				(withTiming as unknown as { mock: { calls: unknown[] } }).mock.calls
					.length - before,
			).toBe(reduced ? 0 : 1);
			unmount();
		} finally {
			setReducedMotion(false);
		}
	});
	it.each([
		"completed",
		"suspended",
		"failed",
		"unknown",
	] as const)("%s with unread activity shows a visible blue dot", (status) => {
		const { root } = render(<SessionStatusChip status={status} unread plain />);
		expect(
			root.findAll((node) => node.type === StatusDot)[0]?.props,
		).toMatchObject({ tone: "unread", size: 6, style: { opacity: 1 } });
		expect(hasStyle(root, "backgroundColor", "#3b82f6")).toBe(true);
	});
	it("running takes precedence over unread, as in the desktop sidebar", () => {
		const { root } = render(
			<SessionStatusChip status="running" unread plain />,
		);
		expect(root.findAll((node) => node.type === StatusDot)[0]?.props.tone).toBe(
			"running",
		);
	});
	it("running → green dot", () => {
		const { root } = render(<SessionStatusChip status="running" />);
		expect(hasStyle(root, "backgroundColor", "#22c55e")).toBe(true);
		expect(
			root.findAll((node) => node.type === StatusDot)[0]?.props,
		).toMatchObject({
			size: 6,
			style: { opacity: 1 },
		});
	});

	it("failed → red dot", () => {
		const { root } = render(<SessionStatusChip status="failed" />);
		expect(hasStyle(root, "backgroundColor", "#ef4444")).toBe(true);
		expect(
			root.findAll((node) => node.type === StatusDot)[0]?.props,
		).toMatchObject({
			size: 6,
			style: { opacity: 1 },
		});
	});

	it.each([
		"unknown",
		"idle",
		"completed",
		"aborted",
		"provisioning",
		"stopped",
		"suspended",
		"expired",
	] as const)("%s → hidden neutral dot, matching desktop", (status) => {
		const { root } = render(<SessionStatusChip status={status} />);
		expect(hasStyle(root, "backgroundColor", "#6b7280")).toBe(true);
		expect(
			root.findAll((node) => node.type === StatusDot)[0]?.props,
		).toMatchObject({
			size: 6,
			style: { opacity: 0 },
		});
	});
	it.each([
		"completed",
		"suspended",
	] as const)("hides the %s dot in plain and dot-only presentations too", (status) => {
		for (const props of [{ plain: true }, { dotOnly: true }]) {
			const { root } = render(<SessionStatusChip status={status} {...props} />);
			expect(
				root.findAll((node) => node.type === StatusDot)[0]?.props,
			).toMatchObject({
				size: 6,
				style: { opacity: 0 },
			});
		}
	});

	it("dotOnly renders just the marker, no pill text", () => {
		const { root } = render(<SessionStatusChip status="running" dotOnly />);
		expect(findAllByType(root, "Text").length).toBe(0);
	});

	it("plain renders desktop's dot and label without a filled pill", () => {
		const { root } = render(<SessionStatusChip status="running" plain />);
		expect(findAllByType(root, "Text")).toHaveLength(1);
		expect(hasStyle(root, "backgroundColor", "#1f2023")).toBe(false);
	});
});
