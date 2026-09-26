import {
  createRootRoute,
  HeadContent,
  Outlet,
  ScriptOnce,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Shell } from "~/components/shell/shell";
import { THEME_SCRIPT } from "~/components/shell/theme";
import { getShellFacts } from "~/server/shell-facts";
import appCss from "~/styles/app.css?url";
import fontsCss from "~/styles/fonts.css?url";

const TITLE = "SwaggerBot: the verified OpenAPI Spec for any API, by name";
const DESCRIPTION =
  "Send the name of an API and get back its OpenAPI or Swagger Spec, with where it came from and how sure we are, or an honest answer about why there isn't one.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      // One value: the router's head keeps one meta per name.
      { name: "theme-color", content: "#111827" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "SwaggerBot" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "https://swaggerbot.dev/" },
      { property: "og:image", content: "https://swaggerbot.dev/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon-32.png",
        type: "image/png",
        sizes: "32x32",
      },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      {
        rel: "preload",
        href: "/fonts/montserrat-latin-800-normal.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: fontsCss },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  loader: () => getShellFacts(),
  component: RootComponent,
});

function RootComponent() {
  const facts = Route.useLoaderData();
  const bare = useRouterState({
    select: (s) => s.location.pathname.startsWith("/embed/"),
  });
  return (
    <RootDocument>
      {bare ? (
        <Outlet />
      ) : (
        <Shell facts={facts}>
          <Outlet />
        </Shell>
      )}
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The theme attribute is set before hydration by THEME_SCRIPT.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before the styles, so the page paints in the visitor's theme. */}
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
