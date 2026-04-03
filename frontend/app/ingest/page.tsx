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
import type { CourseNodeSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  nodes_created?: number;
  files_extracted?: number;
  status?: string;
  error?: string;
}

type AssignmentMode = "assignment" | "lecture" | "metadata";

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
  const [unassignedFiles, setUnassignedFiles] = useState<CourseNodeSummary[]>([]);
  const [assignmentNodes, setAssignmentNodes] = useState<CourseNodeSummary[]>([]);
  const [lectureNodes, setLectureNodes] = useState<CourseNodeSummary[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("assignment");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [targetWeek, setTargetWeek] = useState("");
  const [targetModule, setTargetModule] = useState("");
  const [assigningFile, setAssigningFile] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  /* ---- ZIP upload state ---- */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  /* ---- Canvas sync state ---- */
  const [syncStage, setSyncStage] = useState<SyncStage>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- Graph rebuild state ---- */
  const [rebuildingGraph, setRebuildingGraph] = useState(false);
  const [graphResult, setGraphResult] = useState<GraphResult | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

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

  const refreshNodeCounts = useCallback(async () => {
    try {
      const nodes = await api.listNodes();
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
    } catch {
      // Best-effort UI refresh only.
    }
  }, []);

  const refreshAssignableData = useCallback(async () => {
    try {
      const [files, assignments, lectures] = await Promise.all([
        api.listNodes({ type: "file" }),
        api.listNodes({ type: "assignment" }),
        api.listNodes({ type: "lecture" }),
      ]);

      const unassigned = files.filter((n) => n.week === null && !n.module);
      setUnassignedFiles(unassigned);
      setAssignmentNodes(assignments);
      setLectureNodes(lectures);

      if (!unassigned.find((n) => n.id === selectedFileId)) {
        setSelectedFileId(unassigned[0]?.id ?? "");
      }
    } catch {
      // Assignment tools are supplementary; ignore load errors.
    }
  }, [selectedFileId]);

  /* ---- initial fetch ---- */
  useEffect(() => {
    api.getIngestStatus().then((s) => {
      if (s.last_run) setLastRun(s.last_run);
    }).catch(() => {});
    refreshNodeCounts();
    refreshAssignableData();

    api.getGraph().then((g) => {
      setTotalEdges(g.edges.length);
    }).catch(() => {});
  }, [refreshNodeCounts, refreshAssignableData]);

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
      await refreshNodeCounts();
      await refreshAssignableData();
    } catch (err) {
      clearInterval(progressInterval);
      setUploadProgress(0);
      setUploadResult({ error: err instanceof Error ? err.message : "Upload failed" });
      pushLog("upload", selectedFile.name, "error");
    } finally {
      setUploading(false);
    }
  }, [selectedFile, pushLog, refreshNodeCounts, refreshAssignableData]);

  /* ---- Canvas Sync handlers ---- */
  const startSync = useCallback(async () => {
    setSyncStage("fetching_modules");
    setSyncError(null);
    if (syncPollRef.current) clearInterval(syncPollRef.current);

    try {
      await api.startIngest();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start Canvas sync";
      console.error("[Canvas sync] POST /api/ingest/course failed:", msg);
      setSyncStage("error");
      setSyncError(msg);
      pushLog("sync", "Canvas live sync", "error");
      return;
    }

    // Poll backend status until done or error
    syncPollRef.current = setInterval(async () => {
      try {
        const status = await api.getIngestStatus();
        const stage = (status.stage ?? "") as SyncStage;
        if (SYNC_STAGE_ORDER.includes(stage)) {
          setSyncStage(stage);
        }
        if (status.status === "done") {
          if (syncPollRef.current) clearInterval(syncPollRef.current);
          setSyncStage("done");
          setLastRun(status.last_run ?? new Date().toISOString());
          pushLog("sync", "Canvas live sync", "ok");
          await refreshNodeCounts();
          await refreshAssignableData();
        } else if (status.status === "error") {
          if (syncPollRef.current) clearInterval(syncPollRef.current);
          setSyncStage("error");
          const errMsg = (status as Record<string, unknown>).message as string | undefined;
          console.error("[Canvas sync] Backend reported error:", errMsg ?? "unknown");
          setSyncError(errMsg ?? "Sync failed — check backend logs");
          pushLog("sync", "Canvas live sync", "error");
        }
      } catch (pollErr) {
        // Transient poll error — log but keep polling
        console.warn("[Canvas sync] Poll error (will retry):", pollErr);
      }
    }, 2000);
  }, [pushLog, refreshNodeCounts, refreshAssignableData]);

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

  const handleCleanupTestData = useCallback(async () => {
    setCleanupLoading(true);
    setAssignError(null);
    try {
      const result = await api.cleanupTestData();
      pushLog("extract", `Removed ${result.nodes_deleted} seeded nodes`, "ok");
      await refreshNodeCounts();
      await refreshAssignableData();

      const graph = await api.getGraph();
      setTotalEdges(graph.edges.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove seeded data";
      setAssignError(message);
      pushLog("extract", `Seed cleanup failed: ${message}`, "error");
    } finally {
      setCleanupLoading(false);
    }
  }, [pushLog, refreshNodeCounts, refreshAssignableData]);

  const handleAssignFile = useCallback(async () => {
    if (!selectedFileId) return;

    setAssigningFile(true);
    setAssignError(null);

    try {
      if (assignmentMode === "assignment") {
        if (!selectedAssignmentId) {
          throw new Error("Select an assignment first.");
        }
        const assignmentNode = assignmentNodes.find((n) => n.id === selectedAssignmentId);
        if (!assignmentNode) {
          throw new Error("Selected assignment was not found.");
        }

        await api.createNodeLink(selectedAssignmentId, selectedFileId, "file");
        await api.updateNode(selectedFileId, {
          week: assignmentNode.week,
          module: assignmentNode.module,
        });
        pushLog("extract", `Linked file to assignment: ${assignmentNode.title}`, "ok");
      }

      if (assignmentMode === "lecture") {
        if (!selectedLectureId) {
          throw new Error("Select a lecture first.");
        }
        const lectureNode = lectureNodes.find((n) => n.id === selectedLectureId);
        if (!lectureNode) {
          throw new Error("Selected lecture was not found.");
        }

        await api.createNodeLink(selectedLectureId, selectedFileId, "file");
        await api.updateNode(selectedFileId, {
          week: lectureNode.week,
          module: lectureNode.module,
        });
        pushLog("extract", `Linked file to lecture: ${lectureNode.title}`, "ok");
      }

      if (assignmentMode === "metadata") {
        const parsedWeek = targetWeek.trim() === "" ? null : Number(targetWeek);
        if (parsedWeek !== null && !Number.isInteger(parsedWeek)) {
          throw new Error("Week must be a whole number.");
        }

        await api.updateNode(selectedFileId, {
          week: parsedWeek,
          module: targetModule.trim() || null,
        });
        pushLog("extract", "Updated file week/module", "ok");
      }

      await refreshAssignableData();
      await refreshNodeCounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to assign file";
      setAssignError(message);
      pushLog("extract", `File assignment failed: ${message}`, "error");
    } finally {
      setAssigningFile(false);
    }
  }, [
    selectedFileId,
    assignmentMode,
    selectedAssignmentId,
    selectedLectureId,
    targetWeek,
    targetModule,
    assignmentNodes,
    lectureNodes,
    pushLog,
    refreshAssignableData,
    refreshNodeCounts,
  ]);

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
          <span className="font-medium text-foreground/70" suppressHydrationWarning>{formatTime(lastRun)}</span>
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
                    {uploadResult.nodes_created ?? 0} nodes, {uploadResult.files_extracted ?? 0}{" "}
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
              <div className="space-y-1.5">
                <Badge variant="destructive">
                  <X className="size-3 mr-1" />
                  Failed
                </Badge>
                {syncError && (
                  <p className="text-[11px] text-destructive/80 break-words">{syncError}</p>
                )}
              </div>
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

      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[13px] font-semibold">Unassigned File Triage</h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Link unfiled files to an assignment or lecture, or set week/module manually.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px]">
            {unassignedFiles.length} unassigned
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">File</p>
              <Select value={selectedFileId} onValueChange={(value) => setSelectedFileId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an unassigned file" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedFiles.map((file) => (
                    <SelectItem key={file.id} value={file.id}>
                      {file.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Assign by</p>
              <Select value={assignmentMode} onValueChange={(v) => setAssignmentMode((v ?? "assignment") as AssignmentMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assignment">Related assignment</SelectItem>
                  <SelectItem value="lecture">Related lecture</SelectItem>
                  <SelectItem value="metadata">Week/module only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {assignmentMode === "assignment" && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Assignment</p>
                <Select value={selectedAssignmentId} onValueChange={(value) => setSelectedAssignmentId(value ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignmentNodes.map((assignment) => (
                      <SelectItem key={assignment.id} value={assignment.id}>
                        {assignment.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {assignmentMode === "lecture" && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Lecture</p>
                <Select value={selectedLectureId} onValueChange={(value) => setSelectedLectureId(value ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select lecture" />
                  </SelectTrigger>
                  <SelectContent>
                    {lectureNodes.map((lecture) => (
                      <SelectItem key={lecture.id} value={lecture.id}>
                        {lecture.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {assignmentMode === "metadata" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  value={targetWeek}
                  onChange={(e) => setTargetWeek(e.target.value)}
                  placeholder="Week (e.g. 6)"
                />
                <Input
                  value={targetModule}
                  onChange={(e) => setTargetModule(e.target.value)}
                  placeholder="Module (optional)"
                />
              </div>
            )}

            {assignError && (
              <p className="text-[12px] text-destructive">{assignError}</p>
            )}

            <Button
              onClick={handleAssignFile}
              disabled={!selectedFileId || assigningFile}
              className="w-full"
            >
              {assigningFile ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Apply Assignment"
              )}
            </Button>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Current unassigned files
            </p>
            {unassignedFiles.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-[12px] text-emerald-300">
                No unassigned files remain.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {unassignedFiles.slice(0, 30).map((file) => (
                  <div
                    key={file.id}
                    className="rounded-md bg-white/[0.02] px-2.5 py-1.5 text-[12px] text-muted-foreground"
                  >
                    {file.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

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
                  <span className="text-muted-foreground shrink-0" suppressHydrationWarning>
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
                <span className="font-medium" suppressHydrationWarning>{formatTime(lastRun)}</span>
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

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleCleanupTestData}
              disabled={cleanupLoading}
            >
              {cleanupLoading ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Removing seeded data...
                </>
              ) : (
                <>
                  <Trash2 className="size-3.5 mr-1.5" />
                  Remove Seed/Test Data
                </>
              )}
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
