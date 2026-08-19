import { App } from "./GatewayApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return <App defaultUrl={process.env.CLINE_DAD_URL} />;
}
