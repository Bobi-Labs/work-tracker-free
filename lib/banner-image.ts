/**
 * Custom banner images — the whole policy in one file.
 *
 * The constraint that shapes everything here: this app makes NO network
 * requests, ever, and a board must stay portable (one export = the whole
 * board, openable offline, from `file://`, or in a desktop build). A banner
 * image therefore cannot be a remote URL — it must travel INSIDE the document.
 * So: the user picks a local file, we downscale and compress it on a canvas,
 * and store the result as a `data:image/…` URI in `settings.bannerUrl`.
 *
 * That also bounds the size problem. localStorage quota is ~5 MB for the whole
 * origin and a phone photo is 4 MB on its own, so images are resized to banner
 * resolution and re-encoded at descending quality until they fit a hard cap.
 * The banner renders at ~1400 CSS px wide at most; 1600 px keeps it crisp on
 * 2x displays without carrying megabytes of pixels nobody sees.
 */

/** Wide enough for the banner at 2x, small enough to keep the doc light. */
const MAX_WIDTH = 1600;

/**
 * Hard cap on the stored data-URI length (~640 KB of image). Enforced both
 * when creating (below) and when validating an *imported* board (schema.ts) —
 * an import carrying a 4 MB banner would blow the localStorage quota on the
 * very next save, which surfaces as "NOT SAVING" long after the cause.
 */
export const MAX_BANNER_DATA_URL_CHARS = 900_000;

/**
 * The render-site gate, same duty as `safeAccent` for gradients.
 *
 * `settings.bannerUrl` can arrive from an imported file the user did not
 * write. A remote URL in here would turn "open a board someone sent me" into
 * a network beacon that leaks the user's IP and open-time — the exact inversion
 * of the product's one promise. So only `data:image/` URIs render; anything
 * else falls back to the gradient accent. (This is also why the app never
 * *creates* anything but data URIs.)
 *
 * The character check is belt and braces for the CSS `url("…")` injection
 * surface: a legitimate base64 data URI never contains quotes, parentheses,
 * or whitespace.
 */
export function safeBannerImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("data:image/")) return null;
  if (/["'()\s\\]/.test(url)) return null;
  return url;
}

/**
 * Local image file → banner-sized `data:image/jpeg` URI.
 *
 * Runs entirely in the browser: nothing is uploaded, because there is nowhere
 * to upload to. Throws with a user-facing message when the file is not an
 * image or cannot be compressed under the cap.
 */
export async function processBannerImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read. Try a JPEG or PNG.");
  }

  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not process the image.");

    // JPEG has no alpha channel, so transparency composites onto black by
    // default — paint white first so a transparent-background logo stays
    // legible in the light theme too.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Descending quality until it fits. JPEG (not WebP): every canvas
    // implementation encodes it, and banners are photos-or-gradients where
    // JPEG artefacts are invisible at these sizes.
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= MAX_BANNER_DATA_URL_CHARS) return url;
    }
    throw new Error(
      "That image is too large even after compression. Try a smaller or simpler image.",
    );
  } finally {
    bitmap.close();
  }
}
