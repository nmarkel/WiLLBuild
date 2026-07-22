/**
 * Puppeteer is a devDependency used ONLY by the offline render rig
 * (scripts/render-rig/) to generate the viewer's WebP layers. The deployed
 * frontend never launches a browser, and puppeteer's default postinstall
 * downloads a ~150 MB Chromium binary that breaks sandboxed CI/CD builds
 * (e.g. Cloudflare Pages: restricted egress / disk / timeout).
 *
 * Skip the automatic download here so `npm ci` stays lean and reliable in
 * deploy environments. To run the render rig locally, fetch a browser once:
 *   npx puppeteer browsers install chrome
 */
module.exports = { skipDownload: true }
