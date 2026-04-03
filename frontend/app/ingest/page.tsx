"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  RefreshCw,
  Network,
  Check,
  X,
  SkipForward,
  Loader2,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface UploadResult {
  nodes_extracted?: number;
  files_extracted?: number;
  status?: string;
  error?: string;
}

interface GraphResult {
  edges: number;
  orphans: number;
}

interface IngestLogEntry {
  id: string;
  timestamp: string;
  action: "extract" | "embed" | "graph" | "sync" | "upload";
  title: string;
  status: "ok" | "error" | "skip";
}

type SyncStage =
  | "idle"
  | "fetching_modules"
  | "extracting_assignments"
  | "processing_rubrics"
  | "building_graph"
  | "done"
  | "error";

const SYNC_STAGE_LABELS: Record<SyncStage, string> = {
  idle: "Ready to sync",
  fetching_modules: "Fetching modules...",
  extracting_assignments: "Extracting assignments...",
  processing_rubrics: "Processing rubrics...",
  building_graph: "Building graph...",
  done: "Sync complete",
  error: "Sync failed",
};

const SYNC_STAGE_ORDER: SyncStage[] = [
  "fetching_modules",
  "extracting_assignments",
  "processing_rubrics",
  "building_graph",
];

interface NodeTypeCounts {
  assignment: number;
  page: number;
  rubric: number;
  lecture: number;
  announcement: number;
  file: number;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string | undefined | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function logId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* -------------------------------------------------------------------------- */
/*  Glass card wrapper                                                        */
/* -------------------------------------------------------------------------- */

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page Component                                                            */
/* -------------------------------------------------------------------------- */

export default function IngestPage() {
  /* ---- shared state ---- */
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [log, setLog] = useState<IngestLogEntry[]>([]);
  const [nodeCounts, setNodeCounts] = useState<NodeTypeCounts>({
    assignment: 0,
    page: 0,
    rubric: 0,
    lecture: 0,
    announcement: 0,
    file: 0,
  });
  const [totalEdges, setTotalEdges] = useState(0);

  /* ---- ZIP upload state ---- */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  /* ---- Canvas sync state ---- */
  const [syncStage, setSyncStage] = useState<SyncStage>("idle");
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- Graph rebuild state ---- */
  const [rebuildingGraph, setRebuildingGraph] = useState(false);
  const [graphResult, setGraphResult] = useState<GraphResult | null>(null);

  /* ---- Clear dialog ---- */
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  /* ---- helpers ---- */
  const pushLog = useCallback(
    (action: IngestLogEntry["action"], title: string, status: IngestLogEntry["status"]) => {
      setLog((prev) => [
        {
          id: logId(),
          timestamp: new Date().toISOString(),
          action,
          title,
          status,
        },
        ...prev,
      ]);
    },
    [],
  );

  /* ---- initial fetch ---- */
  useEffect(() => {
    api.getIngestStatus().then((s) => {
      if (s.last_run) setLastRun(s.last_run);
    }).catch(() => {});

    api.listNodes().then((nodes) => {
      const counts: NodeTypeCounts = {
        assignment: 0,
        page: 0,
        rubric: 0,
        lecture: 0,
        announcement: 0,
        file: 0,
      };
      for (const n of nodes) {
        if (n.type in counts) counts[n.type as keyof NodeTypeCounts]++;
      }
      setNodeCounts(counts);
    }).catch(() => {});

    api.getGraph().then((g) => {
      setTotalEdges(g.edges.length);
    }).catch(() => {});
  }, []);

  /* ---- ZIP Upload handlers ---- */
  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setUploadResult(null);
    setUploadProgress(0);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file && (file.name.endsWith(".zip") || file.name.endsWith(".imscc"))) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(10);

    const progressInterval = setInterval(() => {
      setUploadProgress((p) => Math.min(p + 8, 90));
    }, 300);

    try {
      const result = (await api.uploadZip(selectedFile)) as UploadResult;
      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadResult(result);
      setLastRun(new Date().toISOString());
      pushLog("upload", selectedFile.name, result.error ? "error" : "ok");

      // Refresh node counts
      api.listNodes().then((nodes) => {
        const counts: NodeTypeCounts = {
          assignment: 0, page: 0, rubric: 0, lecture: 0, announcement: 0, file: 0,
        };
        for (const n of nodes) {
          if (n.type in counts) counts[n.type as keyof NodeTypeCounts]++;
        }
        setNodeCounts(counts);
      }).catch(() => {});
    } catch (err) {
      clearInterval(progressInterval);
      setUploadProgress(0);
      setUploadResult({ error: err instanceof Error ? err.message : "Upload failed" });
      pushLog("upload", selectedFile.name, "error");
    } finally {
      setUploading(false);
    }
  }, [selectedFile, pushLog]);

  /* ---- Canvas Sync handlers ---- */
  const startSync = useCallback(async () => {
    setSyncStage("fetching_modules");

    // Simulate multi-stage progress via polling
    let stageIdx = 0;
    syncPollRef.current = setInterval(() => {
      stageIdx++;
      if (stageIdx < SYNC_STAGE_ORDER.length) {
        setSyncStage(SYNC_STAGE_ORDER[stageIdx]);
      }
    }, 2500);

    try {
      const result = await api.startIngest();
      if (syncPollRef.current) clearInterval(syncPollRef.current);
      setSyncStage("done");
      setLastRun(new Date().toISOString());
      pushLog("sync", "Canvas live sync", result.status === "error" ? "error" : "ok");

      // Refresh counts
      api.listNodes().then((nodes) => {
        const counts: NodeTypeCounts = {
          assignment: 0, page: 0, rubric: 0, lecture: 0, announcement: 0, file: 0,
        };
        for (const n of nodes) {
          if (n.type in counts) counts[n.type as keyof NodeTypeCounts]++;
        }
        setNodeCounts(counts);
      }).catch(() => {});
    } catch {
      if (syncPollRef.current) clearInterval(syncPollRef.current);
      setSyncStage("error");
      pushLog("sync", "Canvas live sync", "error");
    }
  }, [pushLog]);

  useEffect(() => {
    return () => {
      if (syncPollRef.current) clearInterval(syncPollRef.current);
    };
  }, []);

  /* ---- Graph rebuild handler ---- */
  const handleRebuildGraph = useCallback(async () => {
    setRebuildingGraph(true);
    setGraphResult(null);
    try {
      const result = await api.rebuildGraph();
      setGraphResult(result);
      setTotalEdges(result.edges);
      pushLog("graph", "Rebuild dependency graph", "ok");
    } catch {
      pushLog("graph", "Rebuild dependency graph", "error");
    } finally {
      setRebuildingGraph(false);
    }
  }, [pushLog]);

  /* ---- Computed ---- */
  const totalNodes = Object.values(nodeCounts).reduce((a, b) => a + b, 0);
  const syncInProgress = !["idle", "done", "error"].includes(syncStage);
  const syncStageIndex = SYNC_STAGE_ORDER.indexOf(syncStage as SyncStage);
  const syncProgress =
    syncStage === "done"
      ? 100
      : syncInProgress
        ? ((syncStageIndex + 1) / SYNC_STAGE_ORDER.length) * 100
        : 0;

  /* -------------------------------------------------------------------------- */
  /*  Render                                                                    */
  /* -------------------------------------------------------------------------- */

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ingestion</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Import course data, sync from Canvas, and manage the dependency graph.
          </p>
        </div>
        <div className="text-right text-[12px] text-muted-foreground">
          <span className="opacity-60">Last sync</span>
          <br />
          <span className="font-medium text-foreground/70">{formatTime(lastRun)}</span>
        </div>
      </div>

      {/* Three action cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ---------- Card 1: Upload ZIP ---------- */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <UploadCloud className="size-4 text-primary" />
            <h2 className="text-[13px] font-semibold">Upload ZIP</h2>
          </div>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-white/[0.12] hover:border-primary/40"
            }`}
          >
            <UploadCloud className="size-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-[13px] text-muted-foreground">
              Drop Canvas export ZIP here
              <br />
              or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.imscc"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {/* Selected file info */}
          {selectedFile && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium truncate max-w-[70%]">{selectedFile.name}</span>
                <span className="text-muted-foreground">{formatBytes(selectedFile.size)}</span>
              </div>

              {uploading && (
                <Progress value={uploadProgress}>
                  <span className="text-[11px] text-muted-foreground">{uploadProgress}%</span>
                </Progress>
              )}

              {!uploading && !uploadResult && (
                <Button size="sm" className="w-full" onClick={handleUpload}>
                  <UploadCloud className="size-3.5 mr-1.5" />
                  Upload
                </Button>
              )}

              {uploadResult && !uploadResult.error && (
                <div className="flex items-center gap-2 text-[12px] text-emerald-400">
                  <Check className="size-3.5" />
                  <span>
                    {uploadResult.nodes_extracted ?? 0} nodes, {uploadResult.files_extracted ?? 0}{" "}
                    files extracted
                  </span>
                </div>
              )}

              {uploadResult?.error && (
                <div className="flex items-center gap-2 text-[12px] text-destructive">
                  <X className="size-3.5" />
                  <span>{uploadResult.error}</span>
                </div>
              )}
            </div>
          )}
        </GlassCard>

        {/* ---------- Card 2: Canvas Live Sync ---------- */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw
              className={`size-4 text-primary ${syncInProgress ? "animate-spin" : ""}`}
            />
            <h2 className="text-[13px] font-semibold">Canvas Live Sync</h2>
          </div>

          <div className="space-y-3">
            {/* Stage indicator */}
            <div className="space-y-2">
              {SYNC_STAGE_ORDER.map((stage, i) => {
                const current = SYNC_STAGE_ORDER.indexOf(syncStage as SyncStage);
                const isActive = syncStage === stage;
                const isDone =
                  syncStage === "done" || (syncInProgress && i < current);
                const isPending = !isDone && !isActive;

                return (
                  <div
                    key={stage}
                    className={`flex items-center gap-2 text-[12px] transition-opacity ${
                      isPending ? "opacity-30" : "opacity-100"
                    }`}
                  >
                    {isDone && <Check className="size-3.5 text-emerald-400 shrink-0" />}
                    {isActive && (
                      <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                    )}
                    {isPending && (
                      <div className="size-3.5 rounded-full border border-white/20 shrink-0" />
                    )}
                    <span>{SYNC_STAGE_LABELS[stage]}</span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar during sync */}
            {(syncInProgress || syncStage === "done") && (
              <Progress value={syncProgress} />
            )}

            {/* Status badge */}
            {syncStage === "done" && (
              <Badge variant="secondary" className="text-emerald-400">
                <Check className="size-3 mr-1" />
                Complete
              </Badge>
            )}
            {syncStage === "error" && (
              <Badge variant="destructive">
                <X className="size-3 mr-1" />
                Failed
              </Badge>
            )}

            {/* Action button */}
            <Button
              size="sm"
              className="w-full"
              onClick={startSync}
              disabled={syncInProgress}
            >
              {syncInProgress ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Sync from Canvas
                </>
              )}
            </Button>
          </div>
        </GlassCard>

        {/* ---------- Card 3: Rebuild Graph ---------- */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <Network className="size-4 text-primary" />
            <h2 className="text-[13px] font-semibold">Rebuild Graph</h2>
          </div>

          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Rebuild the dependency graph from all ingested nodes. Detects edges and orphan nodes.
            </p>

            {graphResult && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.04] rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{graphResult.edges}</div>
                  <div className="text-[11px] text-muted-foreground">Edges</div>
                </div>
                <div className="bg-white/[0.04] rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{graphResult.orphans}</div>
                  <div className="text-[11px] text-muted-foreground">Orphans</div>
                </div>
              </div>
            )}

            <Button
              size="sm"
              className="w-full"
              onClick={handleRebuildGraph}
              disabled={rebuildingGraph}
            >
              {rebuildingGraph ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Rebuilding...
                </>
              ) : (
                <>
                  <Network className="size-3.5 mr-1.5" />
                  Rebuild Dependency Graph
                </>
              )}
            </Button>

            <Button size="sm" variant="outline" className="w-full" disabled>
              Re-embed All
              <Badge variant="secondary" className="ml-2 text-[10px]">
                Soon
              </Badge>
            </Button>
          </div>
        </GlassCard>
      </div>

      {/* Bottom section: Log + Data Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ---------- Ingestion Log ---------- */}
        <GlassCard className="lg:col-span-2">
          <h2 className="text-[13px] font-semibold mb-3">Ingestion Log</h2>

          {log.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-muted-foreground/50">No ingestion runs yet</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {log.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                >
                  {/* Status icon */}
                  {entry.status === "ok" && (
                    <Check className="size-3.5 text-emerald-400 shrink-0" />
                  )}
                  {entry.status === "error" && (
                    <X className="size-3.5 text-destructive shrink-0" />
                  )}
                  {entry.status === "skip" && (
                    <SkipForward className="size-3.5 text-muted-foreground shrink-0" />
                  )}

                  {/* Action badge */}
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {entry.action}
                  </Badge>

                  {/* Title */}
                  <span className="truncate flex-1">{entry.title}</span>

                  {/* Timestamp */}
                  <span className="text-muted-foreground shrink-0">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* ---------- Data Summary ---------- */}
        <GlassCard>
          <h2 className="text-[13px] font-semibold mb-3">Data Summary</h2>

          <div className="space-y-3">
            {/* Node counts by type */}
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Nodes by type
              </div>
              {(
                Object.entries(nodeCounts) as [keyof NodeTypeCounts, number][]
              ).map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between text-[12px] px-2 py-1 rounded bg-white/[0.02]"
                >
                  <span className="capitalize">{type}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">Total nodes</span>
                <span className="font-semibold tabular-nums">{totalNodes}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">Total edges</span>
                <span className="font-semibold tabular-nums">{totalEdges}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">Last ingestion</span>
                <span className="font-medium">{formatTime(lastRun)}</span>
              </div>
            </div>

            {/* Clear & Re-ingest */}
            <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
              <DialogTrigger
                render={
                  <Button variant="destructive" size="sm" className="w-full" />
                }
              >
                <Trash2 className="size-3.5 mr-1.5" />
                Clear &amp; Re-ingest
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Clear all ingested data?</DialogTitle>
                  <DialogDescription>
                    This will remove all nodes, edges, and findings from the database. You will need
                    to re-ingest from a ZIP or Canvas to restore data. This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose
                    render={<Button variant="outline" size="sm" />}
                  >
                    Cancel
                  </DialogClose>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setClearDialogOpen(false);
                      pushLog("extract", "Clear all data", "ok");
                      // Future: call clear endpoint
                    }}
                  >
                    <AlertTriangle className="size-3.5 mr-1.5" />
                    Yes, clear everything
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
