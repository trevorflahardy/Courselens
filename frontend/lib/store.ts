import { create } from "zustand";
import { api } from "./api";
import type {
  CourseNodeSummary,
  Finding,
  AuditRun,
  DashboardStats,
} from "./types";

interface AuditStore {
  // Data
  nodes: CourseNodeSummary[];
  findings: Finding[];
  auditRuns: AuditRun[];
  stats: DashboardStats | null;

  // Loading states
  loading: { nodes: boolean; findings: boolean; auditRuns: boolean; stats: boolean };

  // Actions
  fetchNodes: (params?: { type?: string; week?: number; status?: string }) => Promise<void>;
  fetchFindings: (params?: { assignment_id?: string; severity?: string }) => Promise<void>;
  fetchAuditRuns: () => Promise<void>;
  fetchStats: () => Promise<void>;
  startAudit: (assignmentId: string) => Promise<AuditRun>;

  // UI state
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
}

export const useAuditStore = create<AuditStore>((set, get) => ({
  // Data
  nodes: [],
  findings: [],
  auditRuns: [],
  stats: null,

  // Loading states
  loading: { nodes: false, findings: false, auditRuns: false, stats: false },

  // Actions
  fetchNodes: async (params) => {
    set((s) => ({ loading: { ...s.loading, nodes: true } }));
    try {
      const nodes = await api.listNodes(params);
      set({ nodes });
    } finally {
      set((s) => ({ loading: { ...s.loading, nodes: false } }));
    }
  },

  fetchFindings: async (params) => {
    set((s) => ({ loading: { ...s.loading, findings: true } }));
    try {
      const findings = await api.listFindings(params);
      set({ findings });
    } finally {
      set((s) => ({ loading: { ...s.loading, findings: false } }));
    }
  },

  fetchAuditRuns: async () => {
    set((s) => ({ loading: { ...s.loading, auditRuns: true } }));
    try {
      const auditRuns = await api.listAuditRuns();
      set({ auditRuns });
    } finally {
      set((s) => ({ loading: { ...s.loading, auditRuns: false } }));
    }
  },

  fetchStats: async () => {
    set((s) => ({ loading: { ...s.loading, stats: true } }));
    try {
      const stats = await api.getStats();
      set({ stats });
    } finally {
      set((s) => ({ loading: { ...s.loading, stats: false } }));
    }
  },

  startAudit: async (assignmentId: string) => {
    const run = await api.startAudit(assignmentId);
    // Refresh audit runs list after starting a new one
    get().fetchAuditRuns();
    return run;
  },

  // UI state
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
}));
