import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const proxy = { "/api": process.env.SAAS_API_TARGET || "http://127.0.0.1:5299" };
export default defineConfig({ plugins: [react()],
  server: { host: "127.0.0.1", port: 5288, strictPort: true, proxy },
  preview: { host: "127.0.0.1", proxy },
});
