"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { formatCompact, formatDateTime, formatNumber } from "@/lib/format";

// Validated categorical slots (light / dark steps of the same hue), plus recessive chrome.
const PALETTE = {
  light: { series: ["#2a78d6", "#eb6834"], grid: "#e4e4e7", axis: "#71717a" },
  dark: { series: ["#3987e5", "#d95926"], grid: "#27272a", axis: "#a1a1aa" },
} as const;

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

export interface ChartPoint {
  t: number;
  value: number | null;
}

function ChartTooltip({ active, payload, label, metric }: TooltipProps<number, string> & { metric: string }) {
  const value = payload?.[0]?.value;
  if (!active || typeof label !== "number") return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-zinc-500 dark:text-zinc-400">{formatDateTime(new Date(label).toISOString())}</p>
      <p className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
        {typeof value === "number" ? `${formatNumber(value)} ${metric}` : "Not available"}
      </p>
    </div>
  );
}

/** Single-series line chart over time. One metric per chart — never a second y-axis. */
export function MetricChart({ title, metric, data, slot }: { title: string; metric: string; data: ChartPoint[]; slot: 0 | 1 }) {
  const dark = usePrefersDark();
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const color = colors.series[slot];
  const known = data.filter((d) => d.value !== null);
  const sameDay =
    known.length > 0 && new Date(known[0]!.t).toDateString() === new Date(known[known.length - 1]!.t).toDateString();

  return (
    <figure className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {known.length < 2 ? (
        <p className="flex h-48 items-center justify-center text-center text-sm text-zinc-500 dark:text-zinc-400">
          {known.length === 0
            ? `No ${metric} data for this post.`
            : "Fetch this post again later to see a trend — the chart needs at least two snapshots."}
        </p>
      ) : (
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) =>
                  new Date(t).toLocaleString("en-US", sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })
                }
                tick={{ fill: colors.axis, fontSize: 11 }}
                stroke={colors.grid}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fill: colors.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={<ChartTooltip metric={metric} />}
                cursor={{ stroke: colors.axis, strokeDasharray: "3 3" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                dot={{ r: 4, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: color, strokeWidth: 2, stroke: dark ? "#09090b" : "#ffffff" }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
