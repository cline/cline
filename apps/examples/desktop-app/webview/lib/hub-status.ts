export interface HubActivity {
	id: number;
	timestamp: number;
	title: string;
	detail: string;
}

export interface HubStatus {
	url: string;
	clients: Array<{
		clientId: string;
		clientType: string;
		displayName?: string;
		connectedAt: number;
	}>;
	events: HubActivity[];
}
