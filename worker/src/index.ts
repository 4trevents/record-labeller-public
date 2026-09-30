/**
 * Read-only proxy in front of the Discogs API, used only because browsers
 * refuse to let JS set a custom User-Agent header on fetch() — Discogs asks
 * for a descriptive one, so this Worker adds it server-side. It does NOT
 * hold your Discogs token: the app still sends its own `Authorization`
 * header (from Settings, in localStorage), and this Worker just relays it
 * upstream unchanged plus attaches a proper User-Agent.
 *
 * The app calls this Worker's URL instead of api.discogs.com directly,
 * with the same path/query, e.g. GET /releases/1234567.
 */

export interface Env {
  // Comma-separated list of allowed origins, or "*" for any (fine for a
  // personal single-user proxy, but restrict this once you know your app's
  // real origin — an open "*" proxy will forward anyone's Discogs token).
  ALLOWED_ORIGINS: string;
}

const USER_AGENT = "RecordLabeller/0.1 (+https://github.com/)";

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin ?? "") ? origin! : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (!cors["Access-Control-Allow-Origin"]) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response("Only GET is proxied", { status: 405, headers: cors });
    }

    const url = new URL(request.url);
    const upstreamUrl = `https://api.discogs.com${url.pathname}${url.search}`;

    const upstreamHeaders = new Headers({ "User-Agent": USER_AGENT, Accept: "application/json" });
    const auth = request.headers.get("Authorization");
    if (auth) upstreamHeaders.set("Authorization", auth);

    const upstreamResponse = await fetch(upstreamUrl, { headers: upstreamHeaders });

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, value] of Object.entries(cors)) responseHeaders.set(key, value);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
