/**
 * Minimal Cloudflare Worker entry point for the static Vite bundle.
 *
 * Sites supplies the ASSETS binding. Asset requests are served directly; paths
 * without a file extension fall back to the SPA entry point so future
 * client-side routes remain refresh-safe.
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const pathname = new URL(request.url).pathname;

    if (response.status !== 404 || pathname.includes('.')) {
      return response;
    }

    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  },
};
