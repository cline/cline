import { NodeHubClient } from "..";

const url = process.env.CLINE_TEST_HUB_URL;
const authorization = process.env.CLINE_TEST_HUB_AUTHORIZATION;
if (!url || !authorization) {
	throw new Error("Missing CLINE_TEST_HUB_URL or CLINE_TEST_HUB_AUTHORIZATION");
}

const client = new NodeHubClient({
	url,
	resolveConnectionHeaders: () => ({ Authorization: authorization }),
});

try {
	await client.connect();
	console.log("connected");
} finally {
	client.close();
}
