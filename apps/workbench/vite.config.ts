import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const PDFJS_WASM = resolve(__dirname, "node_modules/pdfjs-dist/wasm");
const PDFJS_WASM_FILES = ["jbig2.wasm", "openjpeg.wasm"];

function pdfjsWasm(): Plugin {
  return {
    name: "pdfjs-wasm",
    configureServer(server) {
      server.middlewares.use("/pdfjs-wasm/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!PDFJS_WASM_FILES.includes(name)) return next();
        res.setHeader("content-type", "application/wasm");
        res.end(readFileSync(join(PDFJS_WASM, name)));
      });
    },
    generateBundle() {
      for (const name of PDFJS_WASM_FILES) {
        this.emitFile({ type: "asset", fileName: `pdfjs-wasm/${name}`, source: readFileSync(join(PDFJS_WASM, name)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsWasm()],
  base: "/",
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome130",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        probe: resolve(__dirname, "probe.html"),
      },
    },
  },
});
