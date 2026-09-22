/**
 * A trimmed APIs.guru list (same shape as `list.json`) whose origin and mirror
 * URLs point at fixture hosts on the local test server. `origin(host)` gives
 * `http://<host>:<port>`.
 */
export function apisGuruList(origin: (host: string) => string) {
  const entry = (
    key: string,
    title: string,
    originUrls: string[],
    description?: string,
  ) => ({
    [key]: {
      added: "2020-01-01T00:00:00.000Z",
      preferred: "1.0.0",
      versions: {
        "1.0.0": {
          added: "2020-01-01T00:00:00.000Z",
          info: {
            title,
            version: "1.0.0",
            ...(description ? { description } : {}),
            "x-origin": originUrls.map((url) => ({
              format: "openapi",
              url,
              version: "3.0",
            })),
            "x-providerName": key.split(":")[0],
          },
          swaggerUrl: `${origin("apis-guru.test")}/${key}/openapi.json`,
          updated: "2024-01-01T00:00:00.000Z",
        },
      },
    },
  });

  return {
    ...entry("payco.test", "PayCo API", [
      `${origin("developer.payco.test")}/openapi.json`,
    ]),
    ...entry("docsy.test", "Docsy API", [
      `${origin("developer.docsy.test")}/openapi.yaml`,
    ]),
    ...entry("copyco.test", "CopyCo API", [
      `${origin("developer.copyco.test")}/gone.json`,
    ]),
    ...entry("nospec.test", "NoSpec API", [
      `${origin("developer.nospec.test")}/gone.json`,
    ]),
    ...entry("ghco.test", "GhCo API", [
      `${origin("raw.githubusercontent.com")}/ghco/openapi/master/openapi.json`,
    ]),
    ...entry("google.com:drive", "Drive API", [], "Manages files in Drive."),
    ...entry("google.com:gmail", "Gmail API", [], "Reads and sends mail."),
    ...entry("chatly.test", "Chatly Messaging", []),
    ...entry("talkr.test", "Talkr Messaging", []),
  };
}
