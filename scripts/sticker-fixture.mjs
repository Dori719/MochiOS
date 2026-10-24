/** Minimal fake host router shared by offline disk tests and the isolated UI fixture. */
export function createStickerFixture(plugin, { serverRoot, user, csrfToken = 'offline-preview' }) {
  const routes = new Map();
  plugin.registerStickerRoutes({
    get(route, handle) { routes.set(`GET ${route}`, handle); },
    post(route, handle) { routes.set(`POST ${route}`, handle); },
  }, { serverRoot });
  const requests = [];
  const fetch = async (input, options = {}, identity = user) => {
    const url = new URL(input, 'http://localhost');
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    if (method !== 'GET' && headers.get('X-CSRF-Token') !== csrfToken) return Response.json({ error: 'Invalid preview CSRF token.' }, { status: 403 });
    const route = url.pathname.replace(`/api/plugins/${plugin.info.id}`, '');
    const image = /^\/images\/([^/]+)$/.exec(route);
    const handle = routes.get(`${method} ${image ? '/images/:fileName' : route}`);
    if (!handle) return new Response(null, { status: 404 });
    let status = 200;
    let body = null;
    const responseHeaders = new Headers();
    const response = {
      set(name, value) {
        if (typeof name === 'string') responseHeaders.set(name, value);
        else Object.entries(name).forEach(([key, value]) => responseHeaders.set(key, value));
        return this;
      },
      status(value) { status = value; return this; },
      json(value) { responseHeaders.set('Content-Type', 'application/json'); body = JSON.stringify(value); return this; },
      send(value) { body = value; return this; },
    };
    const request = {
      method, query: Object.fromEntries(url.searchParams),
      params: image ? { fileName: decodeURIComponent(image[1]) } : {},
      body: options.body ? JSON.parse(options.body) : undefined,
      user: identity,
    };
    await handle(request, response);
    requests.push({ method, route, status, headers, body: request.body });
    return new Response(body, { status, headers: responseHeaders });
  };
  return { fetch, requests };
}
