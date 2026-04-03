"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type {
  CourseNode,
  Finding,
  FindingSeverity,
  Rubric,
  RubricCriterion,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("findings");
  const [assignmentOptions, setAssignmentOptions] = useState<Array<{ value: string; label: string; meta?: string | null }>>([]);
  const [selectedAssignmentLinks, setSelectedAssignmentLinks] = useState<string[]>([]);
  const [linkWeek, setLinkWeek] = useState("");
  const [linkModule, setLinkModule] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([api.getNode(id), api.listFindings({ assignment_id: id })])
      .then(([nodeData, findingsData]) => {
        if (cancelled) return;
        setNode(nodeData);
        setFindings(findingsData.filter((f) => f.status === "active"));
        setLinkWeek(nodeData.week !== null ? String(nodeData.week) : "");
        setLinkModule(nodeData.module ?? "");

        Promise.all([api.listNodes({ type: "assignment" }), api.getNodeLinks(nodeData.id)])
          .then(([assignments, links]) => {
            if (cancelled) return;

            setAssignmentOptions(
              assignments
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
          })
          .catch(() => {
            if (cancelled) return;
            setAssignmentOptions([]);
            setSelectedAssignmentLinks([]);
          });

        // Fetch rubric if node has one
        if (nodeData.rubric_id) {
          api
            .getNode(nodeData.rubric_id)
            .then((rubricNode) => {
              // The rubric data may be embedded or separate — handle gracefully
              if (!cancelled) {
                setRubric(rubricNode as unknown as Rubric);
              }
            })
            .catch(() => {
              /* rubric fetch is optional */
            });
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

  // Group findings by pass
  const findingsByPass = useMemo(() => {
    const map = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!map.has(f.pass_number)) map.set(f.pass_number, []);
      map.get(f.pass_number)!.push(f);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [findings]);

  // Start audit
  const handleStartAudit = async () => {
    if (!id) return;
    setAuditLoading(true);
    try {
      await api.startAudit(id);
      // Refetch findings after a short delay to allow processing
      setTimeout(async () => {
        try {
          const newFindings = await api.listFindings({ assignment_id: id });
          setFindings(newFindings.filter((f) => f.status === "active"));
        } catch {
          /* ignore */
        }
        setAuditLoading(false);
      }, 2000);
    } catch {
      setAuditLoading(false);
    }
  };

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
            disabled={auditLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary/15 border border-primary/25 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {auditLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {auditLoading ? "Running..." : "Run Audit"}
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
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="findings">
            Findings
            {findings.length > 0 && (
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                ({findings.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          {node.rubric_id && <TabsTrigger value="rubric">Rubric</TabsTrigger>}
        </TabsList>

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
                    <FindingCard key={finding.id} finding={finding} />
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

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-4 space-y-2">
      {/* Header row */}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">{severityIcon(finding.severity)}</div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityClass(
                finding.severity
              )}`}
            >
              {finding.severity}
            </span>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {finding.finding_type.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground/90">{finding.title}</p>
        </div>
      </div>

      {/* Body */}
      <p className="text-sm text-foreground/70 leading-relaxed pl-7">{finding.body}</p>

      {/* Evidence quote */}
      {finding.evidence && (
        <div className="ml-7 border-l-2 border-primary/40 pl-3 py-1 text-sm text-muted-foreground/80 italic bg-white/[0.02] rounded-r">
          {finding.evidence}
        </div>
      )}

      {/* Linked node */}
      {finding.linked_node && (
        <div className="pl-7">
          <a
            href={`/assignments/${finding.linked_node}`}
            className="text-xs text-primary/80 hover:text-primary transition-colors"
          >
            View linked node →
          </a>
        </div>
      )}
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
