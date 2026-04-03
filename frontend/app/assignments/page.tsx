"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CourseNodeSummary, NodeType, NodeStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
  { value: "rubric", label: "Rubric" },
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

export default function AssignmentsPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch nodes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listNodes()
      .then((data) => {
        if (!cancelled) setNodes(data);
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
    const map = new Map<number | null, CourseNodeSummary[]>();
    for (const n of filtered) {
      const key = n.week;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    // Sort: numbered weeks ascending, null at end
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === null && b[0] === null) return 0;
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0] - b[0];
    });
    return entries;
  }, [filtered]);

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
      <div className="sticky top-0 z-20 -mx-8 px-8 py-3 bg-background/60 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search assignments..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white/[0.03] border-white/[0.08]"
            />
          </div>

          {/* Type filter */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
            <SelectTrigger className="bg-white/[0.03] border-white/[0.08] min-w-[130px]">
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
            <SelectTrigger className="bg-white/[0.03] border-white/[0.08] min-w-[140px]">
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
            <SelectTrigger className="bg-white/[0.03] border-white/[0.08] min-w-[120px]">
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
        <div className="rounded-xl bg-white/[0.03] border border-destructive/20 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={activeFilters.length > 0} onClear={clearAllFilters} />
      ) : (
        <div className="space-y-8">
          {grouped.map(([week, items]) => (
            <WeekGroup key={week ?? "none"} week={week} items={items} router={router} />
          ))}
        </div>
      )}
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
      <div className="rounded-full bg-white/[0.03] border border-white/[0.08] p-4">
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
}: {
  week: number | null;
  items: CourseNodeSummary[];
  router: ReturnType<typeof useRouter>;
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
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((node) => (
          <AssignmentCard
            key={node.id}
            node={node}
            onClick={() => router.push(`/assignments/${node.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

function AssignmentCard({
  node,
  onClick,
}: {
  node: CourseNodeSummary;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-4 hover:bg-white/[0.05] hover:border-white/[0.12] hover:translate-y-[-1px] transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className="mt-0.5 rounded-lg bg-white/[0.05] border border-white/[0.08] p-2 text-muted-foreground group-hover:text-foreground/80 transition-colors">
          {typeIcon(node.type)}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Title */}
          <p className="text-sm font-medium leading-snug truncate text-foreground/90 group-hover:text-foreground transition-colors">
            {node.title}
          </p>

          {/* Module */}
          {node.module && (
            <p className="text-xs text-muted-foreground truncate">{node.module}</p>
          )}

          {/* Bottom row: badges */}
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            {/* Status badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                node.status === "unaudited"
                  ? "bg-white/[0.04] text-muted-foreground border-white/[0.08]"
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
          </div>
        </div>
      </div>
    </button>
  );
}
