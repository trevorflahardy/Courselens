"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useAuditStore } from "@/lib/store";
import type { FindingSeverity } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/*  Severity badge                                                            */
/* -------------------------------------------------------------------------- */

function SeverityBadge({ severity }: { severity: FindingSeverity | string }) {
  return (
    <Badge variant="outline" className={`severity-${severity} border text-[11px] font-medium`}>
      {severity}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Skeleton helpers                                                          */
/* -------------------------------------------------------------------------- */

function StatSkeleton() {
  return (
    <div className="rounded-xl glass-card px-4 py-4 animate-pulse">
      <div className="h-3 w-16 rounded bg-white/[0.06] mb-3" />
      <div className="h-8 w-12 rounded bg-white/[0.08]" />
    </div>
  );
}

function FindingSkeleton() {
  return (
    <div className="rounded-lg glass-subtle px-4 py-3.5 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 flex-1">
          <div className="h-3.5 w-48 rounded bg-white/[0.06]" />
          <div className="h-3 w-72 rounded bg-white/[0.04]" />
        </div>
        <div className="h-5 w-12 rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat card config                                                          */
/* -------------------------------------------------------------------------- */

interface StatCard {
  label: string;
  value: number;
  color: string;
  accent: string;
}

function buildStatCards(stats: {
  total_nodes: number;
  gap_count: number;
  warn_count: number;
  ok_count: number;
  unaudited_count: number;
}): StatCard[] {
  return [
    {
      label: "Total Items",
      value: stats.total_nodes,
      color: "text-foreground",
      accent: "glass-card border-primary/20",
    },
    {
      label: "Gaps",
      value: stats.gap_count,
      color: "text-severity-gap",
      accent: "glass-card border-red-500/15",
    },
    {
      label: "Warnings",
      value: stats.warn_count,
      color: "text-severity-warn",
      accent: "glass-card border-amber-500/15",
    },
    {
      label: "Clean",
      value: stats.ok_count,
      color: "text-severity-ok",
      accent: "glass-card border-emerald-500/15",
    },
    {
      label: "Unaudited",
      value: stats.unaudited_count,
      color: "text-muted-foreground",
      accent: "glass-card",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Quick-action definitions                                                  */
/* -------------------------------------------------------------------------- */

const quickActions = [
  {
    label: "Ingest from Canvas",
    href: "/ingest",
    icon: "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5",
  },
  {
    label: "Run Full Audit",
    href: "/audit",
    icon: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z",
  },
  {
    label: "View Dependency Graph",
    href: "/graph",
    icon: "M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z",
  },
];

/* -------------------------------------------------------------------------- */
/*  Dashboard page                                                            */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { stats, findings, loading, fetchStats, fetchFindings } = useAuditStore();

  useEffect(() => {
    fetchStats();
    fetchFindings();
  }, [fetchStats, fetchFindings]);

  const statCards = stats ? buildStatCards(stats) : null;
  const recentFindings = findings.slice(0, 5);

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground/80 mt-1">
          Course audit status and quick actions.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-3">
        {loading.stats || !statCards
          ? Array.from({ length: 5 }).map((_, i) => <StatSkeleton key={i} />)
          : statCards.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-xl ${stat.accent} px-4 py-4 glow-border`}
              >
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  {stat.label}
                </p>
                <p className={`text-3xl font-bold tracking-tighter mt-1.5 ${stat.color}`}>
                  {stat.value}
                </p>
              </div>
            ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Quick actions */}
        <div className="glass-card rounded-xl glow-border">
          <div className="px-5 pt-5 pb-2">
            <h3 className="text-sm font-bold">Quick Actions</h3>
          </div>
          <div className="px-3 pb-3 space-y-0.5">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="w-full rounded-lg px-3 py-2.5 text-[13px] font-medium text-left text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all duration-200 flex items-center gap-3 group"
              >
                <svg
                  className="h-4 w-4 text-primary/70 group-hover:text-primary group-hover:drop-shadow-[0_0_6px_oklch(0.7_0.18_265_/_0.4)] transition-all"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                </svg>
                {action.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Recent findings */}
        <div className="col-span-2 glass-card rounded-xl glow-border">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-bold">Recent Findings</h3>
          </div>
          <div className="px-5 pb-5">
            <div className="space-y-2">
              {loading.findings ? (
                Array.from({ length: 3 }).map((_, i) => <FindingSkeleton key={i} />)
              ) : recentFindings.length === 0 ? (
                <div className="rounded-lg glass-subtle px-4 py-3.5 transition-all duration-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[13px] font-semibold">Awaiting first audit</p>
                      <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                        Ingest course data and run the AI audit to see findings here.
                      </p>
                    </div>
                    <SeverityBadge severity="info" />
                  </div>
                </div>
              ) : (
                recentFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg glass-subtle px-4 py-3.5 transition-all duration-200 hover:bg-white/[0.04]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate">{finding.title}</p>
                        <p className="text-[12px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                          {finding.body}
                        </p>
                        <p className="text-[11px] text-muted-foreground/50 font-mono">
                          {finding.assignment_id}
                        </p>
                      </div>
                      <SeverityBadge severity={finding.severity} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Course info */}
      <div className="glass-card rounded-xl glow-border">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-bold">Course Info</h3>
        </div>
        <div className="px-5 pb-5">
          <div className="grid grid-cols-4 gap-8">
            {[
              { label: "Course", value: "EGN 3000L — Foundations of Engineering Lab" },
              { label: "Term", value: "Spring 2026" },
              { label: "Modules", value: "21 modules, 107 items" },
              { label: "Canvas ID", value: "2018858", mono: true },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                  {item.label}
                </p>
                <p
                  className={`text-[13px] font-medium mt-1.5 ${
                    item.mono ? "font-mono text-primary/80" : ""
                  }`}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
