import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

/**
 * The service's state from `/api/health`: a round status dot and a word.
 * It isn't a live region: the check runs on every page load, and
 * "Checking" then "Operational" each time would be noise. Only a service
 * that isn't answering is announced, once.
 */
export function HealthStatus({ className }: { className?: string }) {
  const [ok, setOk] = useState<boolean>();
  useEffect(() => {
    let live = true;
    fetch("/api/health")
      .then((r) => r.ok)
      .catch(() => false)
      .then((up) => live && setOk(up));
    return () => {
      live = false;
    };
  }, []);
  const label =
    ok === undefined ? "Checking" : ok ? "Operational" : "Not answering";
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-sb-text-muted",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          ok === undefined && "border border-sb-border-strong",
          ok === true && "bg-sb-success",
          ok === false && "bg-sb-danger",
        )}
      />
      <span className="sr-only">Service status: </span>
      {/* When down, the live region below says it, once. */}
      <span aria-hidden={ok === false || undefined}>{label}</span>
      <span aria-live="polite" className="sr-only">
        {ok === false ? "The service isn't answering" : ""}
      </span>
    </p>
  );
}
