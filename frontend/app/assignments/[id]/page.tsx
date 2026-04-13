"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type {
  AuditRuntimeState,
  CourseNode,
  CourseNodeSummary,
  Finding,
  FindingSeverity,
  GraphEdge,
  NodeType,
  Rubric,
  RubricCriterion,
  Suggestion,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DiffView } from "@/components/diff-view";
import {
  Link2,
  ArrowLeft,
  FileText,
  BookOpen,
  ClipboardCheck,
  Video,
  Megaphone,
  File,
  Loader2,
  Play,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeIcon(type: string) {
  const cls = "size-4 shrink-0";
  switch (type) {
    case "assignment":
      return <FileText className={cls} />;
    case "page":
      return <BookOpen className={cls} />;
    case "rubric":
      return <ClipboardCheck className={cls} />;
    case "lecture":
      return <Video className={cls} />;
    case "announcement":
      return <Megaphone className={cls} />;
    case "file":
      return <File className={cls} />;
    default:
      return <File className={cls} />;
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case "gap":
      return "severity-gap";
    case "warn":
      return "severity-warn";
    case "info":
      return "severity-info";
    case "ok":
      return "severity-ok";
    default:
      return "";
  }
}

function severityIcon(severity: FindingSeverity) {
  const cls = "size-4 shrink-0";
  switch (severity) {
    case "gap":
      return <XCircle className={cls} />;
    case "warn":
      return <AlertTriangle className={cls} />;
    case "info":
      return <Info className={cls} />;
    case "ok":
      return <CheckCircle2 className={cls} />;
  }
}

function passLabel(pass: number): string {
  switch (pass) {
    case 1:
      return "Standalone Clarity";
    case 2:
      return "Dependencies";
    case 3:
      return "Forward Impact";
    default:
      return `Pass ${pass}`;
  }
}

function isPdfDocument(node: Pick<CourseNode, "title" | "canvas_url" | "file_path">): boolean {
  return [node.title, node.canvas_url, node.file_path].some((value) =>
    Boolean(value && /\.pdf($|\?)/i.test(value)),
  );
}

function analyzeLecturePdf(node: Pick<CourseNode, "title" | "module" | "canvas_url" | "file_path">): {
  isPdf: boolean;
  likelyLecture: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: string[];
} {
  const text = [node.title, node.module, node.canvas_url, node.file_path]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const reasons: string[] = [];

  const isPdf = isPdfDocument(node);
  if (!isPdf) {
    return { isPdf: false, likelyLecture: false, confidence: "low", score: 0, reasons };
  }

  let score = 0;

  if (/lecture\s*materials|\/lecture\s*materials\//i.test(text)) {
    score += 3;
    reasons.push("Located in Lecture Materials path");
  }
  if (/\bweek\s*\d+\b/i.test(text)) {
    score += 1;
    reasons.push("Contains week number");
  }
  if (/\blecture\b|\bslides?\b|\bdeck\b|\bpresentation\b|\blab\b/i.test(text)) {
    score += 2;
    reasons.push("Title includes lecture/lab/slides keywords");
  }
  if (/\bsyllabus\b|\brubric\b|\bassignment\b|\btemplate\b|\bminutes\b|\bgrading\b|\bpaper\b/i.test(text)) {
    score -= 2;
    reasons.push("Title includes non-lecture keywords");
  }

  const likelyLecture = score >= 2;
  const confidence: "high" | "medium" | "low" =
    score >= 4 ? "high" : score >= 2 ? "medium" : "low";

  return { isPdf: true, likelyLecture, confidence, score, reasons };
}

/**
 * Basic HTML sanitizer that strips script tags and event handlers.
 * For course content sourced from Canvas via our own backend.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*\S+/gi, "");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [node, setNode] = useState<CourseNode | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [suggestionsByFinding, setSuggestionsByFinding] = useState<Record<string, Suggestion>>({});
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditState, setAuditState] = useState<AuditRuntimeState>({
    batch_active: false,
    running_count: 0,
    running_assignment_ids: [],
  });
  const [activeTab, setActiveTab] = useState<string>("findings");
  const [assignmentOptions, setAssignmentOptions] = useState<Array<{ value: string; label: string; meta?: string | null }>>([]);
  const [selectedAssignmentLinks, setSelectedAssignmentLinks] = useState<string[]>([]);
  const [linkWeek, setLinkWeek] = useState("");
  const [linkModule, setLinkModule] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [linkedResources, setLinkedResources] = useState<Array<{
    node: CourseNodeSummary;
    direction: "upstream" | "downstream";
    edgeType: GraphEdge["edge_type"];
    edgeLabel: string | null;
    confidence: number | null;
  }>>([]);
  const [linkDataLoading, setLinkDataLoading] = useState(false);
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeMessage, setTypeMessage] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getNode(id),
      api.listFindings({ assignment_id: id }),
      api.listSuggestions({ node_id: id }),
    ])
      .then(([nodeData, findingsData, suggestionsData]) => {
        if (cancelled) return;
        setNode(nodeData);
        setFindings(
          findingsData.filter(
            (f) => f.status === "active" || f.status === "resolved" || f.status === "confirmed",
          ),
        );
        const map: Record<string, Suggestion> = {};
        for (const s of suggestionsData) map[s.finding_id] = s;
        setSuggestionsByFinding(map);
        setLinkWeek(nodeData.week !== null ? String(nodeData.week) : "");
        setLinkModule(nodeData.module ?? "");

        setLinkDataLoading(true);
        Promise.all([api.listNodes(), api.getNodeLinks(nodeData.id), api.getNodeGraph(nodeData.id)])
          .then(([allNodes, links, nodeGraph]) => {
            if (cancelled) return;

            const nodeById = new Map(allNodes.map((entry) => [entry.id, entry]));

            setAssignmentOptions(
              allNodes
                .filter((entry) => entry.type === "assignment")
                .filter((assignment) => assignment.id !== nodeData.id)
                .map((assignment) => ({
                  value: assignment.id,
                  label: assignment.title,
                  meta: assignment.week
                    ? `Week ${assignment.week}${assignment.module ? ` • ${assignment.module}` : ""}`
                    : (assignment.module ?? "No week"),
                })),
            );

            const existing = links
              .filter(
                (link) =>
                  link.target_id === nodeData.id
                  && (link.link_type === "file" || link.link_type === "assignment"),
              )
              .map((link) => link.source_id)
              .filter((sourceId) => sourceId !== nodeData.id);

            setSelectedAssignmentLinks(existing);

            const dedup = new Map<string, {
              node: CourseNodeSummary;
              direction: "upstream" | "downstream";
              edgeType: GraphEdge["edge_type"];
              edgeLabel: string | null;
              confidence: number | null;
            }>();

            const allEdges = [
              ...nodeGraph.upstream.map((edge) => ({ edge, direction: "upstream" as const })),
              ...nodeGraph.downstream.map((edge) => ({ edge, direction: "downstream" as const })),
            ];

            allEdges.forEach(({ edge, direction }) => {
              const relatedId = direction === "upstream" ? edge.source : edge.target;
              const related = nodeById.get(relatedId);
              if (!related || related.id === nodeData.id) return;
              const key = `${related.id}::${edge.edge_type}::${edge.label ?? ""}::${direction}`;
              if (dedup.has(key)) return;
              dedup.set(key, {
                node: related,
                direction,
                edgeType: edge.edge_type,
                edgeLabel: edge.label,
                confidence: edge.confidence,
              });
            });

            setLinkedResources(Array.from(dedup.values()));
          })
          .catch(() => {
            if (cancelled) return;
            setAssignmentOptions([]);
            setSelectedAssignmentLinks([]);
            setLinkedResources([]);
          })
          .finally(() => {
            if (!cancelled) {
              setLinkDataLoading(false);
            }
          });

        // Rubrics are exposed through assignments, not as standalone nodes.
        if (nodeData.rubric_id) {
          api
            .getAssignmentRubric(nodeData.id)
            .then((rubricData) => {
              if (!cancelled) {
                setRubric(rubricData);
              }
            })
            .catch(() => {
              if (!cancelled) {
                setRubric(null);
              }
            });
        } else {
          setRubric(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const fetchAuditState = useMemo(
    () => async () => {
      try {
        const state = await api.getAuditState();
        setAuditState(state);
      } catch {
        /* no-op */
      }
    },
    [],
  );

  useEffect(() => {
    if (!id) return;
    void fetchAuditState();

    const interval = window.setInterval(() => {
      void fetchAuditState();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [id, fetchAuditState]);

  // Group findings by pass
  const findingsByPass = useMemo(() => {
    const map = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!map.has(f.pass_number)) map.set(f.pass_number, []);
      map.get(f.pass_number)!.push(f);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [findings]);

  const handledCount = useMemo(() => {
    return findings.filter((f) => {
      if (f.status === "resolved" || f.status === "confirmed") return true;
      const sug = suggestionsByFinding[f.id];
      return sug !== undefined && sug.status !== "pending";
    }).length;
  }, [findings, suggestionsByFinding]);
  const unhandledCount = findings.length - handledCount;

  const reloadFindingsAndSuggestions = async () => {
    if (!id) return;
    const [newFindings, newSuggestions] = await Promise.all([
      api.listFindings({ assignment_id: id }),
      api.listSuggestions({ node_id: id }),
    ]);
    setFindings(
      newFindings.filter(
        (f) => f.status === "active" || f.status === "resolved" || f.status === "confirmed",
      ),
    );
    const map: Record<string, Suggestion> = {};
    for (const s of newSuggestions) map[s.finding_id] = s;
    setSuggestionsByFinding(map);
  };

  // Start audit
  const handleStartAudit = async () => {
    if (!id) return;
    if (auditState.batch_active) return;
    if (auditState.running_assignment_ids.includes(id)) return;

    setAuditLoading(true);
    try {
      await api.startAudit(id);
      await fetchAuditState();
      // Refetch findings + suggestions after a short delay to allow processing
      setTimeout(async () => {
        try {
          const [newFindings, newSuggestions] = await Promise.all([
            api.listFindings({ assignment_id: id }),
            api.listSuggestions({ node_id: id }),
          ]);
          setFindings(
            newFindings.filter(
              (f) => f.status === "active" || f.status === "resolved" || f.status === "confirmed",
            ),
          );
          const map: Record<string, Suggestion> = {};
          for (const s of newSuggestions) map[s.finding_id] = s;
          setSuggestionsByFinding(map);
          await fetchAuditState();
        } catch {
          /* ignore */
        }
        setAuditLoading(false);
      }, 2000);
    } catch {
      setAuditLoading(false);
    }
  };

  const assignmentRunActive = Boolean(id && auditState.running_assignment_ids.includes(id));
  const runAuditDisabled = auditLoading || assignmentRunActive || auditState.batch_active;

  const handleSaveLinking = async () => {
    if (!node) return;
    setLinkSaving(true);
    setLinkError(null);
    setLinkSuccess(null);

    try {
      const parsedWeek = linkWeek.trim() ? Number(linkWeek) : null;
      if (parsedWeek !== null && (!Number.isInteger(parsedWeek) || parsedWeek < 1)) {
        throw new Error("Week must be a whole number greater than zero.");
      }

      if (!linkModule.trim() && parsedWeek === null && selectedAssignmentLinks.length === 0) {
        throw new Error("Set a week/module or select at least one linked assignment.");
      }

      await api.updateNode(node.id, {
        week: parsedWeek,
        module: linkModule.trim() || null,
      });

      if (selectedAssignmentLinks.length > 0) {
        const linkType = node.type === "file" ? "file" : "assignment";
        await Promise.all(
          selectedAssignmentLinks.map((assignmentId) =>
            api.createNodeLink(assignmentId, node.id, linkType),
          ),
        );
      }

      const refreshedNode = await api.getNode(node.id);
      setNode(refreshedNode);
      setLinkSuccess(
        selectedAssignmentLinks.length > 1
          ? `Saved. Linked to ${selectedAssignmentLinks.length} assignments.`
          : "Linking details updated.",
      );
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to update linking details");
    } finally {
      setLinkSaving(false);
    }
  };

  const handleAssignNodeType = async (nextType: NodeType) => {
    if (!node) return;
    if (nextType === node.type) return;
    setTypeSaving(true);
    setTypeMessage(null);
    try {
      const updated = await api.updateNode(node.id, { type: nextType });
      setNode(updated);
      setTypeMessage(
        nextType === "lecture"
          ? "Document marked as lecture type."
          : `Node type updated to ${nextType}.`,
      );
    } catch (err) {
      setTypeMessage(err instanceof Error ? err.message : "Unable to update node type.");
    } finally {
      setTypeSaving(false);
    }
  };

  const linkedByType = useMemo(() => {
    const grouped = new Map<NodeType, typeof linkedResources>();
    linkedResources.forEach((item) => {
      const bucket = grouped.get(item.node.type) ?? [];
      bucket.push(item);
      grouped.set(item.node.type, bucket);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([type, items]) => ({
        type,
        items: items.sort((a, b) => a.node.title.localeCompare(b.node.title)),
      }));
  }, [linkedResources]);

  const lectureSignal = useMemo(() => {
    if (!node) return null;
    return analyzeLecturePdf(node);
  }, [node]);

  // ---------------------------------------------------------------------------
  // Loading / Error states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl">
        {/* Skeleton breadcrumb */}
        <div className="h-5 w-60 rounded bg-white/[0.04] animate-pulse" />
        {/* Skeleton header card */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div className="h-7 w-80 rounded bg-white/[0.06] animate-pulse" />
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded-full bg-white/[0.04] animate-pulse" />
            <div className="h-5 w-16 rounded-full bg-white/[0.04] animate-pulse" />
            <div className="h-5 w-16 rounded-full bg-white/[0.04] animate-pulse" />
          </div>
          <div className="h-4 w-48 rounded bg-white/[0.04] animate-pulse" />
        </div>
        {/* Skeleton tabs */}
        <div className="h-8 w-72 rounded bg-white/[0.04] animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-white/[0.03] border border-white/[0.06] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="space-y-6 max-w-5xl">
        <button
          onClick={() => router.push("/assignments")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Assignments
        </button>
        <div className="rounded-xl bg-white/[0.03] border border-destructive/20 p-8 text-center space-y-2">
          <p className="text-sm text-destructive">{error ?? "Assignment not found"}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <button
          onClick={() => router.push("/assignments")}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Assignments
        </button>
        <ChevronRight className="size-3 text-muted-foreground/50" />
        {node.week !== null && (
          <>
            <span className="text-muted-foreground">Week {node.week}</span>
            <ChevronRight className="size-3 text-muted-foreground/50" />
          </>
        )}
        <span className="text-foreground/80 truncate max-w-[300px]">{node.title}</span>
      </div>

      {/* Header card */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3 flex-1 min-w-0">
            {/* Title */}
            <h1 className="text-xl font-semibold tracking-tight leading-snug">
              {node.title}
            </h1>

            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status */}
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  node.status === "unaudited"
                    ? "bg-white/[0.04] text-muted-foreground border-white/[0.08]"
                    : severityClass(node.status)
                }`}
              >
                {node.status.charAt(0).toUpperCase() + node.status.slice(1)}
              </span>

              {/* Type */}
              <Badge variant="secondary" className="gap-1.5 text-xs capitalize">
                {typeIcon(node.type)}
                {node.type}
              </Badge>

              {/* Week */}
              {node.week !== null && (
                <Badge variant="outline" className="text-xs">
                  Week {node.week}
                </Badge>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              {node.points_possible !== null && (
                <span>{node.points_possible} points</span>
              )}
              {node.submission_types && node.submission_types.length > 0 && (
                <span>
                  Submission: {node.submission_types.join(", ").replace(/_/g, " ")}
                </span>
              )}
              {node.module && <span>Module: {node.module}</span>}
            </div>
          </div>

          {/* Run Audit button */}
          <button
            onClick={handleStartAudit}
            disabled={runAuditDisabled}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed shrink-0 ${
              runAuditDisabled
                ? "bg-muted/35 border border-muted/50 text-muted-foreground"
                : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
            } ${assignmentRunActive ? "ring-2 ring-orange-400/70 animate-pulse" : ""}`}
          >
            {auditLoading || assignmentRunActive || auditState.batch_active ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {auditLoading
              ? "Starting..."
              : assignmentRunActive
                ? "Audit Running"
                : auditState.batch_active
                  ? "Locked: Course Audit Running"
                  : "Run Audit"}
          </button>
        </div>
      </div>

      {(node.type === "file" || node.week === null) && (
        <div className="bg-secondary/30 border border-secondary/55 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground/90">Assignment & Module Linking</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Assign this item to a week/module and link it to one or more assignments.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              value={linkWeek}
              onChange={(event) => setLinkWeek(event.target.value)}
              placeholder="Week (e.g. 5)"
              className="glass-input"
            />
            <Input
              value={linkModule}
              onChange={(event) => setLinkModule(event.target.value)}
              placeholder="Module name"
              className="glass-input"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Linked assignments (multi-select)
            </p>
            <SearchableMultiSelect
              options={assignmentOptions}
              value={selectedAssignmentLinks}
              onValueChange={setSelectedAssignmentLinks}
              placeholder="Search and select assignments..."
              emptyLabel="No assignment matches your search"
            />
            <p className="text-[11px] text-muted-foreground">Multiple links are supported.</p>
          </div>

          {linkError && <p className="text-xs text-destructive">{linkError}</p>}
          {linkSuccess && <p className="text-xs text-emerald-300">{linkSuccess}</p>}

          <div className="flex justify-end">
            <Button onClick={handleSaveLinking} disabled={linkSaving}>
              {linkSaving ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Link2 className="size-4 mr-1.5" />
                  Save Linking
                </>
              )}
            </Button>
          </div>

          {node.type === "file" || node.type === "lecture" ? (
            <div className="border-t border-white/6 pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground/90">Document Classification</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Auto-checks whether this PDF looks like lecture content and lets you assign type.
                  </p>
                </div>
                <Badge variant="outline" className="capitalize text-[11px]">
                  Current: {node.type}
                </Badge>
              </div>

              {lectureSignal && lectureSignal.isPdf ? (
                <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 space-y-1.5">
                  <p className="text-xs text-foreground/85">
                    Lecture likelihood: <span className="font-semibold capitalize">{lectureSignal.confidence}</span>
                    {` `}({lectureSignal.score} pts)
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">
                    {lectureSignal.likelyLecture
                      ? "This PDF matches common lecture naming/path patterns."
                      : "This PDF does not strongly match lecture patterns yet."}
                  </p>
                  {lectureSignal.reasons.length > 0 && (
                    <p className="text-[11px] text-muted-foreground/60">
                      {lectureSignal.reasons.join(" • ")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/70">
                  This item does not appear to be a PDF, so auto lecture detection is unavailable.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={node.type === "lecture" ? "secondary" : "default"}
                  disabled={typeSaving || node.type === "lecture"}
                  onClick={() => handleAssignNodeType("lecture")}
                >
                  {typeSaving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
                  Mark as Lecture
                </Button>
                <Button
                  variant={node.type === "file" ? "secondary" : "outline"}
                  disabled={typeSaving || node.type === "file"}
                  onClick={() => handleAssignNodeType("file")}
                >
                  Set as File
                </Button>
              </div>

              {typeMessage && (
                <p className="text-xs text-muted-foreground">{typeMessage}</p>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="findings">
            Findings
            {findings.length > 0 && (
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                ({unhandledCount} unhandled · {handledCount} handled)
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="links">
            Linked Resources
            {linkedResources.length > 0 && (
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                ({linkedResources.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          {node.rubric_id && <TabsTrigger value="rubric">Rubric</TabsTrigger>}
        </TabsList>

        <TabsContent value="links" className="mt-4 space-y-4">
          {linkDataLoading ? (
            <div className="rounded-xl border border-white/8 bg-white/2 p-4">
              <p className="text-sm text-muted-foreground">Loading linked resources...</p>
            </div>
          ) : linkedByType.length === 0 ? (
            <div className="rounded-xl border border-white/8 bg-white/2 p-6 text-center">
              <p className="text-sm text-muted-foreground">No linked resources found for this item.</p>
            </div>
          ) : (
            linkedByType.map((group) => (
              <div key={group.type} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize text-[11px]">
                    {group.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{group.items.length} linked</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {group.items.map((item) => (
                    <button
                      key={`${item.node.id}-${item.edgeType}-${item.direction}-${item.edgeLabel ?? ""}`}
                      onClick={() => router.push(`/assignments/${item.node.id}`)}
                      className="w-full text-left rounded-lg border border-white/8 bg-white/2 hover:bg-white/5 transition-colors p-3"
                    >
                      <div className="flex items-center gap-2">
                        {typeIcon(item.node.type)}
                        <p className="text-sm text-foreground/90 truncate">{item.node.title}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground/70 capitalize">
                        {item.direction === "upstream" ? "Depends on" : "Referenced by"}
                        {` • `}
                        {item.edgeType}
                        {item.edgeLabel ? ` • ${item.edgeLabel}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* Findings tab */}
        <TabsContent value="findings" className="mt-4 space-y-6">
          {findings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <div className="rounded-full bg-white/[0.03] border border-white/[0.08] p-3">
                <ClipboardCheck className="size-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                No findings yet — run an audit to analyze this assignment.
              </p>
            </div>
          ) : (
            findingsByPass.map(([pass, passFindings]) => (
              <div key={pass} className="space-y-3">
                {/* Pass header */}
                <div className="flex items-center gap-2.5">
                  <h3 className="text-sm font-semibold text-foreground/90">
                    Pass {pass} — {passLabel(pass)}
                  </h3>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({passFindings.length} finding
                    {passFindings.length !== 1 ? "s" : ""})
                  </span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                {/* Finding cards */}
                <div className="space-y-3">
                  {passFindings.map((finding) => (
                    <FindingReviewCard
                      key={finding.id}
                      finding={finding}
                      suggestion={suggestionsByFinding[finding.id]}
                      onReload={reloadFindingsAndSuggestions}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* Content tab */}
        <TabsContent value="content" className="mt-4">
          {node.description ? (
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6">
              <div
                className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground/90 prose-p:text-foreground/70 prose-a:text-primary prose-strong:text-foreground/80"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(node.description) }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <p className="text-sm text-muted-foreground">
                No content available for this assignment.
              </p>
            </div>
          )}
        </TabsContent>

        {/* Rubric tab */}
        {node.rubric_id && (
          <TabsContent value="rubric" className="mt-4">
            {rubric && "criteria" in rubric && rubric.criteria ? (
              <RubricDisplay rubric={rubric} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Rubric data is not yet available.
                </p>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type ReasonMode = "deny" | "ignore" | "done" | null;

function FindingReviewCard({
  finding,
  suggestion,
  onReload,
}: {
  finding: Finding;
  suggestion: Suggestion | undefined;
  onReload: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [acting, setActing] = useState<"approve" | "deny" | "ignore" | "done" | "generate" | null>(null);
  const [dialogMode, setDialogMode] = useState<ReasonMode>(null);
  const [reasonText, setReasonText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handled =
    finding.status === "resolved" ||
    finding.status === "confirmed" ||
    (suggestion !== undefined && suggestion.status !== "pending");

  const statusLabel = (() => {
    if (suggestion) {
      if (suggestion.status === "approved") return "Applied to Canvas";
      if (suggestion.status === "denied") return "Denied";
      if (suggestion.status === "ignored") return "Ignored";
      if (suggestion.status === "done_manually") return "Done Manually";
    }
    if (finding.status === "resolved") return "Resolved";
    if (finding.status === "confirmed") return "Confirmed";
    return null;
  })();

  const statusBadgeClass = (() => {
    if (!statusLabel) return "";
    if (statusLabel === "Applied to Canvas" || statusLabel === "Resolved" || statusLabel === "Done Manually")
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    if (statusLabel === "Denied" || statusLabel === "Confirmed")
      return "bg-red-500/15 text-red-300 border-red-500/30";
    return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  })();

  const runApprove = async () => {
    if (!suggestion) return;
    setActing("approve");
    setErrorMessage(null);
    try {
      await api.approveSuggestion(suggestion.id);
      await onReload();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const runGenerate = async () => {
    setActing("generate");
    setErrorMessage(null);
    try {
      await api.generateSuggestionForFinding(finding.id);
      await onReload();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const submitReason = async () => {
    if (!suggestion || dialogMode === null) return;
    const trimmed = reasonText.trim();
    if ((dialogMode === "deny" || dialogMode === "ignore") && trimmed.length === 0) {
      setErrorMessage("A reason is required.");
      return;
    }
    setActing(dialogMode === "done" ? "done" : dialogMode);
    setErrorMessage(null);
    try {
      if (dialogMode === "deny") {
        await api.denySuggestion(suggestion.id, trimmed);
      } else if (dialogMode === "ignore") {
        await api.ignoreSuggestion(suggestion.id, trimmed);
      } else {
        await api.markSuggestionDoneManually(suggestion.id, trimmed.length > 0 ? trimmed : null);
      }
      setDialogMode(null);
      setReasonText("");
      await onReload();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-colors ${
        handled ? "bg-card/40 border-border/60" : "bg-white/[0.03] border-white/[0.08]"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <div className="mt-0.5">{severityIcon(finding.severity)}</div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityClass(
                finding.severity,
              )}`}
            >
              {finding.severity}
            </span>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {finding.finding_type.replace(/_/g, " ")}
            </span>
            {statusLabel && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass}`}
              >
                {statusLabel}
              </span>
            )}
          </div>
          <p
            className={`text-sm font-medium ${
              handled ? "text-muted-foreground/80 line-through decoration-muted-foreground/40" : "text-foreground/90"
            }`}
          >
            {finding.title}
          </p>
        </div>
        <ChevronRight
          className={`size-4 text-muted-foreground/50 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="pl-7 space-y-3">
          <p className="text-sm text-foreground/70 leading-relaxed">{finding.body}</p>

          {finding.evidence && (
            <div className="border-l-2 border-primary/40 pl-3 py-1 text-sm text-muted-foreground/80 italic bg-white/[0.02] rounded-r">
              {finding.evidence}
            </div>
          )}

          {finding.linked_node && (
            <div>
              <a
                href={`/assignments/${finding.linked_node}`}
                className="text-xs text-primary/80 hover:text-primary transition-colors"
              >
                View linked node →
              </a>
            </div>
          )}

          {/* Suggestion section */}
          {suggestion ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                <span>Suggested fix</span>
                <span>·</span>
                <span>target: <span className="font-mono text-foreground/70">{suggestion.target_type}</span></span>
                <span>·</span>
                <span>field: <span className="font-mono text-foreground/70">{suggestion.field}</span></span>
              </div>
              <DiffView patch={suggestion.diff_patch} />
              {suggestion.denial_reason && (
                <p className="text-[12px] text-red-400/80">
                  <span className="font-semibold">Reason for denial:</span> {suggestion.denial_reason}
                </p>
              )}
              {suggestion.ignore_reason && (
                <p className="text-[12px] text-zinc-400/80">
                  <span className="font-semibold">Reason to ignore:</span> {suggestion.ignore_reason}
                </p>
              )}
              {suggestion.manual_note && (
                <p className="text-[12px] text-emerald-400/80">
                  <span className="font-semibold">Manual note:</span> {suggestion.manual_note}
                </p>
              )}

              {suggestion.status === "pending" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={runApprove}
                    disabled={acting !== null}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                  >
                    {acting === "approve" ? "Applying…" : "Approve & Apply"}
                  </button>
                  <button
                    onClick={() => {
                      setDialogMode("deny");
                      setReasonText("");
                      setErrorMessage(null);
                    }}
                    disabled={acting !== null}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-50"
                  >
                    Deny
                  </button>
                  <button
                    onClick={() => {
                      setDialogMode("ignore");
                      setReasonText("");
                      setErrorMessage(null);
                    }}
                    disabled={acting !== null}
                    className="rounded-lg border border-zinc-500/30 bg-zinc-500/10 px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-zinc-500/20 transition-all disabled:opacity-50"
                  >
                    Ignore
                  </button>
                  <button
                    onClick={() => {
                      setDialogMode("done");
                      setReasonText("");
                      setErrorMessage(null);
                    }}
                    disabled={acting !== null}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[12px] font-medium text-sky-300 hover:bg-sky-500/20 transition-all disabled:opacity-50"
                  >
                    Done Manually
                  </button>
                </div>
              )}
            </div>
          ) : (
            !handled && (
              <div>
                <button
                  onClick={runGenerate}
                  disabled={acting !== null}
                  className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  {acting === "generate" ? "Generating fix…" : "Generate fix with AI"}
                </button>
              </div>
            )
          )}

          {errorMessage && (
            <p className="text-[12px] text-red-400">{errorMessage}</p>
          )}
        </div>
      )}

      {/* Reason / note dialog */}
      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMode(null);
            setReasonText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "deny" && "Deny this suggestion"}
              {dialogMode === "ignore" && "Ignore this suggestion"}
              {dialogMode === "done" && "Mark as done manually"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "deny" &&
                "Explain why this suggestion is wrong. The reason is recorded in the changelog."}
              {dialogMode === "ignore" &&
                "Explain why you're deferring this. The finding stays active so it can resurface on the next audit."}
              {dialogMode === "done" &&
                "Optional note describing what you did. The change is logged in the changelog regardless."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={
              dialogMode === "done"
                ? "Optional note…"
                : "Reason (required)…"
            }
            rows={4}
            className="w-full rounded-lg border border-border bg-input/60 p-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {errorMessage && (
            <p className="text-[12px] text-red-400 -mt-2">{errorMessage}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDialogMode(null);
                setReasonText("");
              }}
              disabled={acting !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={submitReason}
              disabled={acting !== null}
            >
              {acting !== null ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RubricDisplay({ rubric }: { rubric: Rubric }) {
  return (
    <div className="space-y-4">
      {rubric.title && (
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground/90">{rubric.title}</h3>
          {rubric.points_possible !== null && (
            <Badge variant="outline" className="text-xs">
              {rubric.points_possible} pts
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-3">
        {rubric.criteria.map((criterion: RubricCriterion) => (
          <div
            key={criterion.id}
            className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4 space-y-3"
          >
            {/* Criterion header */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground/90">
                {criterion.description}
              </p>
              <Badge variant="outline" className="text-xs shrink-0">
                {criterion.points} pts
              </Badge>
            </div>

            {/* Ratings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {criterion.ratings.map((rating) => (
                <div
                  key={rating.id}
                  className="bg-white/[0.02] border border-white/[0.06] rounded-md p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground/80">
                      {rating.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {rating.points} pts
                    </span>
                  </div>
                  {rating.description && (
                    <p className="text-xs text-muted-foreground/70 leading-relaxed">
                      {rating.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
