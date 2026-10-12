import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // About Gitgel shows when this build was made.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },

  // Pre-bundle up front so the first `tauri dev` does not re-optimize and reload mid-render
  // (which briefly loads two React copies and throws "Invalid hook call").
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'zustand',
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/path',
      '@tauri-apps/api/webview',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/api/window',
      '@monaco-editor/react',
      'monaco-editor/editor/editor.api',
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
