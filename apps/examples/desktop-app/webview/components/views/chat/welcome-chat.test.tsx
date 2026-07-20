import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WelcomeScreen } from "./welcome-chat";

describe("WelcomeScreen", () => {
	it("renders every known project instead of capping the project strip", () => {
		const workspaces = Array.from(
			{ length: 6 },
			(_, index) => `/projects/project-${index + 1}`,
		);
		const html = renderToStaticMarkup(
			<WorkspaceProvider
				value={{
					workspaceRoot: workspaces[0] ?? "",
					workspaces,
					listWorkspaces: vi.fn(async () => workspaces),
					refreshWorkspaces: vi.fn(async () => undefined),
					switchWorkspace: vi.fn(async () => true),
					pickWorkspaceDirectory: vi.fn(async () => null),
				}}
			>
				<WelcomeScreen
					active
					body={null}
					composer={null}
					onStartChat={vi.fn()}
					quickActions={[]}
				/>
			</WorkspaceProvider>,
		);

		for (let index = 1; index <= workspaces.length; index += 1) {
			expect(html).toContain(`project-${index}`);
		}
	});
});
