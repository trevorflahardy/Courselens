"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ForceGraph, NODE_COLORS } from "@/components/graph/ForceGraph";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { CourseNode, CourseNodeSummary, GraphEdge, NodeType } from "@/lib/types";

type FilterMode = "all" | "connected" | "gaps" | "orphans" | "inferred";

const FILTER_OPTIONS: { value: FilterMode; label: string; description: string }[] = [
  { value: "all", label: "All Nodes", description: "Show everything" },
  { value: "connected", label: "Connected", description: "Hide disconnected nodes" },
  { value: "gaps", label: "Gaps Only", description: "Must-fix issues" },
  { value: "orphans", label: "Orphans", description: "Disconnected nodes" },
  { value: "inferred", label: "Inferred Edges", description: "AI-derived links" },
];

const NODE_TYPE_OPTIONS: { value: NodeType; label: string }[] = [
  { value: "assignment", label: "Assignments" },
  { value: "page", label: "Pages" },
  { value: "rubric", label: "Rubrics" },
  { value: "lecture", label: "Lectures" },
  { value: "announcement", label: "Announcements" },
  { value: "file", label: "Files" },
];

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*\S+/gi, "");
}

function isPdfPath(value: string | null | undefined): boolean {
  return Boolean(value && /\.pdf($|\?)/i.test(value));
}

function isImagePath(value: string | null | undefined): boolean {
  return Boolean(value && /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)($|\?)/i.test(value));
}

export default function GraphPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hideImageFiles, setHideImageFiles] = useState(true);
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<NodeType[]>([]);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CourseNodeSummary | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<CourseNode | null>(null);
  const [selectedNodeDetailLoading, setSelectedNodeDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nodeTypeMenuRef = useRef<HTMLDivElement>(null);

  // Fetch graph data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const graph = await api.getGraph();
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load graph");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Update selected node detail when selection changes
  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      setSelectedNode(node ?? null);
    } else {
      setSelectedNode(null);
    }
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNodeDetail(null);
      setSelectedNodeDetailLoading(false);
      return;
    }

    let cancelled = false;
    setSelectedNodeDetailLoading(true);

    api
      .getNode(selectedNodeId)
      .then((node) => {
        if (!cancelled) {
          setSelectedNodeDetail(node);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedNodeDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedNodeDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const toggleNodeType = useCallback((type: NodeType) => {
    setHiddenNodeTypes((prev) => {
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  }, []);

  useEffect(() => {
    if (!typeMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!nodeTypeMenuRef.current?.contains(target)) {
        setTypeMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTypeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [typeMenuOpen]);

  const visibleNodeTypeCount = NODE_TYPE_OPTIONS.length - hiddenNodeTypes.length;

  // Stats
  const totalNodes = nodes.length;
  const totalEdges = edges.length;
  const gapCount = nodes.filter((n) => n.status === "gap").length;
  const orphanCount = nodes.filter((n) => n.status === "orphan").length;
  const assignmentCount = nodes.filter((n) => n.type === "assignment").length;
  const fileCount = nodes.filter((n) => n.type === "file").length;
  const lectureCount = nodes.filter((n) => n.type === "lecture").length;

  const connectedNodes = useMemo(() => {
    if (!selectedNodeId) return [];

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const connected = new Map<string, { node: CourseNodeSummary; edgeLabel: string }>();

    for (const edge of edges) {
      if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) {
        continue;
      }

      const connectedId = edge.source === selectedNodeId ? edge.target : edge.source;
      const connectedNode = nodeById.get(connectedId);
      if (!connectedNode || connected.has(connectedId)) {
        continue;
      }

      const direction = edge.source === selectedNodeId ? "outgoing" : "incoming";
      connected.set(connectedId, {
        node: connectedNode,
        edgeLabel: edge.label ?? `${edge.edge_type} • ${direction}`,
      });
    }

    return Array.from(connected.values()).sort((a, b) => a.node.title.localeCompare(b.node.title));
  }, [selectedNodeId, nodes, edges]);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] -mx-8 -my-6">
      {/* Header bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Dependency Graph</h1>
            <p className="text-[12px] text-muted-foreground/70 mt-0.5">
              Interactive course structure visualization
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <Badge variant="outline" className="text-[10px] font-mono">
              {totalNodes} nodes
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">
              {totalEdges} edges
            </Badge>
            {gapCount > 0 && (
              <Badge variant="outline" className="severity-gap text-[10px]">
                {gapCount} gaps
              </Badge>
            )}
            {orphanCount > 0 && (
              <Badge variant="outline" className="severity-warn text-[10px]">
                {orphanCount} orphans
              </Badge>
            )}
            {assignmentCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {assignmentCount} assignments
              </Badge>
            )}
            {fileCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {fileCount} files
              </Badge>
            )}
            {lectureCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {lectureCount} lectures
              </Badge>
            )}
          </div>
        </div>

        {/* Filter toggles */}
        <div className="flex items-center gap-2">
          <div className="relative" ref={nodeTypeMenuRef}>
            <button
              type="button"
              onClick={() => setTypeMenuOpen((open) => !open)}
              aria-expanded={typeMenuOpen}
              aria-haspopup="menu"
              className={`
                px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 border
                ${
                  typeMenuOpen || hiddenNodeTypes.length > 0 || hideImageFiles
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "bg-white/3 text-muted-foreground border-white/10 hover:text-foreground"
                }
              `}
              title="Show or hide node types"
            >
              Node Types {visibleNodeTypeCount}/{NODE_TYPE_OPTIONS.length}
            </button>

            {typeMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-64 rounded-xl border border-white/8 bg-black/75 backdrop-blur-xl p-3 shadow-2xl z-30"
              >
                <div className="mb-2.5 pb-2.5 border-b border-white/8">
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                    Image Files
                  </p>
                  <button
                    type="button"
                    onClick={() => setHideImageFiles((prev) => !prev)}
                    className={`
                      w-full flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors
                      ${
                        hideImageFiles
                          ? "border-primary/30 bg-primary/10 text-foreground"
                          : "border-white/8 bg-white/2 text-muted-foreground/55"
                      }
                    `}
                    title="Hide image file nodes (png, jpg, gif, svg, webp, etc.)"
                  >
                    <span className="text-[11px]">Image nodes</span>
                    <span className="text-[10px] font-medium">
                      {hideImageFiles ? "Hidden" : "Visible"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                    Node Visibility
                  </p>
                  <button
                    type="button"
                    onClick={() => setHiddenNodeTypes([])}
                    className="text-[10px] text-primary hover:underline disabled:text-muted-foreground/50 disabled:no-underline"
                    disabled={hiddenNodeTypes.length === 0}
                  >
                    Show all
                  </button>
                </div>

                <div className="space-y-1.5">
                  {NODE_TYPE_OPTIONS.map((option) => {
                    const hidden = hiddenNodeTypes.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        role="menuitemcheckbox"
                        aria-checked={!hidden}
                        type="button"
                        onClick={() => toggleNodeType(option.value)}
                        className={`
                          w-full flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors
                          ${
                            hidden
                              ? "border-white/8 bg-white/2 text-muted-foreground/55"
                              : "border-primary/30 bg-primary/10 text-foreground"
                          }
                        `}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: NODE_COLORS[option.value] }}
                          />
                          <span className="text-[11px]">{option.label}</span>
                        </span>
                        <span className="text-[10px] font-medium">
                          {hidden ? "Hidden" : "Visible"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 bg-white/3 rounded-lg p-1 border border-white/6">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`
                px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150
                ${
                  filter === opt.value
                    ? "bg-primary/20 text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                }
              `}
              title={opt.description}
            >
              {opt.label}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              <p className="text-sm text-muted-foreground/70">Loading graph...</p>
            </div>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <svg
                className="h-12 w-12 text-muted-foreground/30 mx-auto"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
                />
              </svg>
              <p className="text-sm text-muted-foreground/50">No graph data yet</p>
              <p className="text-xs text-muted-foreground/30">
                Ingest course data to see the dependency graph
              </p>
            </div>
          </div>
        ) : (
          <ForceGraph
            nodes={nodes}
            edges={edges}
            filter={filter}
            hideImageFiles={hideImageFiles}
            hiddenNodeTypes={hiddenNodeTypes}
            onNodeClick={handleNodeClick}
            selectedNodeId={selectedNodeId}
          />
        )}

        {/* Node detail panel (slides in from right) */}
        {selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-black/60 backdrop-blur-xl border-l border-white/[0.08] p-5 overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold truncate pr-2">{selectedNode.title}</h3>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="p-1 rounded hover:bg-white/[0.08] transition-colors text-muted-foreground"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px] capitalize">
                  {selectedNode.type}
                </Badge>
                {selectedNode.week && (
                  <Badge variant="outline" className="text-[10px]">
                    Week {selectedNode.week}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] severity-${selectedNode.status}`}
                >
                  {selectedNode.status}
                </Badge>
              </div>

              {selectedNode.module && (
                <div>
                  <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                    Module
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedNode.module}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                  Findings
                </p>
                <p className="text-lg font-bold mt-0.5">
                  {selectedNode.finding_count}
                </p>
              </div>

              <div className="pt-2 border-t border-white/[0.06]">
                <button
                  onClick={() => router.push(`/assignments/${selectedNode.id}`)}
                  className="w-full rounded-lg px-3 py-2 text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                >
                  View Node Details
                </button>

                {selectedNodeDetailLoading && (
                  <p className="mt-2 text-[11px] text-muted-foreground/50">Loading description...</p>
                )}

                {!selectedNodeDetailLoading && selectedNodeDetail?.description && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                    <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      Description
                    </p>
                    <div
                      className="mt-1 text-xs text-muted-foreground max-h-44 overflow-y-auto space-y-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-primary [&_a]:underline"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(selectedNodeDetail.description),
                      }}
                    />
                  </div>
                )}

                {!selectedNodeDetailLoading && selectedNodeDetail?.type === "file" && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                    <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      File Preview
                    </p>

                    {selectedNodeDetail.canvas_url && isPdfPath(selectedNodeDetail.canvas_url) && (
                      <iframe
                        src={selectedNodeDetail.canvas_url}
                        title={`${selectedNodeDetail.title} PDF preview`}
                        className="w-full h-56 rounded-md border border-white/[0.08] bg-black/30"
                      />
                    )}

                    {selectedNodeDetail.canvas_url && isImagePath(selectedNodeDetail.canvas_url) && (
                      <img
                        src={selectedNodeDetail.canvas_url}
                        alt={selectedNodeDetail.title}
                        className="w-full max-h-64 object-contain rounded-md border border-white/[0.08] bg-black/30"
                        loading="lazy"
                      />
                    )}

                    {selectedNodeDetail.file_content && (
                      <pre className="max-h-44 overflow-y-auto rounded-md border border-white/[0.08] bg-black/30 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                        {selectedNodeDetail.file_content}
                      </pre>
                    )}

                    {!selectedNodeDetail.file_content
                      && selectedNodeDetail.canvas_url
                      && !isPdfPath(selectedNodeDetail.canvas_url)
                      && !isImagePath(selectedNodeDetail.canvas_url) && (
                        <a
                          href={selectedNodeDetail.canvas_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-xs text-primary hover:underline"
                        >
                          Open file
                        </a>
                    )}

                    {!selectedNodeDetail.file_content && !selectedNodeDetail.canvas_url && (
                      <p className="text-[11px] text-muted-foreground/50">No file preview available.</p>
                    )}
                  </div>
                )}

                {connectedNodes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                    <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      Connected To
                    </p>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {connectedNodes.map((connected) => (
                        <button
                          key={connected.node.id}
                          onClick={() => setSelectedNodeId(connected.node.id)}
                          className="w-full text-left rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 hover:bg-white/[0.05] transition-colors"
                        >
                          <p className="text-xs text-foreground/90 truncate">{connected.node.title}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 capitalize">
                            {connected.node.type} • {connected.edgeLabel}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-2.5">
          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1.5">
            Node Types
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-[10px] text-muted-foreground/60 capitalize">{type}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mt-2 mb-1">
            Edges
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t border-white/40" />
              <span className="text-[10px] text-muted-foreground/60">Explicit</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t border-dashed border-white/30" />
              <span className="text-[10px] text-muted-foreground/60">Inferred</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t-2 border-dashed border-red-400/50" />
              <span className="text-[10px] text-muted-foreground/60">Gap</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
