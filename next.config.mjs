import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * Static export. The build is plain files — no server, no database, and nothing
 * at runtime ever reads `process.env`. `pnpm build` emits ./out, and that
 * directory is the whole application.
 *
 * ── basePath ──────────────────────────────────────────────────────────────
 * DEFAULT: none. Correct for a domain root and a desktop shell. NOT enough
 * for `file://`: the default build still emits root-absolute `/_next/...`
 * asset URLs, which resolve to the drive root from a double-clicked
 * index.html and load nothing. `file://` needs RELATIVE_ASSETS below —
 * this was found the hard way, after a release note claimed otherwise.
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

/**
 * RELATIVE_ASSETS=1 emits `./_next/...` asset URLs instead of `/_next/...`,
 * which is what lets the build run from `file://` (double-clicked index.html,
 * USB stick) where root-absolute paths resolve to the drive root and nothing
 * loads. Used for release tarballs. Mutually exclusive with BASE_PATH.
 */
const relativeAssets = process.env.RELATIVE_ASSETS === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: __dirname },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  ...(relativeAssets && !basePath ? { assetPrefix: './' } : {}),
};

export default nextConfig;
