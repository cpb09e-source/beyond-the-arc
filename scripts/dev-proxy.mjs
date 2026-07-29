/**
 * dev-proxy.mjs — the front door for local dev, replacing `netlify dev`'s.
 *
 * WHY THIS EXISTS. The Netlify CLI's dev proxy leaks. Measured on this project:
 * 131 MB to 4,988 MB in 126 seconds across twenty requests, monotonically,
 * while `next dev` held flat. It climbs until V8 aborts through __fastfail and
 * Windows reports exit 3221226505 with no message. Upgrading the CLI from 26 to
 * 27 made it worse, not better (16.3 -> 28.5 MB per request).
 *
 * Worse than the crash, and the thing that actually cost an afternoon: at high
 * heap the CLI proxy SILENTLY DROPS CLIENT NAVIGATIONS. On /?… the teams
 * explorer could not write its own URL at all — not the chips, not the "Show"
 * select, not column sorting. No error, no failed request, no navigation, and
 * the same interaction completing in 800ms in production. That failure mode is
 * indistinguishable from a bug in your own code, which is the expensive part.
 *
 * WHAT THIS DOES INSTEAD. Almost nothing on this port needs Netlify. Three
 * functions exist — parse-query, scoreboard, game — and Netlify's own
 * `functions:serve` honours their `config.path`, so they answer on /api/* with
 * the real runtime and the real env injection. Everything else is Next talking
 * to itself: thousands of HMR, RSC and static requests an hour that the CLI
 * proxy was buffering for no reason at all.
 *
 *     /api/*   ->  127.0.0.1:9999   (netlify functions:serve)
 *     *        ->  127.0.0.1:3000   (next dev)
 *
 * The whole fix is that this one STREAMS. `req.pipe(upstream)` and
 * `upstream.pipe(res)` never hold a body in memory, so there is nothing to
 * leak; the process sits flat for as long as you leave it running. It is also
 * why this file is short enough to audit in a sitting.
 *
 * Not a general-purpose proxy, and shouldn't grow into one. It exists so that
 * localhost:8899 is one origin serving both the app and its functions, which is
 * what lets the app fetch "/api/parse-query" with no dev-only base URL and no
 * CORS. Netlify still owns production routing; this only imitates the two rules
 * that matter locally.
 */
import http from "node:http";
import net from "node:net";
import process from "node:process";

const PORT = Number(process.env.BTA_DEV_PORT ?? 8899);
const NEXT_PORT = Number(process.env.BTA_NEXT_PORT ?? 3000);
const FN_PORT = Number(process.env.BTA_FN_PORT ?? 9999);

/** Functions own /api/*; Next owns everything else. */
const upstreamPort = (url) => (url.startsWith("/api/") ? FN_PORT : NEXT_PORT);

const server = http.createServer((req, res) => {
  const port = upstreamPort(req.url ?? "/");
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      // Forwarded verbatim. Rewriting Host breaks Next's RSC routing, which
      // checks the origin it was asked for against the one it rendered.
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    // Next restarting, or functions:serve not up yet. Say which, because a bare
    // ECONNREFUSED here reads as "the site is broken".
    const who = port === FN_PORT ? `functions:serve (:${FN_PORT})` : `next dev (:${NEXT_PORT})`;
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`dev-proxy: ${who} is not answering — ${err.code ?? err.message}\n`);
  });

  req.pipe(upstream);
});

/**
 * HMR is a WebSocket. Without this the page loads and then never live-reloads,
 * which looks like Fast Refresh being broken rather than the proxy dropping an
 * upgrade. Both directions are piped raw — no framing, no buffering.
 */
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(upstreamPort(req.url ?? "/"), "127.0.0.1", () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`)
          .join("") +
        "\r\n",
    );
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  // A dropped upgrade must not take the proxy with it — the client will retry.
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, () => {
  console.log(`· dev-proxy on http://localhost:${PORT}  ->  /api/* :${FN_PORT}, everything else :${NEXT_PORT}`);
});
