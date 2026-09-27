import {
  type ErrorComponentProps,
  Link,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { SearchForm } from "~/components/search/search-form";
import { Button, buttonClass } from "~/components/ui/button";
import { Path } from "~/components/ui/path";
import { LEAD, PAGE, PageTitle } from "./page";

/** A page that stands in for one that isn't there, in the docs column. */
function FallbackPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={PAGE}>
      <PageTitle>{title}</PageTitle>
      <p className={LEAD}>{lead}</p>
      {children}
    </div>
  );
}

/** The 404 page's heading; the root's `head` puts it in the tab too. */
export const NOT_FOUND_TITLE = "No page here";

/**
 * Any address the site doesn't have (served as a 404): what was asked for,
 * the Lookup box, and the ways into the Index and the docs.
 */
export function NotFoundPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <FallbackPage
      title={NOT_FOUND_TITLE}
      lead="SwaggerBot has no page at this address. To find an API's Spec, look it up by name."
    >
      <p className="mt-2 font-mono text-[13px] text-sb-text-muted [overflow-wrap:anywhere]">
        <Path path={pathname} />
      </p>
      <SearchForm className="mt-[26px]" />
      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link
          to="/vendors"
          search={{ query: undefined, cursor: undefined }}
          className="text-sb-accent-text"
        >
          Browse the Vendors
        </Link>
        <Link to="/docs" className="text-sb-accent-text">
          Read the docs
        </Link>
      </p>
    </FallbackPage>
  );
}

/**
 * A page that failed to build (a loader or render threw). The error itself
 * isn't shown: it can carry the server's internals. Try again reloads the
 * route's data; the way back to Search always works.
 */
export function ErrorPage({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <FallbackPage
      title="This page didn't load"
      lead="Something went wrong on our side while building it. Try again, or come back in a minute."
    >
      <p className="mt-[26px] flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Link to="/" className={buttonClass({ variant: "secondary" })}>
          Go to Search
        </Link>
      </p>
    </FallbackPage>
  );
}
