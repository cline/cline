import { vscode } from "../utils/vscode"

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

class GitService {
	private commits: GitCommit[] | null = null
	private lastQuery: string = ''

	async searchCommits(query: string = ''): Promise<GitCommit[]> {
		if (query === this.lastQuery && this.commits) {
			return this.commits
		}

		// Request search from extension
		vscode.postMessage({ type: 'searchCommits', query })
		
		// Wait for response
		const response = await new Promise<GitCommit[]>((resolve) => {
			const handler = (event: MessageEvent) => {
				const message = event.data
				if (message.type === 'commitSearchResults') {
					window.removeEventListener('message', handler)
					resolve(message.commits)
				}
			}
			window.addEventListener('message', handler)
		})

		this.commits = response
		this.lastQuery = query
		return response
	}

	clearCache() {
		this.commits = null
		this.lastQuery = ''
	}
}

export const gitService = new GitService()