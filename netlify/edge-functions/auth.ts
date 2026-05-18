// HTTP Basic Auth gate for the whole site. Reads SITE_USERNAME / SITE_PASSWORD
// from Netlify env vars. If either is unset, the gate is disabled (useful for
// local `netlify dev` without secrets). Static assets and the favicon are
// passed through so the unauthenticated browser prompt looks correct.
import type { Context } from "https://edge.netlify.com";

const REALM = "Beyond the Arc — preview";

// Constant-time string compare so a timing oracle can't leak the password.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req: Request, ctx: Context): Promise<Response | void> => {
  const expectedUser = Deno.env.get("SITE_USERNAME");
  const expectedPass = Deno.env.get("SITE_PASSWORD");
  if (!expectedUser || !expectedPass) return; // gate disabled

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (safeEqual(user, expectedUser) && safeEqual(pass, expectedPass)) {
          return; // authorized — let the request through
        }
      }
    } catch {
      // fall through to challenge
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const config = { path: "/*" };
