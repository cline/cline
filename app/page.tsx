import { App } from "./GatewayApp";
import { getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <App
      defaultToken={process.env.VITE_CLINE_GATEWAY_TOKEN}
      defaultUrl={process.env.CLINE_DAD_URL}
      userDisplayName={user?.displayName}
    />
  );
}
