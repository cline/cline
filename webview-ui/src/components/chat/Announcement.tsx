import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "../../utils/vscStyles"
import { vscode } from "../../utils/vscode"

interface AnnouncementProps {
	version: string //
	hideAnnouncement: () => void
}

/*
You must update the latestAnnouncementId in ClineProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<div
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
				borderRadius: "3px",
				padding: "12px 16px",
				margin: "5px 15px 5px 15px",
				position: "relative",
				flexShrink: 0,
			}}>
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={{ margin: "0 0 8px" }}>
				🎉{"  "}盛世中华——新版来袭 v{minorVersion}
			</h3>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					<b>添加到Cline:</b>{" "}
					在任何文件或终端中右键点击选中的文本，快速将其添加为当前任务的上下文！此外，当你看到灯泡图标时，选择'用Cline修复'可以让Cline修复代码中的错误。
				</li>
				<li>
					<b>账单仪表盘:</b> 在扩展中直接跟踪剩余积分和交易历史，使用{" "}
					<span className="codicon codicon-account" style={{ fontSize: 11 }}></span> Cline账户！
				</li>
				<li>
					<b>更快的推理:</b>{" "}
					Cline/OpenRouter用户可以根据吞吐量、价格和延迟对底层提供商进行排序。按吞吐量排序将获得更快的生成速度(但成本更高)。
				</li>
				<li>
					<b>增强的MCP支持:</b> 支持动态图像加载和GIF，新增删除按钮可清理失败的服务器。
				</li>
			</ul>
			{/*<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				 <li>
					OpenRouter now supports prompt caching! They also have much higher rate limits than other providers,
					so I recommend trying them out.
					<br />
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(vscodeUriScheme)}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					{apiConfiguration?.openRouterApiKey && apiConfiguration?.apiProvider !== "openrouter" && (
						<VSCodeButton
							onClick={() => {
								vscode.postMessage({
									type: "apiConfiguration",
									apiConfiguration: { ...apiConfiguration, apiProvider: "openrouter" },
								})
							}}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Switch to OpenRouter
						</VSCodeButton>
					)}
				</li>
				<li>
					<b>Edit Cline's changes before accepting!</b> When he creates or edits a file, you can modify his
					changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in
					the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					New <code>search_files</code> tool that lets Cline perform regex searches in your project, letting
					him refactor code, address TODOs and FIXMEs, remove dead code, and more!
				</li>
				<li>
					When Cline runs commands, you can now type directly in the terminal (+ support for Python
					environments)
				</li>
			</ul>*/}
			<div
				style={{
					height: "1px",
					background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>
			<p style={{ margin: "0" }}>
				加入我们{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://github.com/dxdw2021/cline">
					盛世中华 Cline 中文版本,
				</VSCodeLink>{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://github.com/dxdw2021/cline">
					盛世中华 Cline 中文版本,
				</VSCodeLink>{" "}
				和{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://github.com/dxdw2021/cline">
					盛世中华 Cline 中文版本
				</VSCodeLink>
				获取更多更新！
			</p>
		</div>
	)
}

export default memo(Announcement)
