"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LedgerSession } from "@mink/types/token-ledger";
import { formatNum } from "@/lib/format";

interface Props {
  sessions: LedgerSession[];
}

export function CumulativeLineChart({ sessions }: Props) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cumulative Usage & Savings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No sessions recorded yet</p>
        </CardContent>
      </Card>
    );
  }

  let cumTokens = 0;
  let cumSavings = 0;
  const data = sessions.map((s, i) => {
    cumTokens += s.totals?.estimatedTokens ?? 0;
    cumSavings += s.estimatedSavings ?? 0;
    return {
      name: `S${i + 1}`,
      tokens: cumTokens,
      savings: cumSavings,
    };
  });

  if (sessions.length === 1) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cumulative Usage & Savings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center gap-8 py-6">
            <div className="text-center">
              <div className="text-2xl font-bold" style={{ color: "hsl(var(--chart-1))" }}>
                {formatNum(data[0].tokens)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Cumulative Tokens</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold" style={{ color: "hsl(var(--chart-2))" }}>
                {formatNum(data[0].savings)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Cumulative Savings</div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Trend chart appears after 2+ sessions
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Cumulative Usage & Savings</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              interval={data.length > 15 ? Math.ceil(data.length / 15) : 0}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              tickFormatter={formatNum}
            />
            <Tooltip
              formatter={(value, name) => [
                formatNum(Number(value)),
                name === "tokens" ? "Cumulative Tokens" : "Cumulative Savings",
              ]}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend
              formatter={(value: string) => (
                <span className="text-xs text-foreground">
                  {value === "tokens" ? "Cumulative Tokens" : "Cumulative Savings"}
                </span>
              )}
            />
            <Area
              type="monotone"
              dataKey="tokens"
              fill="hsl(var(--chart-1))"
              fillOpacity={0.1}
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="savings"
              fill="hsl(var(--chart-2))"
              fillOpacity={0.1}
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
