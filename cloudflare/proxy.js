const HOSTNAME = 'daily-cf-problems.lucius7.dev';
const ORIGIN = 'https://thelucius7.github.io';
const PREFIX = '/Daily_CF_Problems';

export async function proxy(request, upstreamFetch = fetch) {
  const incoming = new URL(request.url);
  if (incoming.hostname !== HOSTNAME) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  // The custom domain serves this one GitHub Pages project at its root.
  // Old project-prefixed links are redirected to the canonical root paths.
  const prefixed = incoming.pathname === PREFIX || incoming.pathname.startsWith(`${PREFIX}/`);
  if (incoming.protocol !== 'https:' || prefixed) {
    const canonical = new URL(incoming);
    canonical.protocol = 'https:';
    if (prefixed) canonical.pathname = incoming.pathname.slice(PREFIX.length) || '/';
    return Response.redirect(canonical.href, 308);
  }
  let decoded;
  try { decoded = decodeURIComponent(incoming.pathname); }
  catch { return new Response('Invalid path', { status: 400 }); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part === '.')) {
    return new Response('Invalid path', { status: 400 });
  }
  const upstream = new URL(ORIGIN);
  upstream.pathname = PREFIX + incoming.pathname;
  upstream.search = incoming.search;

  // Forward only public static-file request headers, not lucius7.dev cookies
  // or authorization headers. No Cloudflare API credential is used at runtime.
  const headers = new Headers();
  for (const name of ['accept', 'accept-encoding', 'if-none-match', 'if-modified-since', 'range', 'if-range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let source;
  try {
    source = await upstreamFetch(upstream.href, {
      method: request.method, headers, redirect: 'manual',
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch {
    return new Response('The calendar is temporarily unavailable. Please try again later.', {
      status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const responseHeaders = new Headers(source.headers);
  responseHeaders.delete('set-cookie');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  const location = responseHeaders.get('location');
  if (location) {
    const target = new URL(location, upstream);
    if (target.origin !== ORIGIN || !(target.pathname === PREFIX || target.pathname.startsWith(`${PREFIX}/`))) {
      return new Response('Unexpected upstream redirect', { status: 502 });
    }
    target.hostname = HOSTNAME;
    target.pathname = target.pathname.slice(PREFIX.length) || '/';
    responseHeaders.set('location', target.href);
  }
  const hashedAsset = /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(incoming.pathname);
  responseHeaders.set('Cache-Control', source.ok && hashedAsset
    ? 'public, max-age=31536000, immutable'
    : incoming.pathname.startsWith('/data/') || !source.ok ? 'no-store' : 'no-cache');
  return new Response(request.method === 'HEAD' ? null : source.body, {
    status: source.status, statusText: source.statusText, headers: responseHeaders,
  });
}

export default { fetch: request => proxy(request) };
