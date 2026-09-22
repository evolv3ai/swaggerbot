import type { LookupAddress } from "node:dns";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export type FixtureRequest = { host: string; path: string; at: number };

/**
 * A local HTTP server on port 0 that answers for any number of fixture hosts,
 * routed by the Host header. Pair it with `fixtureLookup` so the fetcher
 * resolves every host name to 127.0.0.1.
 */
export async function startFixtureServer() {
  const routes = new Map<string, Handler>();
  const requests: FixtureRequest[] = [];

  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const path = req.url ?? "/";
    requests.push({ host, path, at: Date.now() });
    const handler = routes.get(`${host}${path}`);
    if (handler) return handler(req, res);
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    requests,
    /** `http://<host>:<port>` */
    origin: (host: string) => `http://${host}:${port}`,
    route(host: string, path: string, handler: Handler) {
      routes.set(`${host}${path}`, handler);
    },
    send(host: string, path: string, body: string, contentType: string) {
      routes.set(`${host}${path}`, (_req, res) => {
        res.writeHead(200, { "content-type": contentType }).end(body);
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type FixtureServer = Awaited<ReturnType<typeof startFixtureServer>>;

/** Resolves every name to 127.0.0.1. */
export const fixtureLookup = ((
  _hostname: string,
  options: { all?: boolean },
  callback: (...args: unknown[]) => void,
) => {
  const address: LookupAddress = { address: "127.0.0.1", family: 4 };
  if (options.all) callback(null, [address]);
  else callback(null, address.address, address.family);
}) as unknown as LookupFunction;
