const { DeploymentApi } = require("@sap-ai-sdk/ai-api");

const { fetch } = require("undici");

async function run() {
	console.log("Proxy env vars:", {
		http_proxy: process.env.http_proxy,
		https_proxy: process.env.https_proxy,
		HTTP_PROXY: process.env.HTTP_PROXY,
		HTTPS_PROXY: process.env.HTTPS_PROXY,
	});

	const clientId = "dummy-client-id";
	const clientSecret = "dummy-client-secret";
	const tokenUrl =
		"https://example.authentication.sap.hana.ondemand.com/oauth/token";
	const baseUrl = "https://api.ai.example.aws.ml.hana.ondemand.com";

	try {
		console.log("Fetching token manually...");
		const tokenResponse = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
			},
			body: "grant_type=client_credentials",
		});

		console.log("Token response status:", tokenResponse.status);
		const tokenData = await tokenResponse.json();
		const accessToken = tokenData.access_token || "mock-access-token";

		const destination = {
			url: baseUrl,
			authentication: "OAuth2ClientCredentials",
			authTokens: [
				{
					type: "Bearer",
					value: accessToken,
					error: null,
					expiresIn: "3600",
					http_header: {
						key: "Authorization",
						value: `Bearer ${accessToken}`,
					},
				},
			],
		};

		console.log("Destination object prepared:", destination);

		console.log("Querying deployments...");
		const response = await DeploymentApi.deploymentQuery(
			{},
			{
				"AI-Resource-Group": "default",
			},
		).execute(destination);
		console.log("Success:", response);
	} catch (error) {
		console.error("Error occurred:");
		console.error(error);
		if (error.cause) {
			console.error("Cause:", error.cause);
		}
	}
}

run();
