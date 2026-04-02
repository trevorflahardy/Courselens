import { create } from "zustand";
import type {
  CourseNodeSummary,
  Finding,
  GraphState,
  AuditRun,
  DashboardStats,
} from "@/lib/types";

interface AuditStore {
  // Node state
  nodes: CourseNodeSummary[];
  setNodes: (nodes: CourseNodeSummary[]) => void;

  // Findings
  findings: Finding[];
  setFindings: (findings: Finding[]) => void;
  addFinding: (finding: Finding) => void;

  // Graph
  graph: GraphState | null;
  setGraph: (graph: GraphState) => void;

  // Audit runs
  auditRuns: AuditRun[];
  setAuditRuns: (runs: AuditRun[]) => void;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;

  // Dashboard stats
  stats: DashboardStats | null;
  setStats: (stats: DashboardStats) => void;

  // UI state
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useAuditStore = create<AuditStore>((set) => ({
  // Nodes
  nodes: [],
  setNodes: (nodes) => set({ nodes }),

  // Findings
  findings: [],
  setFindings: (findings) => set({ findings }),
  addFinding: (finding) =>
    set((state) => ({ findings: [finding, ...state.findings] })),

  // Graph
  graph: null,
  setGraph: (graph) => set({ graph }),

  // Audit runs
  auditRuns: [],
  setAuditRuns: (auditRuns) => set({ auditRuns }),
  activeRunId: null,
  setActiveRunId: (activeRunId) => set({ activeRunId }),

  // Dashboard stats
  stats: null,
  setStats: (stats) => set({ stats }),

  // UI
  selectedNodeId: null,
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
