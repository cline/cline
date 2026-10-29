export type CloudRepositoryOption = {
	id: number;
	name: string;
	fullName: string;
	url: string;
	defaultBranch: string;
};

export type CloudRepositoryListResult = {
	connected: boolean;
	connectUrl: string;
	repositories: CloudRepositoryOption[];
};

export type CloudBranchListResult = {
	available: boolean;
	branches: string[];
	nextToken?: string;
};

export type CloudBranchListOptions = {
	cursor?: string;
	query?: string;
};
