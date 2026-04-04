"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { AuditRun, AuditRuntimeState, CourseNodeSummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PlayIcon,
  LayersIcon,
  BarChart3Icon,
  SquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  AlertCircleIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(start: string, end: string | null): string {
  if (!end) return "--";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: AuditRun["status"] }) {
  switch (status) {
    case "running":
      return (
        <Badge className="gap-1.5 border border-blue-500/25 bg-blue-500/15 text-blue-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
          </span>
          Running
        </Badge>
      );
    case "done":
      return (
        <Badge className="border border-emerald-500/25 bg-emerald-500/15 text-emerald-400">
          Done
        </Badge>
      );
    case "error":
      return (
        <Badge className="border border-red-500/25 bg-red-500/15 text-red-400">
          Error
        </Badge>
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- State ---
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<string>("");
  const [auditState, setAuditState] = useState<AuditRuntimeState>({
    batch_active: false,
    running_count: 0,
    running_assignment_ids: [],
  });
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [allLoading, setAllLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // --- Data fetching ---
  const fetchData = useCallback(async () => {
    try {
      const [nodeData, runData, runtimeState] = await Promise.all([
        api.listNodes({ type: "assignment" }),
        api.listAuditRuns(),
        api.getAuditState(),
      ]);
      setNodes(nodeData);
      setRuns(runData);
      setAuditState(runtimeState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for updates when any run is active
  const hasRunning = auditState.running_count > 0 || runs.some((r) => r.status === "running");
  const selectedAssignmentRunning =
    selectedAssignment.length > 0 && auditState.running_assignment_ids.includes(selectedAssignment);

  useEffect(() => {
    if (!hasRunning && !auditState.batch_active) return;
    const interval = setInterval(() => {
      Promise.all([api.listAuditRuns(), api.getAuditState()])
        .then(([nextRuns, state]) => {
          setRuns(nextRuns);
          setAuditState(state);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [hasRunning, auditState.batch_active]);

  // --- Grouped assignments by week ---
  const groupedByWeek = useMemo(() => {
    const map = new Map<number | null, CourseNodeSummary[]>();
    for (const n of nodes) {
      const week = n.week ?? null;
      if (!map.has(week)) map.set(week, []);
      map.get(week)!.push(n);
    }
    // Sort weeks numerically
    return [...map.entries()].sort(
      ([a], [b]) => (a ?? 999) - (b ?? 999),
    );
  }, [nodes]);

  // --- Actions ---
  async function handleRunAudit() {
    if (!selectedAssignment) return;
    setAuditLoading(true);
    setError(null);
    try {
      const result = await api.startAudit(selectedAssignment);
      // Refresh runs list
      const updated = await api.listAuditRuns();
      setRuns(updated);
      // Navigate to the live view
      router.push(`/audit/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start audit");
    } finally {
      setAuditLoading(false);
    }
  }

  // Auto-trigger Audit All when navigated from dashboard with ?start=all
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (searchParams.get("start") === "all" && !loading && !allLoading) {
      autoStartedRef.current = true;
      // Clear the param from the URL without a navigation
      router.replace("/audit", { scroll: false });
      void handleAuditAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading]);

  async function handleAuditAll() {
    setAllLoading(true);
    setError(null);
    try {
      await api.startAuditAll();
      const updated = await api.listAuditRuns();
      setRuns(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start batch audit");
    } finally {
      setAllLoading(false);
    }
  }

  async function handleSummary() {
    setSummaryLoading(true);
    setError(null);
    try {
      const data = await api.getAuditSummary();
      setSummary(data);
      setSummaryOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleCancelRun(runId: string) {
    setCancelingRunId(runId);
    setError(null);
    try {
      await api.cancelAuditRun(runId);
      const updated = await api.listAuditRuns();
      setRuns(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel audit run");
    } finally {
      setCancelingRunId(null);
    }
  }

  // --- Render ---
  if (!mounted) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Audit Engine</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Run audits, view history, and stream live results.
            </p>
          </div>
        </div>
        <div className="glass rounded-lg p-4">
          <p className="text-[13px] text-muted-foreground">Loading audit workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit Engine</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Run audits, view history, and stream live results.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasRunning ? (
            <Badge className="gap-1.5 border border-blue-500/25 bg-blue-500/15 text-blue-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
              </span>
              Running
            </Badge>
          ) : (
            <Badge className="border border-emerald-500/25 bg-emerald-500/15 text-emerald-400">
              Idle
            </Badge>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="glass rounded-lg border border-red-500/25 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircleIcon className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Action bar */}
      <div className="glass rounded-lg p-4 flex flex-wrap items-center gap-3">
        <Select
          value={selectedAssignment}
          onValueChange={(v) => setSelectedAssignment(v ?? "")}
        >
          <SelectTrigger className="w-72 bg-white/[0.04] border-white/[0.08]">
            <SelectValue placeholder="Select assignment..." />
          </SelectTrigger>
          <SelectContent>
            {groupedByWeek.map(([week, weekNodes]) => (
              <SelectGroup key={week ?? "none"}>
                <SelectLabel>
                  {week !== null ? `Week ${week}` : "Unassigned"}
                </SelectLabel>
                {weekNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleRunAudit}
          disabled={!selectedAssignment || auditLoading || selectedAssignmentRunning || auditState.batch_active}
          className="gap-1.5"
        >
          {auditLoading || selectedAssignmentRunning || auditState.batch_active ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          {auditLoading
            ? "Starting..."
            : selectedAssignmentRunning
              ? "Audit Running"
              : auditState.batch_active
                ? "Locked: Batch Running"
                : "Run Audit"}
        </Button>

        <Button
          variant="secondary"
          onClick={handleAuditAll}
          disabled={allLoading || hasRunning || auditState.batch_active}
          className="gap-1.5"
        >
          {allLoading || hasRunning || auditState.batch_active ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <LayersIcon className="size-4" />
          )}
          {allLoading
            ? "Starting Batch..."
            : hasRunning || auditState.batch_active
              ? "Audit In Progress"
              : "Audit All"}
        </Button>

        <Button
          variant="outline"
          onClick={handleSummary}
          disabled={summaryLoading}
          className="gap-1.5"
        >
          {summaryLoading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <BarChart3Icon className="size-4" />
          )}
          Summary
        </Button>
      </div>

      {/* Summary panel (collapsible) */}
      {summary && (
        <div className="glass rounded-lg overflow-hidden">
          <button
            onClick={() => setSummaryOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-white/[0.04] transition-colors"
          >
            <span>Audit Summary</span>
            {summaryOpen ? (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            )}
          </button>
          {summaryOpen && (
            <div className="border-t border-white/[0.06] px-4 py-4">
              <SummaryPanel data={summary} />
            </div>
          )}
        </div>
      )}

      {/* Audit Runs History */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-medium text-foreground">Audit Runs</h2>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center">
            <Loader2Icon className="mx-auto size-5 animate-spin text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground mt-2">
              Loading audit history...
            </p>
          </div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">
              No audit runs yet. Select an assignment and run your first audit.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                <TableHead className="text-xs text-muted-foreground">Run ID</TableHead>
                <TableHead className="text-xs text-muted-foreground">Assignment</TableHead>
                <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs text-muted-foreground text-center">P1</TableHead>
                <TableHead className="text-xs text-muted-foreground text-center">P2</TableHead>
                <TableHead className="text-xs text-muted-foreground text-center">P3</TableHead>
                <TableHead className="text-xs text-muted-foreground text-center">Total</TableHead>
                <TableHead className="text-xs text-muted-foreground">Started</TableHead>
                <TableHead className="text-xs text-muted-foreground">Duration</TableHead>
                <TableHead className="text-xs text-muted-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const assignmentNode = nodes.find((n) => n.id === run.assignment_id);
                const isRunning = run.status === "running";
                const isCanceling = cancelingRunId === run.id;
                return (
                  <TableRow
                    key={run.id}
                    className="border-white/[0.06] cursor-pointer hover:bg-white/[0.04] transition-colors"
                    onClick={() => router.push(`/audit/${run.id}`)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {run.id}
                    </TableCell>
                    <TableCell className="text-[13px] max-w-48 truncate">
                      {assignmentNode?.title ?? run.assignment_id}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums">
                      {run.pass1_findings}
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums">
                      {run.pass2_findings}
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums">
                      {run.pass3_findings}
                    </TableCell>
                    <TableCell className="text-center text-xs tabular-nums font-medium">
                      {run.total_findings}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTime(run.started_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(run.started_at, run.finished_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isRunning && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isCanceling}
                          className="h-7 px-2.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCancelRun(run.id);
                          }}
                        >
                          {isCanceling ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <SquareIcon className="size-3.5" />
                          )}
                          <span className="ml-1">Stop</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary sub-component
// ---------------------------------------------------------------------------

function SummaryPanel({ data }: { data: Record<string, unknown> }) {
  // Try to extract common summary shapes from the backend
  const severity = data.severity_distribution as
    | Record<string, number>
    | undefined;
  const topNodes = data.top_problematic_nodes as
    | Array<{ id: string; title: string; finding_count: number }>
    | undefined;
  const typeBreakdown = data.finding_type_breakdown as
    | Record<string, number>
    | undefined;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Severity distribution */}
      {severity && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Severity Distribution
          </h3>
          <div className="space-y-1.5">
            {Object.entries(severity).map(([sev, count]) => (
              <div key={sev} className="flex items-center justify-between text-sm">
                <Badge
                  className={`border text-xs severity-${sev}`}
                >
                  {sev}
                </Badge>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top problematic nodes */}
      {topNodes && topNodes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Top Problematic Nodes
          </h3>
          <div className="space-y-1.5">
            {topNodes.slice(0, 5).map((node) => (
              <div key={node.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{node.title}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {node.finding_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finding type breakdown */}
      {typeBreakdown && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Finding Types
          </h3>
          <div className="space-y-1.5">
            {Object.entries(typeBreakdown).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate text-muted-foreground">{type.replace(/_/g, " ")}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: render raw JSON if no known shape */}
      {!severity && !topNodes && !typeBreakdown && (
        <div className="col-span-3">
          <pre className="text-xs text-muted-foreground bg-white/[0.03] rounded-md p-3 overflow-auto max-h-60">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
