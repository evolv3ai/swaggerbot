import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Print } from "~/components/darkroom/print";
import { dayOf } from "~/components/darkroom/stamp";
import { Stations } from "~/components/darkroom/stations";
import type { IndexStats } from "~/server/index-stats";

export const Route = createFileRoute("/")({
  component: Search,
});

/**
 * The latest Benchmark run, updated by hand after each run (PRODUCT.md:
 * every figure states its base and date). Source: the Slice 4 result.
 */
const BENCHMARK = {
  date: "2026-09-23",
  names: 40,
  resolved: 20,
  wrong: 0,
  runs: 2,
  href: "https://github.com/evolv3ai/swaggerbot/blob/main/docs/slices/slice-4-result.md",
};

const MCP_ADD =
  "claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp";

function Search() {
  const facts = useLoaderData({ from: "__root__" });
  const [typing, setTyping] = useState(false);
  return (
    <div className="grid gap-10 px-4 py-8 sm:px-8 lg:gap-14 lg:py-12">
      <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section aria-labelledby="headline" className="grid gap-6">
          <h1
            id="headline"
            className="font-pencil text-[clamp(3.5rem,9vw,6rem)] leading-[0.92]"
          >
            No fake Specs.
          </h1>
          <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-xl">
            Name an API. SwaggerBot hands you its OpenAPI Spec, where it came
            from and how sure it is, or tells you straight why there isn't one.
          </p>
          <SearchForm onType={() => setTyping(true)} />
        </section>
        {facts && facts.recent.length > 0 ? (
          <Replay recent={facts.recent} stopped={typing} />
        ) : null}
      </div>

      <section aria-labelledby="stations" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2
            id="stations"
            className="font-caps text-2xl font-semibold uppercase tracking-wide"
          >
            How a Spec is developed
          </h2>
          <p className="text-sm text-ink-2">
            From the Index, anyone. Past it, Discovery, with an API key.
          </p>
        </div>
        <Stations active={0} />
      </section>

      <StatusBar facts={facts} />
    </div>
  );
}

function SearchForm({ onType }: { onType: () => void }) {
  const id = useId();
  return (
    <search>
      <form
        action="/lookup"
        method="get"
        className="grid max-w-[40rem] gap-3"
        onInput={onType}
      >
        <label
          htmlFor={`${id}-name`}
          className="font-caps text-sm font-semibold uppercase tracking-[0.14em]"
        >
          The name of an API
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={`${id}-name`}
            name="name"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Stripe, Jira Cloud, Val Town…"
            className="min-h-12 flex-1 rounded-[3px] border-2 border-ink bg-print px-4 text-lg text-print-ink placeholder:text-print-ink-2"
          />
          <button
            type="submit"
            className="min-h-12 rounded-[3px] border-2 border-ink bg-lamp px-7 font-caps text-lg font-bold uppercase tracking-[0.14em] text-[#0e0e0e] shadow-[0_3px_0_0_var(--rule)] transition-[transform,box-shadow] hover:-translate-y-px active:translate-y-0.5 active:shadow-none"
          >
            Develop
          </button>
        </div>
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer font-caps font-semibold uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            Options
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <label
                htmlFor={`${id}-version`}
                className="font-caps font-semibold uppercase tracking-[0.12em]"
              >
                API Version{" "}
                <span className="normal-case text-ink-2">(optional)</span>
              </label>
              <input
                id={`${id}-version`}
                name="apiVersion"
                autoComplete="off"
                placeholder="v3, 2024-06-20…"
                className="min-h-10 rounded-[3px] border border-ink bg-print px-3 text-print-ink placeholder:text-print-ink-2"
              />
            </div>
            <label className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                name="allowCommunity"
                value="1"
                className="size-4 accent-[var(--ink)]"
              />
              Include Community Specs
            </label>
          </div>
        </details>
      </form>
    </search>
  );
}

/**
 * Attract mode: the APIs the Index verified most recently, each coming up as
 * a print in turn. Real answers from the Index, read when the page was
 * served. Stops for good once the visitor types, pauses on hover and focus,
 * has its own pause control, and stays still under reduced motion.
 */
function Replay({
  recent,
  stopped,
}: {
  recent: IndexStats["recent"];
  stopped: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [still, setStill] = useState(true);
  // The first print is shown developed; only a change of print develops.
  const [changed, setChanged] = useState(false);
  const region = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const running = !stopped && !paused && !held && !still && recent.length > 1;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setChanged(true);
      setIndex((i) => (i + 1) % recent.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [running, recent.length]);

  const print = recent[index] ?? recent[0];
  if (!print) return null;
  return (
    <section
      ref={region}
      aria-labelledby="replay"
      className="grid gap-3"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!region.current?.contains(e.relatedTarget as Node)) setHeld(false);
      }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="replay"
          className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2"
        >
          Recently verified, from the Index
        </h2>
        {recent.length > 1 && !still && !stopped ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="rounded-[3px] border border-rule px-2.5 py-1 font-caps text-xs font-semibold uppercase tracking-[0.12em] hover:border-ink"
          >
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
      <Print print={print} developing={changed && !still} />
      <p className="text-sm text-ink-2">
        Answered from the Index in{" "}
        <span className="font-mono">{print.ms.toFixed(1)} ms</span>, as{" "}
        {recent.length > 1
          ? `${index + 1} of the ${recent.length} most recently verified.`
          : "the most recently verified."}
      </p>
    </section>
  );
}

function StatusBar({ facts }: { facts: IndexStats | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_ADD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section
      aria-label="The Index and the Benchmark"
      className="grid gap-6 rounded-[3px] border border-rule bg-bay-deep p-5 sm:p-6 xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)] xl:items-center xl:gap-10"
    >
      {facts ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {(
            [
              ["Vendors", facts.vendors],
              ["APIs", facts.apis],
              ["Specs", facts.specs],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="grid gap-1">
              <dt className="font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">
                {label}
              </dt>
              <dd className="font-segment text-3xl leading-none">{n}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="text-sm leading-relaxed">
        <span className="font-caps font-semibold uppercase tracking-[0.12em]">
          Benchmark, {dayOf(`${BENCHMARK.date}T12:00:00Z`)}:
        </span>{" "}
        {BENCHMARK.wrong} wrong of {BENCHMARK.resolved} Resolved answers, on{" "}
        {BENCHMARK.runs} runs over the {BENCHMARK.names}-name set, after two
        label corrections.{" "}
        <a href={BENCHMARK.href} className="whitespace-nowrap">
          How it was measured
        </a>
      </p>
      <div className="grid gap-2">
        <p className="font-caps text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">
          Add it to Claude Code
        </p>
        <div className="flex min-w-0 items-stretch overflow-hidden rounded-[3px] border border-ink bg-strip-5">
          <code className="min-w-0 flex-1 px-3 py-2.5 font-mono text-sm leading-relaxed text-print [overflow-wrap:anywhere]">
            {MCP_ADD}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 border-l border-ink bg-lamp px-3 font-caps text-sm font-bold uppercase tracking-[0.12em] text-[#0e0e0e]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {copied ? "Copied to the clipboard" : ""}
        </p>
      </div>
    </section>
  );
}
