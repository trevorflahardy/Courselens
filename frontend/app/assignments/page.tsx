"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CourseNodeSummary, NodeLink, NodeType, NodeStatus } from "@/lib/types";
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
  linkedViaAssignment: string | null;
}

export default function AssignmentsPage() {
  const router = useRouter();
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
    const map = new Map<number | null, DisplayNode[]>();
    const primaryById = new Map(filtered.map((node) => [node.id, node]));
    const assignmentById = new Map(
      nodes.filter((node) => node.type === "assignment").map((node) => [node.id, node]),
    );

    for (const n of filtered) {
      const key = n.week;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({
        key: `primary-${n.id}`,
        node: n,
        moduleLabel: n.module,
        isLinkedReference: false,
        linkedViaAssignment: null,
      });
    }

    const seenReferenceKeys = new Set<string>();
    for (const link of nodeLinks) {
      if (!(link.link_type === "file" || link.link_type === "assignment")) {
        continue;
      }

      const target = primaryById.get(link.target_id);
      const sourceAssignment = assignmentById.get(link.source_id);
      if (!target || !sourceAssignment) {
        continue;
      }

      const sourceWeek = sourceAssignment.week;
      const sourceModule = sourceAssignment.module;
      if (sourceWeek === target.week && sourceModule === target.module) {
        continue;
      }

      const dedupeKey = `${target.id}::${sourceAssignment.id}`;
      if (seenReferenceKeys.has(dedupeKey)) {
        continue;
      }
      seenReferenceKeys.add(dedupeKey);

      if (!map.has(sourceWeek)) map.set(sourceWeek, []);
      map.get(sourceWeek)!.push({
        key: `linked-${target.id}-${sourceAssignment.id}`,
        node: target,
        moduleLabel: sourceModule ?? target.module,
        isLinkedReference: true,
        linkedViaAssignment: sourceAssignment.title,
      });
    }

    // Sort: numbered weeks ascending, null at end
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === null && b[0] === null) return 0;
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0] - b[0];
    });

    for (const [, items] of entries) {
      items.sort((a, b) => {
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
          {grouped.map(([week, items]) => (
            <WeekGroup
              key={week ?? "none"}
              week={week}
              items={items}
              router={router}
              onAssign={openAssignDialog}
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
  items,
  router,
  onAssign,
}: {
  week: number | null;
  items: DisplayNode[];
  router: ReturnType<typeof useRouter>;
  onAssign?: (node: CourseNodeSummary) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Week header */}
      <div className="flex items-center gap-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
          {week !== null ? `Week ${week}` : "Unassigned"}
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
            linkedViaAssignment={item.linkedViaAssignment}
            onClick={() => router.push(`/assignments/${item.node.id}`)}
            onAssign={!item.isLinkedReference && week === null ? onAssign : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function AssignmentCard({
  node,
  moduleLabel,
  isLinkedReference,
  linkedViaAssignment,
  onClick,
  onAssign,
}: {
  node: CourseNodeSummary;
  moduleLabel: string | null;
  isLinkedReference: boolean;
  linkedViaAssignment: string | null;
  onClick: () => void;
  onAssign?: (node: CourseNodeSummary) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`group cursor-pointer rounded-xl border p-4 text-left backdrop-blur-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
        isLinkedReference
          ? "border-white/16 bg-secondary/18 opacity-80 hover:border-white/28 hover:bg-secondary/24"
          : "border-secondary/55 bg-secondary/28 hover:-translate-y-px hover:border-secondary/75 hover:bg-secondary/38"
      }`}
    >
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

          {isLinkedReference && linkedViaAssignment && (
            <p className="text-[11px] text-muted-foreground/80 truncate">
              Linked reference via {linkedViaAssignment}
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
            <span className="text-[10px] text-muted-foreground/60 capitalize">
              {node.type}
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
}
