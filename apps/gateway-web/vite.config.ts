import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: { port: 4174 },
	preview: { port: 4174 },
});
