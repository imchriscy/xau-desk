import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 打包进 Electron 时去掉 crossorigin，避免内嵌静态服务下模块脚本不执行 */
function stripCrossOrigin() {
  return {
    name: "strip-crossorigin",
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin/g, "");
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCrossOrigin()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    open: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5191",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5191",
        changeOrigin: true,
      },
    },
  },
});
