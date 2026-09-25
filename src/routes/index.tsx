import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { CertaintyStrip } from "~/components/darkroom/certainty-strip";
import { CodeLine } from "~/components/darkroom/code-line";
import { Print } from "~/components/darkroom/print";
import { dayOf } from "~/components/darkroom/stamp";
import { type ChainState, Stations } from "~/components/darkroom/stations";
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

/** How long a replayed answer sits at the Index station before it's answered. */
const CHECKING_MS = 900;

function Search() {
  const facts = useLoaderData({ from: "__root__" });
  const [typing, setTyping] = useState(false);
  // The print on show was answered by the Index, so the chain starts there.
  const [chain, setChain] = useState<ChainState>(
    facts?.recent.length ? "answered" : "idle",
  );
  return (
    <div className="grid gap-10 px-4 pt-8 sm:px-8 lg:gap-14 lg:pt-12">
      <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section aria-labelledby="headline" className="grid gap-6">
          <h1
            id="headline"
            className="font-pencil text-[clamp(3.25rem,8.5vw,6rem)] uppercase leading-[0.95]"
          >
            No fake Specs.
          </h1>
          <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-xl">
            Name an API. SwaggerBot hands you its OpenAPI Spec, where it came
            from and how sure it is, or tells you straight why there isn't one.
          </p>
          <SearchForm
            onType={() => setTyping(true)}
            onSubmit={() => setChain("checking")}
          />
        </section>
        {facts && facts.recent.length > 0 ? (
          <Replay recent={facts.recent} stopped={typing} onChain={setChain} />
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
        <Stations state={chain} />
      </section>

      <StatusBar facts={facts} />
    </div>
  );
}

function SearchForm({
  onType,
  onSubmit,
}: {
  onType: () => void;
  onSubmit: () => void;
}) {
  const id = useId();
  return (
    <search className="grid max-w-[40rem] gap-5">
      <form
        action="/lookup"
        method="get"
        className="grid gap-3"
        onInput={onType}
        onSubmit={onSubmit}
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
            className="min-h-12 rounded-none border-2 border-b-[5px] border-[#0e0e0e] bg-lamp dark:border-[#9a6400] px-7 font-caps text-lg font-bold uppercase tracking-[0.14em] text-[#0e0e0e] transition-[border-width,transform] duration-100 hover:brightness-105 active:translate-y-[3px] active:border-b-2"
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
      <CertaintyStrip />
    </search>
  );
}

/**
 * Attract mode: a replay of the Index's real answers for the APIs it verified
 * most recently (the newest is in the rail), read when the page was served.
 * Each print comes up in turn while the chain above lights its Index
 * station. Stops for good once the visitor types, pauses on hover and focus,
 * has its own pause control, and stays still under reduced motion.
 */
function Replay({
  recent,
  stopped,
  onChain,
}: {
  recent: IndexStats["recent"];
  stopped: boolean;
  onChain: (state: ChainState) => void;
}) {
  // The newest print is in the rail; the replay runs through the rest.
  const offset = recent.length > 1 ? 1 : 0;
  const prints = recent.slice(offset);
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

  const running = !stopped && !paused && !held && !still && prints.length > 1;
  useEffect(() => {
    if (!running) return;
    let answered: number | undefined;
    const timer = window.setInterval(() => {
      setChanged(true);
      setIndex((i) => (i + 1) % prints.length);
      onChain("checking");
      answered = window.setTimeout(() => onChain("answered"), CHECKING_MS);
    }, 6000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(answered);
      onChain("answered");
    };
  }, [running, prints.length, onChain]);

  const print = prints[index] ?? prints[0];
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
      <div className="flex items-center justify-between gap-4">
        <h2
          id="replay"
          className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2"
        >
          Replay: real answers from the Index
        </h2>
        {prints.length > 1 && !still && !stopped ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="rounded-[3px] border border-ink bg-[#0e0e0e] px-3 py-1 font-caps text-xs font-semibold uppercase tracking-[0.12em] text-lamp hover:brightness-125"
          >
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
      <Print
        print={print}
        rank={index + offset}
        developing={changed && !still}
      />
      <p className="text-sm text-ink-2">
        {index + offset + 1} of the {recent.length} APIs the Index verified most
        recently, as a default Lookup answers them.
      </p>
    </section>
  );
}

function StatusBar({ facts }: { facts: IndexStats | null }) {
  return (
    <section
      aria-label="The Index, the Benchmark and Claude Code"
      className="-mx-4 grid gap-6 border-t border-rule bg-bay-deep px-4 py-6 sm:-mx-8 sm:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:items-center xl:gap-12"
    >
      {facts ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-3 lg:hidden">
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
        <CodeLine code={MCP_ADD} />
      </div>
    </section>
  );
}
