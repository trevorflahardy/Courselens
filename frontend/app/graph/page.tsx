"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ForceGraph, NODE_COLORS } from "@/components/graph/ForceGraph";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { CourseNodeSummary, GraphEdge } from "@/lib/types";

type FilterMode = "all" | "gaps" | "orphans" | "inferred";

const FILTER_OPTIONS: { value: FilterMode; label: string; description: string }[] = [
  { value: "all", label: "All Nodes", description: "Show everything" },
  { value: "gaps", label: "Gaps Only", description: "Must-fix issues" },
  { value: "orphans", label: "Orphans", description: "Disconnected nodes" },
  { value: "inferred", label: "Inferred Edges", description: "AI-derived links" },
];

export default function GraphPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<CourseNodeSummary[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CourseNodeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  // Stats
  const totalNodes = nodes.length;
  const totalEdges = edges.length;
  const gapCount = nodes.filter((n) => n.status === "gap").length;
  const orphanCount = nodes.filter((n) => n.status === "orphan").length;

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
          </div>
        </div>

        {/* Filter toggles */}
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-1 border border-white/[0.06]">
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
                  View Assignment Details
                </button>
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
