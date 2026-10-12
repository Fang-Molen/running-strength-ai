import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * Mainland share build. No Grok PWA injector, no preview-only plugins.
 * Prerender `/` into static files that can sit on any static host.
 */
export default defineConfig({
  preview: {
    host: "127.0.0.1",
    port: 8099,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
        failOnError: true,
      },
      pages: [{ path: "/" }],
    }),
    nitro({
      preset: "static",
      output: { dir: "share-build" },
      serverDir: "./share-server",
    }),
    viteReact(),
  ],
});
