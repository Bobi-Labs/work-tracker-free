import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * Static export. The build is plain files — no server, no database, and nothing
 * at runtime ever reads `process.env`. `pnpm build` emits ./out, and that
 * directory is the whole application.
 *
 * ── basePath ──────────────────────────────────────────────────────────────
 * DEFAULT: none. That is the correct — and only workable — setting for the
 * three targets that matter most: a domain root, a `file://` open (exactly what
 * someone does after downloading a release), and a desktop shell. A basePath
 * breaks all three.
 *
 * OPT-IN: set BASE_PATH at BUILD time if, and only if, the site is served from
 * a sub-path — GitHub Pages project sites (`<org>.github.io/<repo>/`), or a
 * reverse-proxy mount like `/worktracker`. Without it, every asset 404s under a
 * sub-path; with it, the `file://` and desktop builds break. It is genuinely a
 * per-deployment fact, which is why it is a build flag and not a constant.
 *
 *   BASE_PATH=/work-tracker-free pnpm build
 *
 * This is the only environment variable the project reads, and it is optional.
 *
 * ── turbopack.root ────────────────────────────────────────────────────────
 * Pins the workspace root to THIS directory. While this app lives nested inside
 * its parent repo, Next would otherwise walk up, find the parent's lockfile and
 * adopt that as the root. Harmless once standalone; wrong before then.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

const basePath = process.env.BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: __dirname },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
