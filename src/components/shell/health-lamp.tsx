import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

/**
 * The service's state from `/api/health`, as a lamp on the bench. The lamp
 * itself isn't a live region: the check runs on every page load, and
 * "Checking" then "up" each time would be noise. Only a service that isn't
 * answering is announced.
 */
export function HealthLamp({ className }: { className?: string }) {
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
    ok === undefined
      ? "Checking the service"
      : ok
        ? "The service is up"
        : "The service isn't answering";
  return (
    <p className={cn("flex items-center gap-2 text-sm", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 rounded-full border border-rule",
          ok === true && "bg-lamp shadow-[0_0_8px_1px_var(--lamp)]",
          ok === false && "bg-destructive",
        )}
      />
      {/* When down, the live region below says it, once. */}
      <span aria-hidden={ok === false || undefined}>{label}</span>
      <span aria-live="polite" className="sr-only">
        {ok === false ? "The service isn't answering" : ""}
      </span>
    </p>
  );
}
