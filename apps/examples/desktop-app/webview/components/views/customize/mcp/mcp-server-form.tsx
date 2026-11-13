import {
	DetailList,
	DetailListItem,
	IconButton,
	SectionHeading,
	SegmentedControl,
} from "@cline/ui";
import { Minus, Plus } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AdvancedSection } from "../../shared/advanced-section";
import styles from "../../shared/form-controls.module.css";
import { PathDetailListItem } from "../shared/path-detail-list-item";
import {
	createEnvEntries,
	type McpServerFormState,
	serverTypeOf,
} from "./mcp-server-form-state";

export function McpServerForm({
	form,
	setForm,
	disabled,
	settingsPath,
}: {
	form: McpServerFormState;
	setForm: Dispatch<SetStateAction<McpServerFormState>>;
	disabled: boolean;
	settingsPath: string;
}) {
	const [advancedOpen, setAdvancedOpen] = useState(
		() => Boolean(form.cwd.trim()) || Boolean(form.metadataText.trim()),
	);
	const local = form.transportType === "stdio";
	const updateEnvEntry = (id: string, field: "key" | "value", value: string) =>
		setForm((current) => ({
			...current,
			envEntries: current.envEntries.map((entry) =>
				entry.id === id ? { ...entry, [field]: value } : entry,
			),
		}));
	return (
		<fieldset disabled={disabled} className="flex min-w-0 flex-col gap-8">
			<legend className="sr-only">MCP server settings</legend>
			<DetailList>
				<DetailListItem
					title={<span id="mcp-server-type-label">Server type</span>}
					description={
						<span id="mcp-server-type-description">
							{local
								? "Runs a command on this machine (stdio). Recommended when available."
								: "Connects to a hosted server over HTTP by URL."}
						</span>
					}
					actions={
						<SegmentedControl
							aria-labelledby="mcp-server-type-label"
							aria-describedby="mcp-server-type-description"
							className="w-64 max-w-full"
							size="sm"
							disabled={disabled}
							value={serverTypeOf(form.transportType)}
							options={[
								{ value: "local", label: "Local" },
								{ value: "remote", label: "Remote" },
							]}
							onValueChange={(value) => {
								if (disabled || (value !== "local" && value !== "remote"))
									return;
								setForm((current) => ({
									...current,
									transportType:
										value === "local"
											? "stdio"
											: serverTypeOf(current.transportType) === "remote"
												? current.transportType
												: "streamableHttp",
								}));
							}}
						/>
					}
				/>
				{local ? (
					<>
						<DetailListItem
							title={<Label htmlFor="mcp-command">Command</Label>}
							actions={
								<Input
									id="mcp-command"
									className={cn(styles.control, "w-64 max-w-full")}
									disabled={disabled}
									value={form.command}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											command: event.target.value,
										}))
									}
									placeholder="npx"
								/>
							}
						/>
						<DetailListItem
							title={<Label htmlFor="mcp-args">Args</Label>}
							description="Comma-separated arguments."
							actions={
								<Textarea
									id="mcp-args"
									className={cn(styles.control, "w-64 max-w-full")}
									disabled={disabled}
									value={form.argsText}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											argsText: event.target.value,
										}))
									}
									placeholder="-y, @modelcontextprotocol/server-github"
								/>
							}
						/>
					</>
				) : (
					<>
						<DetailListItem
							title={<Label htmlFor="mcp-url">Server URL</Label>}
							actions={
								<Input
									id="mcp-url"
									className={cn(styles.control, "w-64 max-w-full")}
									disabled={disabled}
									value={form.url}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											url: event.target.value,
										}))
									}
									placeholder="https://example.com/mcp"
								/>
							}
						/>
						<DetailListItem
							title={<Label htmlFor="mcp-headers">Headers</Label>}
							description="Comma-separated key=value pairs."
							actions={
								<Textarea
									id="mcp-headers"
									className={cn(styles.control, "w-64 max-w-full")}
									disabled={disabled}
									value={form.headersText}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											headersText: event.target.value,
										}))
									}
									placeholder="Authorization=Bearer token"
								/>
							}
						/>
						<DetailListItem
							title={<Label htmlFor="mcp-transport">Transport</Label>}
							actions={
								<Select
									disabled={disabled}
									value={form.transportType}
									onValueChange={(transportType) => {
										if (
											disabled ||
											(transportType !== "sse" &&
												transportType !== "streamableHttp")
										)
											return;
										setForm((current) => ({ ...current, transportType }));
									}}
								>
									<SelectTrigger
										id="mcp-transport"
										className={cn(styles.control, "w-64 max-w-full")}
									>
										<SelectValue placeholder="Select transport" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="streamableHttp">
											Streamable HTTP (recommended)
										</SelectItem>
										<SelectItem value="sse">SSE (legacy)</SelectItem>
									</SelectContent>
								</Select>
							}
						/>
					</>
				)}
			</DetailList>
			{local && (
				<section
					aria-labelledby="mcp-env-heading"
					className="min-w-0 space-y-4"
				>
					<SectionHeading
						size="md"
						headingLevel={2}
						title={<span id="mcp-env-heading">Environment variables</span>}
						actions={
							<IconButton
								type="button"
								size="sm"
								aria-label="Add environment variable"
								disabled={disabled}
								icon={Plus}
								onClick={() =>
									setForm((current) => ({
										...current,
										envEntries: [...current.envEntries, ...createEnvEntries()],
									}))
								}
							/>
						}
					/>
					<div className="flex min-w-0 flex-col gap-2">
						{form.envEntries.map((entry, index) => (
							<div key={entry.id} className="flex min-w-0 items-center gap-2">
								<Input
									className={cn(styles.control, "flex-1")}
									aria-label={`Environment variable ${index + 1} name`}
									disabled={disabled}
									value={entry.key}
									onChange={(event) =>
										updateEnvEntry(entry.id, "key", event.target.value)
									}
									placeholder="KEY"
								/>
								<Input
									className={cn(styles.control, "flex-1")}
									aria-label={`Environment variable ${index + 1} value`}
									type="password"
									disabled={disabled}
									value={entry.value}
									onChange={(event) =>
										updateEnvEntry(entry.id, "value", event.target.value)
									}
									placeholder="VALUE"
								/>
								<IconButton
									type="button"
									size="xs"
									aria-label={`Remove env var ${entry.key || "row"}`}
									disabled={disabled}
									icon={Minus}
									onClick={() =>
										setForm((current) => ({
											...current,
											envEntries:
												current.envEntries.length === 1
													? createEnvEntries()
													: current.envEntries.filter(
															(item) => item.id !== entry.id,
														),
										}))
									}
								/>
							</div>
						))}
					</div>
				</section>
			)}
			<AdvancedSection
				id="mcp-advanced"
				open={advancedOpen}
				onOpenChange={setAdvancedOpen}
				disabled={disabled}
			>
				<DetailList>
					{local && (
						<DetailListItem
							title={<Label htmlFor="mcp-cwd">Working directory</Label>}
							actions={
								<Input
									id="mcp-cwd"
									className={cn(styles.control, "w-64 max-w-full")}
									disabled={disabled}
									value={form.cwd}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											cwd: event.target.value,
										}))
									}
									placeholder="/path/to/project"
								/>
							}
						/>
					)}
					<DetailListItem
						title={<Label htmlFor="mcp-metadata">Metadata JSON</Label>}
						description={
							<Textarea
								id="mcp-metadata"
								className={cn(styles.control, "mt-1.5")}
								disabled={disabled}
								value={form.metadataText}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										metadataText: event.target.value,
									}))
								}
								placeholder='{"key":"value"}'
							/>
						}
					/>
					<PathDetailListItem
						path={settingsPath}
						label="MCP settings path"
						title="MCP settings path"
						trailingText={
							<span className="break-all font-mono">{settingsPath}</span>
						}
					/>
				</DetailList>
			</AdvancedSection>
		</fieldset>
	);
}
