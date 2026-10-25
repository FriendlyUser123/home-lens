import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API on PORT (default 8710), web on WEB_PORT (default 5180)
const api = Number(process.env.PORT ?? 8710);
const web = Number(process.env.WEB_PORT ?? 5180);

export default defineConfig({
  plugins: [react()],
  server: { port: web, strictPort: true, proxy: { "/api": `http://localhost:${api}` } },
});
