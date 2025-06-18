/* ==========================================================================
   system.ts  ——  Miibo 専用の最小実装（コピペ用）
   * 15 kB 制限に合うよう SYSTEM_PROMPT_MIIBO は “ガードレールのみ”
   * Claude4 など他モデル向けロジックはすべて削除
   * isMiiboModelFamily=true で必ず短縮プロンプトを返す
   ========================================================================== */

import { getShell } from "@utils/shell"
import os from "os"
import osName from "os-name"
import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"

/* --------------------------------------------------------------------------
 * 短縮版システムプロンプト（≈ 4 kB）
 *   – 巨大なルール／ツール一覧は **ナレッジストア(1レコード/全文採用)** に退避
 *   – ここでは動的パラメータと最低限の制約だけを宣言
 * ------------------------------------------------------------------------ */
function SYSTEM_PROMPT_MIIBO(
	cwd: string,
	supportsBrowserUse: boolean,
	_mcpHub: McpHub, // 使わないがシグネチャ互換のため残す
	browserSettings: BrowserSettings,
): string {
	return `
   You are Cline, a senior software engineer.
   
   ====  TOOL USE  ====
   ・Use **one tool per message**.  
   ・Tool calls must follow the XML tag format <tool><param>…</param></tool>.  
   ・After each tool use, wait for the user’s confirmation before the next step.
   
   ====  RUNTIME  ====
   Current WD : ${cwd.toPosix()}  
   OS         : ${osName()} — default shell ${getShell()}
   
   ${supportsBrowserUse ? `Browser viewport: ${browserSettings.viewport.width}×${browserSettings.viewport.height}` : ""}
   
   RULES
   1. Never \`cd\` outside the working directory.
   2. Do not exceed the user-message limit (15 000 chars incl. this prompt).
   3. Be concise and technical; avoid chit-chat.
   4. Finish with the attempt_completion tool when the task is done.
   
   <!-- MIIBO_PROMPT_END -->
   `.trim()
}

/* --------------------------------------------------------------------------
 * エクスポート関数
 *   – isMiiboModelFamily=true なら短縮プロンプト
 *   – それ以外の場合は空文字を返し、呼び出し側で別ロジックに委譲
 * ------------------------------------------------------------------------ */
export const SYSTEM_PROMPT = async (
	cwd: string,
	supportsBrowserUse: boolean,
	mcpHub: McpHub,
	browserSettings: BrowserSettings,
	_isClaude4ModelFamily: boolean = false,
	isMiiboModelFamily: boolean = false,
): Promise<string> => {
	if (isMiiboModelFamily) {
		return SYSTEM_PROMPT_MIIBO(cwd, supportsBrowserUse, mcpHub, browserSettings)
	}
	/* ここでは他モデル用プロンプトを返さない。
        既存プロジェクト側で従来の SYSTEM_PROMPT_* を呼び出してください。 */
	return ""
}
