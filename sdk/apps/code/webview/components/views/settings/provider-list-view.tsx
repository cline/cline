"use client";

import {
	ArrowLeft,
	Copy,
	Eye,
	EyeOff,
	Link as LinkIcon,
	Loader2,
	Paperclip,
	PlusCircle,
	RefreshCw,
	Settings2,
	Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { Provider } from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

// -----------------------------------------------------------
// Provider LIST content (the grid of all providers)
// -----------------------------------------------------------

export function ProviderListContent({
	providers,
	onToggle,
	onConfigure,
	onAddProvider,
}: {
	providers: Provider[];
	onToggle: (id: string) => void;
	onConfigure: (id: string) => void;
	onAddProvider: () => void;
}) {
	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">
						Model Providers
					</h2>
					<Button
						className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3.5 py-2 text-sm font-medium text-foreground hover:bg-accent/80 transition-colors"
						onClick={onAddProvider}
						variant="ghost"
					>
						<PlusCircle className="h-4 w-4" />
						Add Provider
					</Button>
				</div>

				<div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
					{providers.map((prov) => (
						<div
							className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/30"
							key={prov.id}
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">
									{prov.name}
								</p>
								<p className="text-xs text-muted-foreground">
									{prov.models === null
										? "Models load on demand"
										: `${prov.models} Model${prov.models !== 1 ? "s" : ""}`}
								</p>
							</div>
							<Button
								aria-label={`Configure ${prov.name}`}
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								onClick={() => onConfigure(prov.id)}
								variant="ghost"
							>
								<Settings2 className="h-4 w-4" />
							</Button>
							<Switch
								aria-label={`Toggle ${prov.name}`}
								checked={prov.enabled}
								onCheckedChange={() => onToggle(prov.id)}
							/>
						</div>
					))}
				</div>
			</div>
		</ScrollArea>
	);
}

export function ProviderDetailContent({
	provider,
	onBack,
	onUpdate,
	onLoadModels,
	modelsLoading = false,
	modelsError,
	onOAuthLogin,
	oauthLoginPending = false,
}: {
	provider: Provider;
	onBack: () => void;
	onUpdate: (updates: Partial<Provider>) => void;
	onLoadModels?: () => void;
	modelsLoading?: boolean;
	modelsError?: string | null;
	onOAuthLogin?: () => void;
	oauthLoginPending?: boolean;
}) {
	const [showApiKey, setShowApiKey] = useState(false);
	const [localApiKey, setLocalApiKey] = useState(provider.apiKey ?? "");
	const [localBaseUrl, setLocalBaseUrl] = useState(provider.baseUrl ?? "");

	useEffect(() => {
		setLocalApiKey(provider.apiKey ?? "");
		setLocalBaseUrl(provider.baseUrl ?? "");
	}, [provider.apiKey, provider.baseUrl]);

	const handleCopyKey = () => {
		if (localApiKey) {
			navigator.clipboard.writeText(localApiKey);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				{/* Back + title */}
				<div className="mb-8 flex items-center gap-3">
					<Button
						aria-label="Back to providers"
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={onBack}
						variant="ghost"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<h2 className="text-lg font-semibold text-foreground">
						{provider.name}
					</h2>
				</div>

				{/* API Key section */}
				<section className="mb-8">
					<header className="flex items-center justify-between mb-2">
						<h3 className="mb-2 text-sm font-semibold text-foreground">
							API Key
						</h3>
						<p className="mb-3 text-sm leading-relaxed text-muted-foreground">
							{provider.authDescription ?? "API key issued by the provider"}
							{provider.docUrl && (
								<>
									See the{" "}
									<span className="cursor-pointer text-primary hover:underline">
										{provider.docLabel ?? "documentation"}
									</span>{" "}
									for more information.
								</>
							)}
						</p>
					</header>
					{
						<div className="flex items-center gap-2 rounded-lg border border-border bg-input px-4 py-3">
							<Input
								className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
								onBlur={() => onUpdate({ apiKey: localApiKey })}
								onChange={(e) => setLocalApiKey(e.target.value)}
								placeholder="Enter API key..."
								spellCheck={false}
								type={showApiKey ? "text" : "password"}
								value={localApiKey}
							/>
							<Button
								aria-label={showApiKey ? "Hide API key" : "Show API key"}
								className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
								onClick={() => setShowApiKey((v) => !v)}
								variant="ghost"
							>
								{showApiKey ? (
									<EyeOff className="h-4 w-4" />
								) : (
									<Eye className="h-4 w-4" />
								)}
							</Button>
							<Button
								aria-label="Copy API key"
								className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
								onClick={handleCopyKey}
								variant="ghost"
							>
								<Copy className="h-4 w-4" />
							</Button>
						</div>
					}
					{!localApiKey && !provider.oauthAccessTokenPresent && onOAuthLogin ? (
						<div className="mt-3">
							<Button
								className="inline-flex items-center gap-2 w-full"
								disabled={oauthLoginPending}
								onClick={onOAuthLogin}
								variant="default"
							>
								{oauthLoginPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : null}
								<span>Login via Browser</span>
							</Button>
						</div>
					) : null}
					{provider.oauthAccessTokenPresent ? (
						<p className="mt-3 text-xs text-muted-foreground">
							OAuth is connected. API key field remains available for manual
							overrides.
						</p>
					) : null}
				</section>

				{/* Base URL section */}
				<section className="mb-8">
					<header className="flex items-center justify-between mb-2">
						<h3 className="mb-2 text-sm font-semibold text-foreground">
							Base URL
						</h3>
						<p className="mb-3 text-sm leading-relaxed text-muted-foreground">
							{provider.baseUrlDescription ??
								"The base OpenAI-compatible endpoint to use."}{" "}
							{provider.docUrl && (
								<>
									See the{" "}
									<span className="cursor-pointer text-primary hover:underline">
										{provider.docLabel ?? "documentation"}
									</span>{" "}
									for more information.
								</>
							)}
						</p>
					</header>
					<div className="flex items-center gap-2 rounded-lg border border-border bg-input px-4 py-3">
						<LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
						<Input
							className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
							onBlur={() => onUpdate({ baseUrl: localBaseUrl })}
							onChange={(e) => setLocalBaseUrl(e.target.value)}
							placeholder="https://..."
							spellCheck={false}
							type="url"
							value={localBaseUrl}
						/>
					</div>
				</section>

				{/* Models section */}
				<section>
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-sm font-semibold text-foreground">Models</h3>
						<div className="flex items-center gap-1">
							<Button
								aria-label="Refresh models"
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								disabled={modelsLoading}
								onClick={onLoadModels}
								variant="ghost"
							>
								<RefreshCw
									className={cn("size-3", modelsLoading && "animate-spin")}
								/>
							</Button>
						</div>
					</div>

					{modelsError ? (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-destructive">{modelsError}</p>
						</div>
					) : provider.modelList && provider.modelList.length > 0 ? (
						<div className="flex flex-col divide-y divide-border rounded-lg border border-border max-h-125 overflow-y-scroll">
							{provider.modelList.map((model) => (
								<div
									className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30"
									key={model.id}
								>
									{/* Model name */}
									<span className="flex-1 text-sm text-foreground font-mono">
										<div className="flex items-center gap-1.5">
											{model.name}
											{/* Capability icons */}
											{model.supportsAttachments && (
												<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
											)}
											{model.supportsVision && (
												<Eye className="h-3.5 w-3.5 text-muted-foreground" />
											)}
										</div>
									</span>

									{/* Action icons */}
									<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
										<Button
											aria-label={`Favorite ${model.name}`}
											className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
											variant="ghost"
										>
											<Star className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-muted-foreground">
								{modelsLoading
									? "Loading models..."
									: "No models available. Click refresh to load models."}
							</p>
						</div>
					)}
				</section>
			</div>
		</ScrollArea>
	);
}
