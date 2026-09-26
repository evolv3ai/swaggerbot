import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";

/**
 * "Copy URL": copies `url` (a Spec's absolute download URL). A button, so
 * the keyboard reaches it; a polite live region says when it has copied,
 * or that it couldn't.
 */
export function CopyUrl({ url, what }: { url: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <Button variant="secondary" onClick={copy}>
        {state === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Link2 aria-hidden="true" />
        )}
        {state === "copied" ? "Copied" : "Copy URL"}
        <span className="sr-only"> of {what}</span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied"
          ? `The URL of ${what} is on the clipboard`
          : state === "failed"
            ? "The URL couldn't be copied"
            : ""}
      </span>
    </>
  );
}
