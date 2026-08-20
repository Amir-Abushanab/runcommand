import { defineConfig } from "astro/config";

// GitHub Pages (project page → https://amir-abushanab.github.io/runcommand/).
// `site` is the origin (canonical URLs / sitemap); `base` is the repo subpath.
export default defineConfig({
  site: "https://amir-abushanab.github.io",
  base: "/runcommand",
  // Let the OS select a free development port. `astro dev --port <number>`
  // still overrides this when a stable port is needed.
  server: {
    port: 0,
  },
});
