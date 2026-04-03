"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as d3 from "d3";
import type { CourseNodeSummary, GraphEdge, EdgeType, NodeType, NodeStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  status: NodeStatus;
  finding_count: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  edge_type: EdgeType;
  label: string | null;
  confidence: number | null;
}

interface ForceGraphProps {
  nodes: CourseNodeSummary[];
  edges: GraphEdge[];
  filter: "all" | "connected" | "gaps" | "orphans" | "inferred";
  hideImageFiles?: boolean;
  hiddenNodeTypes?: NodeType[];
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

export const NODE_COLORS: Record<NodeType, string> = {
  assignment: "oklch(0.7 0.18 265)",   // purple-blue (primary)
  page: "oklch(0.73 0.14 195)",        // teal
  rubric: "oklch(0.68 0.2 310)",       // magenta
  lecture: "oklch(0.78 0.14 155)",      // green
  announcement: "oklch(0.73 0.15 65)", // amber
  file: "oklch(0.6 0.08 260)",         // muted blue
};

const STATUS_RING: Record<NodeStatus, string> = {
  ok: "oklch(0.72 0.19 155)",
  warn: "oklch(0.78 0.16 70)",
  gap: "oklch(0.65 0.25 25)",
  orphan: "oklch(0.6 0.15 310)",
  unaudited: "oklch(0.4 0.02 270)",
};

const EDGE_STYLES: Record<EdgeType, { color: string; dash: string; width: number }> = {
  explicit: { color: "oklch(0.5 0.06 270 / 0.5)", dash: "", width: 1.5 },
  inferred: { color: "oklch(0.5 0.06 270 / 0.35)", dash: "4,3", width: 1 },
  artifact: { color: "oklch(0.6 0.1 195 / 0.4)", dash: "2,2", width: 1 },
  gap: { color: "oklch(0.65 0.25 25 / 0.6)", dash: "6,3", width: 2 },
};

function stableNoise(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function isImageFileNode(node: CourseNodeSummary): boolean {
  if (node.type !== "file") return false;
  const title = node.title?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(title);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForceGraph({
  nodes,
  edges,
  filter,
  hideImageFiles = false,
  hiddenNodeTypes = [],
  onNodeClick,
  selectedNodeId,
}: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Filter nodes/edges based on filter prop
  const filteredData = useCallback(() => {
    let filteredNodes = [...nodes] as GraphNode[];
    let filteredEdges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      edge_type: e.edge_type,
      label: e.label,
      confidence: e.confidence,
    })) as GraphLink[];

    if (hiddenNodeTypes.length > 0) {
      const hiddenTypes = new Set<NodeType>(hiddenNodeTypes);
      const hiddenIds = new Set(filteredNodes.filter((node) => hiddenTypes.has(node.type)).map((node) => node.id));
      filteredNodes = filteredNodes.filter((node) => !hiddenIds.has(node.id));
      filteredEdges = filteredEdges.filter((edge) => {
        const sid = typeof edge.source === "string" ? edge.source : (edge.source as GraphNode).id;
        const tid = typeof edge.target === "string" ? edge.target : (edge.target as GraphNode).id;
        return !hiddenIds.has(sid) && !hiddenIds.has(tid);
      });
    }

    if (hideImageFiles) {
      const hiddenIds = new Set(
        filteredNodes.filter((node) => isImageFileNode(node)).map((node) => node.id)
      );
      filteredNodes = filteredNodes.filter((node) => !hiddenIds.has(node.id));
      filteredEdges = filteredEdges.filter((edge) => {
        const sid = typeof edge.source === "string" ? edge.source : (edge.source as GraphNode).id;
        const tid = typeof edge.target === "string" ? edge.target : (edge.target as GraphNode).id;
        return !hiddenIds.has(sid) && !hiddenIds.has(tid);
      });
    }

    if (filter === "connected") {
      const connectedNodeIds = new Set<string>();
      filteredEdges.forEach((e) => {
        connectedNodeIds.add(typeof e.source === "string" ? e.source : (e.source as GraphNode).id);
        connectedNodeIds.add(typeof e.target === "string" ? e.target : (e.target as GraphNode).id);
      });
      filteredNodes = filteredNodes.filter((n) => connectedNodeIds.has(n.id));
    } else if (filter === "gaps") {
      const gapNodeIds = new Set(filteredNodes.filter((n) => n.status === "gap").map((n) => n.id));
      // Include gap edges too
      filteredEdges.forEach((e) => {
        if (e.edge_type === "gap") {
          gapNodeIds.add(typeof e.source === "string" ? e.source : (e.source as GraphNode).id);
          gapNodeIds.add(typeof e.target === "string" ? e.target : (e.target as GraphNode).id);
        }
      });
      filteredNodes = filteredNodes.filter((n) => gapNodeIds.has(n.id));
      const nodeIdSet = new Set(filteredNodes.map((n) => n.id));
      filteredEdges = filteredEdges.filter((e) => {
        const sid = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
        const tid = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
        return nodeIdSet.has(sid) && nodeIdSet.has(tid);
      });
    } else if (filter === "orphans") {
      filteredNodes = filteredNodes.filter((n) => n.status === "orphan");
      filteredEdges = [];
    } else if (filter === "inferred") {
      filteredEdges = filteredEdges.filter((e) => e.edge_type === "inferred");
      const nodeIdSet = new Set<string>();
      filteredEdges.forEach((e) => {
        nodeIdSet.add(typeof e.source === "string" ? e.source : (e.source as GraphNode).id);
        nodeIdSet.add(typeof e.target === "string" ? e.target : (e.target as GraphNode).id);
      });
      filteredNodes = filteredNodes.filter((n) => nodeIdSet.has(n.id));
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [nodes, edges, filter, hideImageFiles, hiddenNodeTypes]);

  // Build / update simulation
  useEffect(() => {
    if (!svgRef.current || dimensions.width === 0) return;

    const { nodes: graphNodes, edges: graphEdges } = filteredData();
    if (graphNodes.length === 0) return;

    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Defs for arrowheads and glow
    const defs = svg.append("defs");

    // Arrow markers for each edge type
    Object.entries(EDGE_STYLES).forEach(([type, style]) => {
      defs
        .append("marker")
        .attr("id", `arrow-${type}`)
        .attr("viewBox", "0 -3 6 6")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-3L6,0L0,3")
        .attr("fill", style.color);
    });

    // Glow filter
    const glowFilter = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    glowFilter
      .append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .enter()
      .append("feMergeNode")
      .attr("in", (d) => d);

    // Selected glow filter
    const selectedGlow = defs.append("filter").attr("id", "selected-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    selectedGlow.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "blur");
    selectedGlow
      .append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .enter()
      .append("feMergeNode")
      .attr("in", (d) => d);

    // Container group for zoom/pan
    const g = svg.append("g");

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Initial centering
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85));

    // Adaptive placement:
    // - Auto-orients the week timeline (horizontal for dense schedules)
    // - Packs nodes by module per week with dynamic spacing
    // - Uses neighbor barycenter smoothing to reduce edge crossings
    const weeks = [...new Set(graphNodes.map((n) => n.week ?? 0))].sort((a, b) => a - b);
    const minWeek = weeks[0] ?? 0;
    const maxWeek = weeks[weeks.length - 1] ?? minWeek;
    const timelineHorizontal = weeks.length >= 9 || width > height * 1.08;

    const domainMin = minWeek === maxWeek ? minWeek - 0.5 : minWeek;
    const domainMax = minWeek === maxWeek ? maxWeek + 0.5 : maxWeek;
    const primarySpan = timelineHorizontal ? width * 0.82 : height * 0.82;
    const secondarySpan = timelineHorizontal ? height * 0.78 : width * 0.78;

    const weekScale = d3
      .scaleLinear()
      .domain([domainMin, domainMax])
      .range([-primarySpan / 2, primarySpan / 2]);

    const weekForNode = (node: GraphNode): number => node.week ?? minWeek;

    const adjacency = new Map<string, Set<string>>();
    graphNodes.forEach((node) => adjacency.set(node.id, new Set<string>()));
    graphEdges.forEach((edge) => {
      const sid = typeof edge.source === "string" ? edge.source : edge.source.id;
      const tid = typeof edge.target === "string" ? edge.target : edge.target.id;
      if (sid === tid) return;
      adjacency.get(sid)?.add(tid);
      adjacency.get(tid)?.add(sid);
    });
    const connectionScore = (id: string): number => adjacency.get(id)?.size ?? 0;

    const secondaryTargets = new Map<string, number>();
    const nodesByWeek = d3.group(graphNodes, (n) => weekForNode(n));

    for (const [week, laneNodes] of nodesByWeek) {
      const nodesByModule = d3.group(laneNodes, (n) => n.module?.trim() || "No module");
      const moduleNames = [...nodesByModule.keys()].sort((a, b) => {
        const sizeDiff = (nodesByModule.get(b)?.length ?? 0) - (nodesByModule.get(a)?.length ?? 0);
        if (sizeDiff !== 0) return sizeDiff;
        return a.localeCompare(b);
      });

      const moduleCount = Math.max(1, moduleNames.length);
      const totalModuleSpan = moduleCount === 1
        ? 0
        : Math.min(secondarySpan * 0.72, Math.max(160, moduleCount * 130));
      const moduleStep = moduleCount <= 1 ? 0 : totalModuleSpan / (moduleCount - 1);

      moduleNames.forEach((moduleName, moduleIndex) => {
        const moduleCenter = moduleCount === 1
          ? 0
          : -totalModuleSpan / 2 + moduleIndex * moduleStep;

        const moduleNodes = nodesByModule.get(moduleName) ?? [];
        const sorted = [...moduleNodes].sort((a, b) => {
          const degreeDiff = connectionScore(b.id) - connectionScore(a.id);
          if (degreeDiff !== 0) return degreeDiff;
          return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        });

        const count = Math.max(1, sorted.length);
        const dynamicIntraSpan = Math.min(
          240,
          Math.max(44, (count - 1) * 20 + Math.min(90, count * 6))
        );
        const step = count <= 1 ? 0 : dynamicIntraSpan / (count - 1);

        sorted.forEach((node, idx) => {
          const laneBase = count === 1
            ? moduleCenter
            : moduleCenter - dynamicIntraSpan / 2 + step * idx;
          secondaryTargets.set(node.id, laneBase);
        });
      });

    }

    for (let pass = 0; pass < 2; pass += 1) {
      graphNodes.forEach((node) => {
        const neighbors = [...(adjacency.get(node.id) ?? [])]
          .map((id) => secondaryTargets.get(id))
          .filter((value): value is number => value !== undefined);

        if (neighbors.length === 0) return;

        const neighborMean = d3.mean(neighbors) ?? 0;
        const current = secondaryTargets.get(node.id) ?? 0;
        const blend = 0.2 + Math.min(0.18, connectionScore(node.id) * 0.014);
        const next = current * (1 - blend) + neighborMean * blend;
        const clamped = Math.max(-secondarySpan * 0.45, Math.min(secondarySpan * 0.45, next));
        secondaryTargets.set(node.id, clamped);
      });
    }

    graphNodes.forEach((node) => {
      const primary = weekScale(weekForNode(node));
      const secondary = secondaryTargets.get(node.id) ?? 0;
      const xJitter = (stableNoise(`${node.id}-x`) - 0.5) * 12;
      const yJitter = (stableNoise(`${node.id}-y`) - 0.5) * 12;

      if (timelineHorizontal) {
        node.x = primary + xJitter;
        node.y = secondary + yJitter;
      } else {
        node.x = secondary + xJitter;
        node.y = primary + yJitter;
      }
    });

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(graphNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(graphEdges)
          .id((d) => d.id)
          .distance((d) => {
            const sourceWeek = weekForNode(d.source as GraphNode);
            const targetWeek = weekForNode(d.target as GraphNode);
            const weekDelta = Math.abs(sourceWeek - targetWeek);
            const base = d.label?.startsWith("Sequential in") ? 52 : 92;
            return base + Math.min(64, weekDelta * 12);
          })
          .strength((d) => {
            const sourceWeek = weekForNode(d.source as GraphNode);
            const targetWeek = weekForNode(d.target as GraphNode);
            const weekDelta = Math.abs(sourceWeek - targetWeek);
            const base = d.label?.startsWith("Sequential in") ? 0.5 : 0.24;
            return Math.max(0.1, base - weekDelta * 0.015);
          })
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          .strength(-Math.max(95, Math.min(260, 95 + graphNodes.length * 0.45)))
          .distanceMax(Math.max(240, Math.min(460, Math.sqrt(graphNodes.length) * 30)))
      )
      .force(
        "x",
        d3
          .forceX<GraphNode>((d) =>
            timelineHorizontal ? weekScale(weekForNode(d)) : (secondaryTargets.get(d.id) ?? 0)
          )
          .strength(timelineHorizontal ? 0.3 : 0.22)
      )
      .force(
        "y",
        d3
          .forceY<GraphNode>((d) =>
            timelineHorizontal ? (secondaryTargets.get(d.id) ?? 0) : weekScale(weekForNode(d))
          )
          .strength(timelineHorizontal ? 0.22 : 0.32)
      )
      .force("collision", d3.forceCollide<GraphNode>(22))
      .alpha(0.7)
      .alphaDecay(0.06)
      .velocityDecay(0.5);

    // Pre-settle so the graph doesn't visibly jiggle on first paint.
    simulation.stop();
    for (let i = 0; i < 220; i += 1) {
      simulation.tick();
    }

    simulationRef.current = simulation;

    // --- Draw edges ---
    const linkGroup = g.append("g").attr("class", "links");
    const links = linkGroup
      .selectAll("line")
      .data(graphEdges)
      .enter()
      .append("line")
      .attr("stroke", (d) => EDGE_STYLES[d.edge_type]?.color ?? "oklch(0.4 0.02 270 / 0.3)")
      .attr("stroke-width", (d) => EDGE_STYLES[d.edge_type]?.width ?? 1)
      .attr("stroke-dasharray", (d) => EDGE_STYLES[d.edge_type]?.dash ?? "")
      .attr("marker-end", (d) => `url(#arrow-${d.edge_type})`);

    // --- Draw nodes ---
    const nodeGroup = g.append("g").attr("class", "nodes");
    const nodeGs = nodeGroup
      .selectAll("g")
      .data(graphNodes)
      .enter()
      .append("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Status ring (outer)
    nodeGs
      .append("circle")
      .attr("r", 14)
      .attr("fill", "none")
      .attr("stroke", (d) => STATUS_RING[d.status] ?? STATUS_RING.unaudited)
      .attr("stroke-width", 2)
      .attr("opacity", 0.6);

    // Node circle (inner)
    nodeGs
      .append("circle")
      .attr("r", 10)
      .attr("fill", (d) => NODE_COLORS[d.type] ?? NODE_COLORS.file)
      .attr("stroke", "oklch(0.13 0.02 280)")
      .attr("stroke-width", 1.5)
      .attr("filter", (d) => (d.id === selectedNodeId ? "url(#selected-glow)" : ""));

    // Finding count badge
    nodeGs
      .filter((d) => d.finding_count > 0)
      .append("circle")
      .attr("cx", 8)
      .attr("cy", -8)
      .attr("r", 6)
      .attr("fill", (d) => (d.status === "gap" ? "oklch(0.65 0.25 25)" : "oklch(0.7 0.18 265)"))
      .attr("stroke", "oklch(0.13 0.02 280)")
      .attr("stroke-width", 1);

    nodeGs
      .filter((d) => d.finding_count > 0)
      .append("text")
      .attr("x", 8)
      .attr("y", -5)
      .attr("text-anchor", "middle")
      .attr("font-size", "8px")
      .attr("font-weight", "bold")
      .attr("fill", "white")
      .text((d) => d.finding_count);

    // Node label
    nodeGs
      .append("text")
      .attr("dy", 26)
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "oklch(0.65 0.02 270)")
      .attr("font-family", "var(--font-geist-sans), sans-serif")
      .text((d) => (d.title.length > 18 ? d.title.slice(0, 16) + "..." : d.title));

    // Interactions
    nodeGs
      .on("mouseenter", (event, d) => {
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltip({ x, y, node: d });
        // Highlight connected edges
        links
          .attr("opacity", (l) => {
            const sid = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
            const tid = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
            return sid === d.id || tid === d.id ? 1 : 0.15;
          })
          .attr("stroke-width", (l) => {
            const sid = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
            const tid = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
            return sid === d.id || tid === d.id
              ? (EDGE_STYLES[l.edge_type]?.width ?? 1) * 2
              : EDGE_STYLES[l.edge_type]?.width ?? 1;
          });
        nodeGs.attr("opacity", (n) => {
          if (n.id === d.id) return 1;
          // Check if connected
          const connected = graphEdges.some((e) => {
            const sid = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
            const tid = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
            return (sid === d.id && tid === n.id) || (tid === d.id && sid === n.id);
          });
          return connected ? 1 : 0.25;
        });
      })
      .on("mouseleave", () => {
        setTooltip(null);
        links.attr("opacity", 1).attr("stroke-width", (l) => EDGE_STYLES[l.edge_type]?.width ?? 1);
        nodeGs.attr("opacity", 1);
      })
      .on("click", (_, d) => {
        onNodeClick?.(d.id);
      });

    // Tick
    const renderTick = () => {
      links
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      nodeGs.attr("transform", (d) => `translate(${d.x},${d.y})`);
    };
    simulation.on("tick", renderTick);
    renderTick();

    // Week labels and guide lines
    const labelGroup = g.append("g").attr("class", "week-labels");
    weeks.forEach((w) => {
      const isNoWeek = w === 0;
      if (timelineHorizontal) {
        labelGroup
          .append("text")
          .attr("x", weekScale(w))
          .attr("y", -height * 0.37)
          .attr("text-anchor", "middle")
          .attr("font-size", "10px")
          .attr("fill", "oklch(0.45 0.03 270)")
          .attr("font-family", "var(--font-geist-sans), sans-serif")
          .attr("font-weight", "600")
          .text(isNoWeek ? "Uncategorized" : `Week ${w}`);

        labelGroup
          .append("line")
          .attr("x1", weekScale(w))
          .attr("x2", weekScale(w))
          .attr("y1", -height * 0.34)
          .attr("y2", height * 0.34)
          .attr("stroke", isNoWeek ? "oklch(0.35 0.02 270 / 0.35)" : "oklch(0.25 0.02 270 / 0.3)")
          .attr("stroke-dasharray", isNoWeek ? "6,4" : "2,4");
      } else {
        labelGroup
          .append("text")
          .attr("x", -width * 0.4)
          .attr("y", weekScale(w))
          .attr("font-size", "10px")
          .attr("fill", "oklch(0.45 0.03 270)")
          .attr("font-family", "var(--font-geist-sans), sans-serif")
          .attr("font-weight", "600")
          .text(isNoWeek ? "No Week / Uncategorized" : `Week ${w}`);

        labelGroup
          .append("line")
          .attr("x1", -width * 0.38)
          .attr("x2", width * 0.4)
          .attr("y1", weekScale(w))
          .attr("y2", weekScale(w))
          .attr("stroke", isNoWeek ? "oklch(0.35 0.02 270 / 0.35)" : "oklch(0.25 0.02 270 / 0.3)")
          .attr("stroke-dasharray", isNoWeek ? "6,4" : "2,4");
      }
    });

    return () => {
      simulation.stop();
    };
  }, [dimensions, filteredData, selectedNodeId, onNodeClick]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full"
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-50 bg-black/80 backdrop-blur-md border border-white/12 rounded-lg px-3 py-2 shadow-xl"
          style={{
            left: tooltip.x + 16,
            top: tooltip.y - 8,
            maxWidth: 240,
          }}
        >
          <p className="text-xs font-semibold text-white truncate">{tooltip.node.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: NODE_COLORS[tooltip.node.type] }}
            />
            <span className="text-[10px] text-white/70 capitalize">{tooltip.node.type}</span>
            {tooltip.node.week && (
              <span className="text-[10px] text-white/50">Week {tooltip.node.week}</span>
            )}
          </div>
          {tooltip.node.finding_count > 0 && (
            <p className="text-[10px] text-white/60 mt-1">
              {tooltip.node.finding_count} finding{tooltip.node.finding_count !== 1 ? "s" : ""}
            </p>
          )}
          <span
            className="inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded"
            style={{
              background: STATUS_RING[tooltip.node.status] + "33",
              color: STATUS_RING[tooltip.node.status],
            }}
          >
            {tooltip.node.status}
          </span>
        </div>
      )}
    </div>
  );
}
