import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = "http://127.0.0.1:" + (env.PORT || 3001);
  return {
    plugins: [react(), tailwind()],
    optimizeDeps: { include: ["three"] },
    build: { outDir: "dist/client" },
    server: {
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/assets/**",
          "**/server/**",
          "**/tests/**",
          "**/scripts/**",
          "**/uploads/**",
          "**/картинки для квиза/**",
          "**/data/**",
          "**/backups/**",
          "**/.local/**",
          "**/playwright-report/**",
          "**/test-results/**",
        ],
      },
      watch: {
        ignored: [
          "**/.local/**",
          "**/data/**",
          "**/uploads/**",
          "**/картинки для квиза/**",
          "**/backups/**",
          "**/playwright-report/**",
          "**/test-results/**",
        ],
      },
      proxy: {
        "/api": { target, changeOrigin: false },
        "/media": { target, changeOrigin: false },
        "/socket.io": { target, ws: true, changeOrigin: false },
      },
    },
  };
});
