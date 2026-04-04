"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CourseNodeSummary, NodeLink, NodeType, NodeStatus } from "@/lib/types";
import { useAuditState } from "@/hooks/useAuditState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Link2,
  FileText,
  BookOpen,
  ClipboardCheck,
  Video,
  Megaphone,
  File,
  Search,
  X,
  Loader2,
  PackageOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "assignment", label: "Assignment" },
  { value: "page", label: "Page" },
  { value: "lecture", label: "Lecture" },
  { value: "announcement", label: "Announcement" },
  { value: "file", label: "File" },
];

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Severities" },
  { value: "gap", label: "Gap" },
  { value: "warn", label: "Warning" },
  { value: "info", label: "Info" },
  { value: "ok", label: "OK" },
  { value: "unaudited", label: "Unaudited" },
];

const WEEK_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Weeks" },
  ...Array.from({ length: 15 }, (_, i) => ({
    value: String(i + 1),
    label: `Week ${i + 1}`,
  })),
  { value: "none", label: "No Week" },
];

const TYPE_PRIORITY: Record<NodeType, number> = {
  assignment: 0,
  page: 1,
  file: 2,
  lecture: 3,
  announcement: 4,
  rubric: 5,
};

function isLinkableNodeType(type: NodeType): boolean {
  return type === "assignment" || type === "page" || type === "file";
}

function canCreateFileLink(source: CourseNodeSummary, target: CourseNodeSummary): boolean {
  if (source.id === target.id) return false;
  const sourceIsFile = source.type === "file";
  const targetIsFile = target.type === "file";
  if (sourceIsFile === targetIsFile) return false;

  const nonFile = sourceIsFile ? target : source;
  return nonFile.type === "assignment" || nonFile.type === "page";
}

function typeIcon(type: NodeType) {
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
  }
}

function typeLabel(type: NodeType): string {
  switch (type) {
    case "assignment":
      return "Assignment";
    case "page":
      return "Page";
    case "rubric":
      return "Rubric";
    case "lecture":
      return "Lecture";
    case "announcement":
      return "Announcement";
    case "file":
      return "File";
  }
}

function typePillClass(type: NodeType): string {
  switch (type) {
    case "assignment":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "file":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "lecture":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    case "page":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
    case "announcement":
      return "border-pink-400/30 bg-pink-400/10 text-pink-200";
    case "rubric":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }
}

function severityClass(status: NodeStatus): string {
  switch (status) {
    case "gap":
      return "severity-gap";
    case "warn":
      return "severity-warn";
    case "ok":
      return "severity-ok";
    case "orphan":
      return "severity-info";
    case "unaudited":
      return "";
  }
}

function severityLabel(status: NodeStatus): string {
  switch (status) {
    case "gap":
      return "Gap";
    case "warn":
      return "Warning";
    case "ok":
      return "OK";
    case "orphan":
      return "Orphan";
    case "unaudited":
      return "Unaudited";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DisplayNode {
  key: string;
  node: CourseNodeSummary;
  moduleLabel: string | null;
  isLinkedReference: boolean;
  linkedViaSource: string | null;
}

interface GroupedNodes {
  key: string;
  week: number | null;
  module: string | null;
  items: DisplayNode[];
}

export default function AssignmentsPage() {
  const router = useRouter();
  const auditState = useAuditState();
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [nodeLinks, setNodeLinks] = useState<NodeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedUnassigned, setSelectedUnassigned] = useState<CourseNodeSummary | null>(null);
  const [assignWeek, setAssignWeek] = useState("");
  const [assignModule, setAssignModule] = useState("");
  const [selectedAssignmentLinks, setSelectedAssignmentLinks] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [dndSaving, setDndSaving] = useState(false);
  const [dndMessage, setDndMessage] = useState<string | null>(null);
  const [dndError, setDndError] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch nodes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.listNodes(), api.listAllNodeLinks()])
      .then(([data, links]) => {
        if (!cancelled) setNodes(data.filter((node) => node.type !== "rubric"));
        if (!cancelled) setNodeLinks(links);
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
  }, []);

  // Filter logic
  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (debouncedSearch && !n.title.toLowerCase().includes(debouncedSearch.toLowerCase())) {
        return false;
      }
      if (typeFilter !== "all" && n.type !== typeFilter) return false;
      if (severityFilter !== "all") {
        if (severityFilter === "unaudited" && n.status !== "unaudited") return false;
        if (severityFilter !== "unaudited" && n.status !== severityFilter) return false;
      }
      if (weekFilter !== "all") {
        if (weekFilter === "none" && n.week !== null) return false;
        if (weekFilter !== "none" && n.week !== Number(weekFilter)) return false;
      }
      return true;
    });
  }, [nodes, debouncedSearch, typeFilter, severityFilter, weekFilter]);

  // Group by week
  const grouped = useMemo(() => {
    const bucketKey = (week: number | null, module: string | null) => `${week ?? "none"}::${module ?? ""}`;
    const map = new Map<string, GroupedNodes>();
    const primaryById = new Map(filtered.map((node) => [node.id, node]));
    const sourceById = new Map(
      nodes
        .filter((node) => node.type === "assignment" || node.type === "page")
        .map((node) => [node.id, node]),
    );

    // Determine whether an unassigned node has exactly one source module context.
    // If so, render it directly in that module/week bucket (not as a linked copy).
    const sourceContextsByTargetId = new Map<string, Set<string>>();
    const sourceContextMeta = new Map<string, { week: number | null; module: string | null; sourceTitle: string | null }>();
    for (const link of nodeLinks) {
      if (!(link.link_type === "file" || link.link_type === "assignment")) {
        continue;
      }
      const target = primaryById.get(link.target_id);
      const sourceNode = sourceById.get(link.source_id);
      if (!target || !sourceNode) {
        continue;
      }

      const contextKey = bucketKey(sourceNode.week, sourceNode.module);
      if (!sourceContextsByTargetId.has(target.id)) {
        sourceContextsByTargetId.set(target.id, new Set<string>());
      }
      sourceContextsByTargetId.get(target.id)!.add(contextKey);
      if (!sourceContextMeta.has(`${target.id}::${contextKey}`)) {
        sourceContextMeta.set(`${target.id}::${contextKey}`, {
          week: sourceNode.week,
          module: sourceNode.module,
          sourceTitle: sourceNode.title,
        });
      }
    }

    const adoptedPlacementByNodeId = new Map<string, { week: number | null; module: string | null; sourceTitle: string | null }>();
    for (const node of filtered) {
      const hasNativePlacement = node.week !== null || Boolean(node.module);
      if (hasNativePlacement) {
        continue;
      }

      const contexts = sourceContextsByTargetId.get(node.id);
      if (!contexts || contexts.size !== 1) {
        continue;
      }

      const onlyContext = [...contexts][0];
      const contextMeta = sourceContextMeta.get(`${node.id}::${onlyContext}`);
      if (!contextMeta) {
        continue;
      }

      const hasMeaningfulContext = contextMeta.week !== null || Boolean(contextMeta.module);
      if (!hasMeaningfulContext) {
        continue;
      }

      adoptedPlacementByNodeId.set(node.id, contextMeta);
    }

    for (const n of filtered) {
      const adopted = adoptedPlacementByNodeId.get(n.id);
      const effectiveWeek = adopted?.week ?? n.week;
      const effectiveModule = adopted?.module ?? n.module;
      const key = bucketKey(effectiveWeek, effectiveModule);
      if (!map.has(key)) {
        map.set(key, {
          key,
          week: effectiveWeek,
          module: effectiveModule,
          items: [],
        });
      }
      map.get(key)!.items.push({
        key: `primary-${n.id}`,
        node: n,
        moduleLabel: effectiveModule,
        isLinkedReference: false,
        linkedViaSource: null,
      });
    }

    const seenReferenceKeys = new Set<string>();
    for (const link of nodeLinks) {
      if (!(link.link_type === "file" || link.link_type === "assignment")) {
        continue;
      }

      const target = primaryById.get(link.target_id);
      const sourceNode = sourceById.get(link.source_id);
      if (!target || !sourceNode) {
        continue;
      }

      if (adoptedPlacementByNodeId.has(target.id)) {
        // Already moved into an inferred primary bucket; avoid duplicate linked copy.
        continue;
      }

      const sourceWeek = sourceNode.week;
      const sourceModule = sourceNode.module;
      if (sourceWeek === target.week && sourceModule === target.module) {
        continue;
      }

      const dedupeKey = `${target.id}::${sourceNode.id}`;
      if (seenReferenceKeys.has(dedupeKey)) {
        continue;
      }
      seenReferenceKeys.add(dedupeKey);

      const groupKey = bucketKey(sourceWeek, sourceModule ?? target.module);
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          key: groupKey,
          week: sourceWeek,
          module: sourceModule ?? target.module,
          items: [],
        });
      }
      map.get(groupKey)!.items.push({
          key: `linked-${target.id}-${sourceNode.id}`,
        node: target,
        moduleLabel: sourceModule ?? target.module,
        isLinkedReference: true,
          linkedViaSource: sourceNode.title,
      });
    }

    // Sort groups by week first, then module label
    const entries = Array.from(map.values()).sort((a, b) => {
      if (a.week === null && b.week === null) {
        return (a.module ?? "").localeCompare(b.module ?? "");
      }
      if (a.week === null) return 1;
      if (b.week === null) return -1;
      if (a.week !== b.week) return a.week - b.week;
      return (a.module ?? "").localeCompare(b.module ?? "");
    });

    for (const group of entries) {
      group.items.sort((a, b) => {
        const typeOrderDiff = TYPE_PRIORITY[a.node.type] - TYPE_PRIORITY[b.node.type];
        if (typeOrderDiff !== 0) return typeOrderDiff;
        if (a.isLinkedReference !== b.isLinkedReference) {
          return a.isLinkedReference ? 1 : -1;
        }
        return a.node.title.localeCompare(b.node.title);
      });
    }

    return entries;
  }, [filtered, nodeLinks, nodes]);

  // Active filters for pill display
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (debouncedSearch) {
    activeFilters.push({
      key: "search",
      label: `Search: "${debouncedSearch}"`,
      clear: () => setSearch(""),
    });
  }
  if (typeFilter !== "all") {
    activeFilters.push({
      key: "type",
      label: TYPE_OPTIONS.find((o) => o.value === typeFilter)?.label ?? typeFilter,
      clear: () => setTypeFilter("all"),
    });
  }
  if (severityFilter !== "all") {
    activeFilters.push({
      key: "severity",
      label: SEVERITY_OPTIONS.find((o) => o.value === severityFilter)?.label ?? severityFilter,
      clear: () => setSeverityFilter("all"),
    });
  }
  if (weekFilter !== "all") {
    activeFilters.push({
      key: "week",
      label: WEEK_OPTIONS.find((o) => o.value === weekFilter)?.label ?? weekFilter,
      clear: () => setWeekFilter("all"),
    });
  }

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setTypeFilter("all");
    setSeverityFilter("all");
    setWeekFilter("all");
  }, []);

  const assignmentOptions = useMemo(() => {
    return nodes
      .filter((node) => node.type === "assignment")
      .map((node) => ({
        value: node.id,
        label: node.title,
        meta: node.week ? `Week ${node.week}${node.module ? ` • ${node.module}` : ""}` : (node.module ?? "No week"),
      }));
  }, [nodes]);

  const nodeById = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const handleDragStart = useCallback((node: CourseNodeSummary) => {
    setDraggingNodeId(node.id);
    setDragTargetId(null);
    setDndMessage(null);
    setDndError(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingNodeId(null);
    setDragTargetId(null);
  }, []);

  const handleDragTargetEnter = useCallback(
    (targetNode: CourseNodeSummary) => {
      if (!draggingNodeId) {
        setDragTargetId(null);
        return;
      }
      const sourceNode = nodeById.get(draggingNodeId);
      if (!sourceNode || !canCreateFileLink(sourceNode, targetNode)) {
        setDragTargetId(null);
        return;
      }
      setDragTargetId(targetNode.id);
    },
    [draggingNodeId, nodeById],
  );

  const handleDropLink = useCallback(
    async (targetNode: CourseNodeSummary) => {
      if (!draggingNodeId) return;
      const sourceNode = nodeById.get(draggingNodeId);
      if (!sourceNode || !canCreateFileLink(sourceNode, targetNode)) {
        return;
      }

      const fileNode = sourceNode.type === "file" ? sourceNode : targetNode;
      const nonFileNode = sourceNode.type === "file" ? targetNode : sourceNode;
      const alreadyLinked = nodeLinks.some(
        (link) =>
          link.link_type === "file"
          && link.source_id === nonFileNode.id
          && link.target_id === fileNode.id,
      );

      if (alreadyLinked) {
        setDndMessage(`Already linked: ${nonFileNode.title} -> ${fileNode.title}`);
        return;
      }

      setDndSaving(true);
      setDndError(null);
      setDndMessage(null);
      try {
        await api.createNodeLink(nonFileNode.id, fileNode.id, "file");
        setNodeLinks((prev) => [
          ...prev,
          {
            source_id: nonFileNode.id,
            target_id: fileNode.id,
            link_type: "file",
          },
        ]);
        setDndMessage(`Linked ${fileNode.title} to ${nonFileNode.title}`);
      } catch (err) {
        setDndError(err instanceof Error ? err.message : "Failed to create link");
      } finally {
        setDndSaving(false);
        setDraggingNodeId(null);
        setDragTargetId(null);
      }
    },
    [draggingNodeId, nodeById, nodeLinks],
  );

  const openAssignDialog = useCallback(
    async (node: CourseNodeSummary) => {
      setSelectedUnassigned(node);
      setAssignWeek(node.week ? String(node.week) : "");
      setAssignModule(node.module ?? "");
      setAssignError(null);
      setAssignSuccess(null);
      setAssignDialogOpen(true);

      try {
        const links = await api.getNodeLinks(node.id);
        const existing = links
          .filter(
            (link) =>
              link.target_id === node.id
              && (link.link_type === "file" || link.link_type === "assignment"),
          )
          .map((link) => link.source_id)
          .filter((sourceId) => sourceId !== node.id);
        setSelectedAssignmentLinks(existing);
      } catch {
        setSelectedAssignmentLinks([]);
      }
    },
    [],
  );

  const handleSaveAssignment = useCallback(async () => {
    if (!selectedUnassigned) return;

    setAssignSaving(true);
    setAssignError(null);
    setAssignSuccess(null);

    try {
      const parsedWeek = assignWeek.trim() ? Number(assignWeek) : null;
      if (parsedWeek !== null && (!Number.isInteger(parsedWeek) || parsedWeek < 1)) {
        throw new Error("Week must be a whole number greater than zero.");
      }

      const primaryAssignment = nodes.find((n) => n.id === selectedAssignmentLinks[0]);
      const effectiveWeek = parsedWeek ?? primaryAssignment?.week ?? null;
      const effectiveModule = assignModule.trim() || primaryAssignment?.module || null;

      if (effectiveWeek === null && !effectiveModule && selectedAssignmentLinks.length === 0) {
        throw new Error("Select at least one linked assignment or set week/module.");
      }

      await api.updateNode(selectedUnassigned.id, {
        week: effectiveWeek,
        module: effectiveModule,
      });

      if (selectedAssignmentLinks.length > 0) {
        const linkType = selectedUnassigned.type === "file" ? "file" : "assignment";
        await Promise.all(
          selectedAssignmentLinks.map((assignmentId) =>
            api.createNodeLink(assignmentId, selectedUnassigned.id, linkType),
          ),
        );
      }

      const refreshed = await api.listNodes();
      setNodes(refreshed);
      setAssignSuccess(
        selectedAssignmentLinks.length > 1
          ? `Saved. Linked to ${selectedAssignmentLinks.length} assignments.`
          : "Saved assignment updates.",
      );

      window.setTimeout(() => {
        setAssignDialogOpen(false);
      }, 700);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to save assignment updates");
    } finally {
      setAssignSaving(false);
    }
  }, [selectedUnassigned, assignWeek, assignModule, nodes, selectedAssignmentLinks]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {loading ? "..." : `${filtered.length} item${filtered.length !== 1 ? "s" : ""}`}
        </Badge>
      </div>

      {/* Filter bar */}
      <div className="sticky top-0 z-20 -mx-8 border-b border-white/12 bg-background/75 px-8 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-50 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search assignments..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 glass-input"
            />
          </div>

          {/* Type filter */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
            <SelectTrigger className="glass-input min-w-32.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Severity filter */}
          <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v ?? "all")}>
            <SelectTrigger className="glass-input min-w-35">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Week filter */}
          <Select value={weekFilter} onValueChange={(v) => setWeekFilter(v ?? "all")}>
            <SelectTrigger className="glass-input min-w-30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active filter pills */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={f.clear}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/20 transition-colors"
              >
                {f.label}
                <X className="size-3" />
              </button>
            ))}
            {activeFilters.length > 1 && (
              <button
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="rounded-xl border border-white/12 bg-secondary/20 px-3 py-2.5 space-y-1">
        <p className="text-xs text-muted-foreground/80">
          Drag a file card onto an assignment/page card (or drag assignment/page onto a file) to create a link.
        </p>
        {dndSaving && <p className="text-xs text-primary">Creating link...</p>}
        {dndMessage && <p className="text-xs text-emerald-300">{dndMessage}</p>}
        {dndError && <p className="text-xs text-destructive">{dndError}</p>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-primary/60" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-white/3 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={activeFilters.length > 0} onClear={clearAllFilters} />
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <WeekGroup
              key={group.key}
              week={group.week}
              module={group.module}
              items={group.items}
              router={router}
              onAssign={openAssignDialog}
              draggingNodeId={draggingNodeId}
              dragTargetId={dragTargetId}
              onCardDragStart={handleDragStart}
              onCardDragEnd={handleDragEnd}
              onCardDragEnter={handleDragTargetEnter}
              onCardDrop={handleDropLink}
              runningAssignmentIds={auditState.running_assignment_ids}
            />
          ))}
        </div>
      )}

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-xl border border-white/16 bg-[oklch(0.18_0.02_272/0.96)]">
          <DialogHeader>
            <DialogTitle>Assign Unclassified Item</DialogTitle>
            <DialogDescription>
              Set week/module and optionally link this file to one or more assignments.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-white/14 bg-secondary/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Selected item</p>
              <p className="text-sm text-foreground mt-0.5 truncate">{selectedUnassigned?.title}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={assignWeek}
                onChange={(event) => setAssignWeek(event.target.value)}
                placeholder="Week (e.g. 8)"
                className="glass-input"
              />
              <Input
                value={assignModule}
                onChange={(event) => setAssignModule(event.target.value)}
                placeholder="Module name"
                className="glass-input"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Linked assignments (multi-select)
              </p>
              <SearchableMultiSelect
                options={assignmentOptions.filter((option) => option.value !== selectedUnassigned?.id)}
                value={selectedAssignmentLinks}
                onValueChange={setSelectedAssignmentLinks}
                placeholder="Search and select assignments..."
                emptyLabel="No assignment matches your search"
              />
              <p className="text-[11px] text-muted-foreground">
                You can select multiple assignments. Existing links are preserved.
              </p>
            </div>

            {assignError && <p className="text-xs text-destructive">{assignError}</p>}
            {assignSuccess && <p className="text-xs text-emerald-300">{assignSuccess}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAssignment} disabled={assignSaving}>
              {assignSaving ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Link2 className="mr-1.5 size-4" />
                  Save Assignment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="rounded-full border border-white/8 bg-white/3 p-4">
        <PackageOpen className="size-8 text-muted-foreground/60" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-foreground/80">
          {hasFilters ? "No assignments match your filters" : "No assignments found"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasFilters
            ? "Try adjusting your search or filter criteria."
            : "Run an ingestion to populate assignments from Canvas."}
        </p>
      </div>
      {hasFilters && (
        <button
          onClick={onClear}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

function WeekGroup({
  week,
  module,
  items,
  router,
  onAssign,
  draggingNodeId,
  dragTargetId,
  onCardDragStart,
  onCardDragEnd,
  onCardDragEnter,
  onCardDrop,
  runningAssignmentIds,
}: {
  week: number | null;
  module: string | null;
  items: DisplayNode[];
  router: ReturnType<typeof useRouter>;
  onAssign?: (node: CourseNodeSummary) => void;
  draggingNodeId: string | null;
  dragTargetId: string | null;
  onCardDragStart: (node: CourseNodeSummary) => void;
  onCardDragEnd: () => void;
  onCardDragEnter: (node: CourseNodeSummary) => void;
  onCardDrop: (node: CourseNodeSummary) => void;
  runningAssignmentIds: string[];
}) {
  return (
    <div className="space-y-3">
      {/* Week header */}
      <div className="flex items-center gap-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
          {module ?? (week !== null ? `Week ${week}` : "Unassigned")}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px bg-white/12" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((item) => (
          <AssignmentCard
            key={item.key}
            node={item.node}
            moduleLabel={item.moduleLabel}
            isLinkedReference={item.isLinkedReference}
            linkedViaSource={item.linkedViaSource}
            onClick={() => router.push(`/assignments/${item.node.id}`)}
            onAssign={!item.isLinkedReference && week === null ? onAssign : undefined}
            isDragSource={!item.isLinkedReference && isLinkableNodeType(item.node.type)}
            isDragActive={draggingNodeId === item.node.id}
              isDropTarget={
                !item.isLinkedReference
                && dragTargetId === item.node.id
                && draggingNodeId !== item.node.id
              }
            onDragStart={() => onCardDragStart(item.node)}
            onDragEnd={onCardDragEnd}
              onDragEnter={!item.isLinkedReference ? () => onCardDragEnter(item.node) : undefined}
              onDropLink={!item.isLinkedReference ? () => onCardDrop(item.node) : undefined}
            isAuditing={runningAssignmentIds.includes(item.node.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AIBadge() {
  return (
    <span
      className="absolute top-2 right-2 z-10 inline-flex items-center gap-0.5 rounded-full border border-purple-400/40 bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-purple-300 tracking-wide pointer-events-none"
      style={{ animation: "shimmer-badge 2s ease-in-out infinite alternate" }}
    >
      AI ✦
    </span>
  );
}

function AssignmentCard({
  node,
  moduleLabel,
  isLinkedReference,
  linkedViaSource,
  onClick,
  onAssign,
  isDragSource,
  isDragActive,
  isDropTarget,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDropLink,
  isAuditing,
}: {
  node: CourseNodeSummary;
  moduleLabel: string | null;
  isLinkedReference: boolean;
  linkedViaSource: string | null;
  onClick: () => void;
  onAssign?: (node: CourseNodeSummary) => void;
  isDragSource: boolean;
  isDragActive: boolean;
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnter?: () => void;
  onDropLink?: () => void;
  isAuditing?: boolean;
}) {
  const cardInner = (
    <div
      role="button"
      tabIndex={0}
      draggable={isDragSource}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onDragStart={(event) => {
        if (!isDragSource) return;
        event.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragEnter={(event) => {
          if (!onDragEnter) return;
        event.preventDefault();
        onDragEnter();
      }}
      onDragOver={(event) => {
          if (!onDropLink) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
          if (!onDropLink) return;
        event.preventDefault();
        onDropLink();
      }}
      className={`group cursor-pointer rounded-xl border p-4 text-left backdrop-blur-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
        isLinkedReference
          ? "border-white/16 bg-secondary/18 opacity-80 hover:border-white/28 hover:bg-secondary/24"
          : isAuditing
            ? "border-transparent bg-secondary/28 hover:bg-secondary/38"
            : "border-secondary/55 bg-secondary/28 hover:-translate-y-px hover:border-secondary/75 hover:bg-secondary/38"
      } ${isDragSource ? "cursor-grab active:cursor-grabbing" : ""} ${isDragActive ? "ring-2 ring-primary/50" : ""} ${isDropTarget ? "ring-2 ring-emerald-400/70 border-emerald-300/60 bg-emerald-500/10" : ""}`}
    >
      {isAuditing && <AIBadge />}
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className={`mt-0.5 rounded-lg border p-2 text-muted-foreground transition-colors group-hover:text-foreground/80 ${
          isLinkedReference
            ? "bg-secondary/34 border-white/16"
            : "bg-secondary/50 border-secondary/60"
        }`}>
          {typeIcon(node.type)}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Title */}
          <p className="text-sm font-medium leading-snug truncate text-foreground/90 group-hover:text-foreground transition-colors">
            {node.title}
          </p>

          {/* Module */}
          {moduleLabel && (
            <p className="text-xs text-muted-foreground truncate">{moduleLabel}</p>
          )}

          {isLinkedReference && linkedViaSource && (
            <p className="text-[11px] text-muted-foreground/80 truncate">
              Linked reference via {linkedViaSource}
            </p>
          )}

          {/* Bottom row: badges */}
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            {/* Status badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                node.status === "unaudited"
                  ? "bg-muted/45 text-muted-foreground border-muted/40"
                  : severityClass(node.status)
              }`}
            >
              {severityLabel(node.status)}
            </span>

            {/* Finding count */}
            {node.finding_count > 0 && (
              <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                {node.finding_count} finding{node.finding_count !== 1 ? "s" : ""}
              </span>
            )}

            {/* Type label */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${typePillClass(node.type)}`}
            >
              {typeLabel(node.type)}
            </span>

            {isLinkedReference && (
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">
                linked copy
              </span>
            )}

            {node.rubric_id && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                Has Rubric
              </span>
            )}

            {onAssign && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAssign(node);
                }}
                className="ml-auto inline-flex items-center rounded-md border border-primary/35 bg-primary/14 px-2 py-1 text-[10px] text-primary hover:bg-primary/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              >
                Assign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return isAuditing ? (
    <div className="animate-rainbow-border rounded-xl p-[2px] relative">
      {cardInner}
    </div>
  ) : cardInner;
}
