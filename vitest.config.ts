import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  resolve: {
    // To deal with "Error: No known conditions for "./node" specifier in "msw" package"
    // From https://github.com/solidjs/vite-plugin-solid/issues/125
    alias: [{ find: "msw/node", replacement: "/node_modules/msw/lib/native/index.mjs" }],
  },
  test: {
    //setupFiles: ["/tests/setup.ts"],
    dir: "tests/unit",
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
      main: "./functions/get-best-card.ts",
    },
  },
});
