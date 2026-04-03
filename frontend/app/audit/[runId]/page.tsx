"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuditStream } from "@/hooks/useAuditStream";
import type { AuditRun, Finding } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  AlertCircleIcon,
  Loader2Icon,
  QuoteIcon,
  SquareIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Pass stepper
// ---------------------------------------------------------------------------

const PASS_LABELS = ["Clarity", "Dependencies", "Forward Impact"] as const;

type PassState = "pending" | "active" | "done";

function PassStepper({
  currentPass,
  isDone,
  findingsPerPass,
}: {
  currentPass: number;
  isDone: boolean;
  findingsPerPass: [number, number, number];
}) {
  function getState(pass: number): PassState {
    if (isDone) return "done";
    if (pass < currentPass) return "done";
    if (pass === currentPass) return "active";
    return "pending";
  }

  return (
    <div className="glass rounded-lg p-4">
      <div className="flex items-center justify-between">
        {PASS_LABELS.map((label, i) => {
          const passNum = i + 1;
          const state = getState(passNum);
          return (
            <div key={label} className="flex flex-1 items-center">
              {/* Step node */}
              <div className="flex flex-col items-center gap-1.5">
                <StepCircle state={state} />
                <span
                  className={`text-xs font-medium transition-colors duration-300 ${
                    state === "active"
                      ? "text-purple-400"
                      : state === "done"
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {state === "done" && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {findingsPerPass[i]} finding{findingsPerPass[i] !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {/* Connector line */}
              {i < PASS_LABELS.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 transition-colors duration-500 ${
                    getState(passNum + 1) !== "pending"
                      ? "bg-emerald-500/40"
                      : state === "active"
                        ? "bg-gradient-to-r from-purple-500/40 to-white/[0.06]"
                        : "bg-white/[0.06]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepCircle({ state }: { state: PassState }) {
  switch (state) {
    case "done":
      return (
        <div className="flex items-center justify-center">
          <CheckCircle2Icon className="size-6 text-emerald-400 transition-colors duration-300" />
        </div>
      );
    case "active":
      return (
        <div className="relative flex items-center justify-center">
          {/* Pulsing ring */}
          <span className="absolute inline-flex h-7 w-7 animate-ping rounded-full bg-purple-500/20" />
          <span className="absolute inline-flex h-6 w-6 rounded-full border-2 border-purple-500/40" />
          <CircleDotIcon className="relative size-6 text-purple-400" />
        </div>
      );
    case "pending":
      return (
        <div className="flex items-center justify-center">
          <CircleIcon className="size-6 text-muted-foreground/40 transition-colors duration-300" />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Finding card
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: Finding["severity"] }) {
  return (
    <Badge
      className={`border text-[11px] uppercase tracking-wider severity-${severity}`}
    >
      {severity}
    </Badge>
  );
}

function FindingCard({
  finding,
  index,
}: {
  finding: Finding;
  index: number;
}) {
  return (
    <div
      className="glass-card rounded-lg p-4 space-y-2 animate-in slide-in-from-right duration-300"
      style={{ animationDelay: `${Math.min(index * 50, 300)}ms`, animationFillMode: "both" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <SeverityBadge severity={finding.severity} />
          <Badge variant="outline" className="text-[11px]">
            {finding.finding_type.replace(/_/g, " ")}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
          Pass {finding.pass_number}
        </span>
      </div>

      <h3 className="text-sm font-medium leading-snug">{finding.title}</h3>

      <p className="text-[13px] text-muted-foreground leading-relaxed">
        {finding.body}
      </p>

      {finding.evidence && (
        <div className="flex gap-2 rounded-md bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <QuoteIcon className="size-3.5 text-purple-400/60 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            {finding.evidence}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status message helpers
// ---------------------------------------------------------------------------

function getStatusMessage(currentPass: number, status: string): string {
  if (status === "done") return "Audit complete";
  if (status === "error") return "Audit encountered an error";
  if (status === "connecting") return "Connecting to audit stream...";
  switch (currentPass) {
    case 1:
      return "Analyzing standalone clarity...";
    case 2:
      return "Checking backward dependencies...";
    case 3:
      return "Evaluating forward impact...";
    default:
      return "Preparing audit...";
  }
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AuditRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;

  const [run, setRun] = useState<AuditRun | null>(null);
  const [dbFindings, setDbFindings] = useState<Finding[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  const stream = useAuditStream();

  // Fetch the run record
  const fetchRun = useCallback(async () => {
    try {
      const data = await api.getAuditRun(runId);
      setRun(data);
      return data;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load run");
      return null;
    }
  }, [runId]);

  useEffect(() => {
    fetchRun().then((data) => {
      if (!data) return;

      if (data.status === "done" || data.status === "error") {
        // Already finished -- load findings from DB
        api
          .listFindings({ assignment_id: data.assignment_id })
          .then((findings) => {
            // Filter to only this run's findings
            setDbFindings(findings.filter((f) => f.audit_run_id === data.id));
          })
          .catch(() => {});
      } else {
        // Still running -- connect SSE
        stream.connect(runId);
      }
    });

    return () => {
      stream.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // When SSE finishes, re-fetch the run record for final stats
  useEffect(() => {
    if (stream.status === "done") {
      fetchRun();
    }
  }, [stream.status, fetchRun]);

  const handleCancelRun = useCallback(async () => {
    if (!run || run.status !== "running") return;
    setCanceling(true);
    try {
      await api.cancelAuditRun(run.id);
      stream.disconnect();
      await fetchRun();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setCanceling(false);
    }
  }, [run, stream, fetchRun]);

  // Determine which findings to show
  const isFinished = run?.status === "done" || run?.status === "error";
  const isLive = stream.status === "streaming" || stream.status === "connecting";
  const findings = isFinished && dbFindings.length > 0 ? dbFindings : stream.findings;

  // Group findings by pass
  const findingsByPass = useMemo(() => {
    const grouped: [Finding[], Finding[], Finding[]] = [[], [], []];
    for (const f of findings) {
      const idx = Math.min(Math.max(f.pass_number - 1, 0), 2);
      grouped[idx].push(f);
    }
    return grouped;
  }, [findings]);

  const findingsPerPass: [number, number, number] = [
    isFinished ? (run?.pass1_findings ?? findingsByPass[0].length) : findingsByPass[0].length,
    isFinished ? (run?.pass2_findings ?? findingsByPass[1].length) : findingsByPass[1].length,
    isFinished ? (run?.pass3_findings ?? findingsByPass[2].length) : findingsByPass[2].length,
  ];

  const totalFindings = isFinished
    ? (run?.total_findings ?? findings.length)
    : findings.length;

  const effectivePass = isFinished ? 3 : stream.currentPass;
  const effectiveStatus = isFinished ? "done" : stream.status;

  if (loadError) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Link
          href="/audit"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to Audit
        </Link>
        <div className="glass rounded-lg border border-red-500/25 px-4 py-6 text-center">
          <AlertCircleIcon className="mx-auto size-6 text-red-400 mb-2" />
          <p className="text-sm text-red-400">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/audit"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to Audit
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            Audit Run:{" "}
            <span className="font-mono text-purple-400">{runId}</span>
          </h1>
          {run && (
            <p className="text-[13px] text-muted-foreground">
              Assignment: {run.assignment_id}
            </p>
          )}
        </div>
        {run && (
          <div className="flex items-center gap-2">
            <RunStatusBadge status={run.status} />
            {run.status === "running" && (
              <Button
                size="sm"
                variant="destructive"
                disabled={canceling}
                onClick={() => {
                  void handleCancelRun();
                }}
              >
                {canceling ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <SquareIcon className="size-3.5" />
                )}
                <span className="ml-1">Stop Audit</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Pass progress stepper */}
      <PassStepper
        currentPass={effectivePass}
        isDone={effectiveStatus === "done"}
        findingsPerPass={findingsPerPass}
      />

      {/* Error from SSE */}
      {stream.error && (
        <div className="glass rounded-lg border border-red-500/25 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircleIcon className="size-4 shrink-0" />
          {stream.error}
        </div>
      )}

      {/* Run-level error */}
      {run?.error_message && (
        <div className="glass rounded-lg border border-red-500/25 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircleIcon className="size-4 shrink-0" />
          {run.error_message}
        </div>
      )}

      {/* Live findings feed */}
      <div className="space-y-3">
        {findings.length === 0 && isLive && (
          <div className="glass rounded-lg px-4 py-10 text-center">
            <Loader2Icon className="mx-auto size-5 animate-spin text-purple-400 mb-2" />
            <p className="text-[13px] text-muted-foreground">
              Waiting for findings...
            </p>
          </div>
        )}

        {findings.length === 0 && isFinished && (
          <div className="glass rounded-lg px-4 py-10 text-center">
            <CheckCircle2Icon className="mx-auto size-6 text-emerald-400 mb-2" />
            <p className="text-[13px] text-muted-foreground">
              No findings emitted for this run.
            </p>
          </div>
        )}

        {[1, 2, 3].map((passNum) => {
          const passFindings = findingsByPass[passNum - 1];
          if (passFindings.length === 0) return null;
          return (
            <div key={passNum} className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                Pass {passNum}: {PASS_LABELS[passNum - 1]}
                <span className="ml-2 text-foreground tabular-nums">
                  ({passFindings.length})
                </span>
              </h2>
              {passFindings.map((finding, i) => (
                <FindingCard key={finding.id} finding={finding} index={i} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Sticky status bar */}
      <div className="sticky bottom-0 z-20">
        <div className="glass-strong rounded-lg px-4 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            {effectiveStatus === "streaming" && (
              <Loader2Icon className="size-3.5 animate-spin text-purple-400" />
            )}
            {effectiveStatus === "done" && (
              <CheckCircle2Icon className="size-3.5 text-emerald-400" />
            )}
            {effectiveStatus === "error" && (
              <AlertCircleIcon className="size-3.5 text-red-400" />
            )}
            <span className="text-muted-foreground">
              {getStatusMessage(effectivePass, effectiveStatus)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {effectiveStatus === "done" ? (
              <span>{totalFindings} finding{totalFindings !== 1 ? "s" : ""} total</span>
            ) : (
              effectivePass > 0 && (
                <span>
                  Pass {effectivePass} of 3 &bull; {totalFindings} finding
                  {totalFindings !== 1 ? "s" : ""} so far
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: AuditRun["status"] }) {
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
          Complete
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
