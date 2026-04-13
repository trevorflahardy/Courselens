"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DiffView } from "@/components/diff-view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  AppliedChange,
  AppliedChangeAction,
  ChangelogStats,
  CourseNodeSummary,
} from "@/lib/types";
import { Download, RefreshCw, Scroll } from "lucide-react";

const ACTION_LABEL: Record<AppliedChangeAction, string> = {
  applied: "Applied",
  denied: "Denied",
  ignored: "Ignored",
  done_manually: "Done Manually",
};

const ACTION_BADGE: Record<AppliedChangeAction, string> = {
  applied: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  denied: "bg-red-500/15 text-red-300 border-red-500/30",
  ignored: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  done_manually: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

type ActionFilter = AppliedChangeAction | "all";

export default function ChangelogPage() {
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [stats, setStats] = useState<ChangelogStats | null>(null);
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [filterAction, setFilterAction] = useState<ActionFilter>("all");
  const [filterNode, setFilterNode] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [changesData, statsData, nodesData] = await Promise.all([
        api.listChangelog({
          action: filterAction === "all" ? undefined : filterAction,
          node_id: filterNode === "all" ? undefined : filterNode,
        }),
        api.getChangelogStats(),
        api.listNodes(),
      ]);
      setChanges(changesData);
      setStats(statsData);
      setNodes(nodesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load changelog");
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterNode]);

  useEffect(() => {
    void load();
  }, [load]);

  const nodeTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.title);
    return map;
  }, [nodes]);

  const grouped = useMemo(() => {
    const map = new Map<string, AppliedChange[]>();
    for (const c of changes) {
      if (!map.has(c.node_id)) map.set(c.node_id, []);
      map.get(c.node_id)!.push(c);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const titleA = nodeTitle.get(a[0]) ?? a[0];
      const titleB = nodeTitle.get(b[0]) ?? b[0];
      return titleA.localeCompare(titleB);
    });
    return entries;
  }, [changes, nodeTitle]);

  const downloadMarkdown = async () => {
    setDownloading(true);
    try {
      const blob = await api.downloadChangelogMarkdown();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "course-audit-changelog.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Scroll className="size-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Course Audit Changelog</h1>
          </div>
          <p className="text-[13px] text-muted-foreground/70 mt-1">
            Every applied, denied, ignored, or hand-fixed audit action — with diffs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={downloadMarkdown} disabled={downloading} className="gap-1.5">
            <Download className="size-3.5" />
            {downloading ? "Preparing…" : "Export as Markdown"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total changes" value={stats.total} />
          <StatCard label="Applied" value={stats.applied} tone="emerald" />
          <StatCard label="Denied" value={stats.denied} tone="red" />
          <StatCard label="Ignored" value={stats.ignored} tone="zinc" />
          <StatCard label="Done Manually" value={stats.done_manually} tone="sky" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-muted-foreground/70">Action</label>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value as ActionFilter)}
          className="rounded-lg border border-border bg-card/60 px-2.5 py-1 text-[12px]"
        >
          <option value="all">All</option>
          <option value="applied">Applied</option>
          <option value="denied">Denied</option>
          <option value="ignored">Ignored</option>
          <option value="done_manually">Done Manually</option>
        </select>
        <label className="text-[11px] text-muted-foreground/70 ml-3">Assignment</label>
        <select
          value={filterNode}
          onChange={(e) => setFilterNode(e.target.value)}
          className="rounded-lg border border-border bg-card/60 px-2.5 py-1 text-[12px] max-w-[320px]"
        >
          <option value="all">All assignments</option>
          {nodes
            .filter((n) => n.type === "assignment" || n.type === "page")
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
        </select>
      </div>

      {/* Content */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground/50 text-[13px]">
          Loading changelog…
        </div>
      ) : changes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/40 p-10 text-center text-[13px] text-muted-foreground/60">
          No changes have been recorded yet. Review findings on an assignment to start logging changes.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([nodeId, list]) => (
            <section key={nodeId} className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground/90">
                  {nodeTitle.get(nodeId) ?? nodeId}
                </h2>
                <span className="text-[11px] text-muted-foreground/60">
                  {list.length} change{list.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-4">
                {list
                  .slice()
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((change, idx) => (
                    <ChangeCard key={change.id} change={change} index={idx + 1} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "emerald" | "red" | "zinc" | "sky";
}) {
  const toneMap: Record<string, string> = {
    default: "text-foreground/90",
    emerald: "text-emerald-300",
    red: "text-red-300",
    zinc: "text-zinc-300",
    sky: "text-sky-300",
  };
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}

function ChangeCard({ change, index }: { change: AppliedChange; index: number }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground/50 font-mono">#{index}</span>
        <Badge variant="outline" className={`text-[10px] ${ACTION_BADGE[change.action]}`}>
          {ACTION_LABEL[change.action]}
        </Badge>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {change.finding_severity}
        </span>
        {change.finding_pass && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Pass {change.finding_pass}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/50 ml-auto">
          {new Date(change.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground/90">{change.finding_title}</p>
      {change.evidence_quote && (
        <p className="text-[12px] italic text-muted-foreground/70 border-l-2 border-primary/40 pl-3">
          {change.evidence_quote}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground/60">
        Target: <span className="font-mono">{change.target_type}</span>
        {" · "}
        field: <span className="font-mono">{change.field}</span>
        {" · by "}
        {change.handled_by}
      </p>
      {change.reason_or_note && (
        <p className="text-[12px] text-foreground/80">
          <span className="font-semibold">
            {change.action === "denied"
              ? "Reason for denial"
              : change.action === "ignored"
                ? "Reason to ignore"
                : "Note"}
            :
          </span>{" "}
          {change.reason_or_note}
        </p>
      )}
      <DiffView patch={change.diff_patch} />
    </div>
  );
}
