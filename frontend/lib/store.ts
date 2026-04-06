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
  errors: { nodes: string | null; findings: string | null; auditRuns: string | null; stats: string | null };

  // Actions
  fetchNodes: (params?: { type?: string; week?: number; status?: string }) => Promise<void>;
  fetchFindings: (params?: { assignment_id?: string; severity?: string }) => Promise<void>;
  fetchAuditRuns: () => Promise<void>;
  fetchStats: () => Promise<void>;
  startAudit: (assignmentId: string) => Promise<AuditRun>;

  // UI state
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Course selection
  selectedCourseId: string | null;
  selectedCourseName: string | null;
  setSelectedCourse: (id: string, name: string) => void;

  // Assignments page filters (persisted across navigation)
  assignmentsSearch: string;
  assignmentsTypeFilter: string;
  assignmentsSeverityFilter: string;
  assignmentsWeekFilter: string;
  setAssignmentsFilters: (filters: { search?: string; typeFilter?: string; severityFilter?: string; weekFilter?: string }) => void;
}

export const useAuditStore = create<AuditStore>((set, get) => ({
  // Data
  nodes: [],
  findings: [],
  auditRuns: [],
  stats: null,

  // Loading states
  loading: { nodes: false, findings: false, auditRuns: false, stats: false },
  errors: { nodes: null, findings: null, auditRuns: null, stats: null },

  // Actions
  fetchNodes: async (params) => {
    set((s) => ({ loading: { ...s.loading, nodes: true }, errors: { ...s.errors, nodes: null } }));
    try {
      const nodes = await api.listNodes(params);
      set({ nodes });
    } catch (error) {
      set((s) => ({
        errors: {
          ...s.errors,
          nodes: error instanceof Error ? error.message : "Failed to load nodes",
        },
      }));
    } finally {
      set((s) => ({ loading: { ...s.loading, nodes: false } }));
    }
  },

  fetchFindings: async (params) => {
    set((s) => ({ loading: { ...s.loading, findings: true }, errors: { ...s.errors, findings: null } }));
    try {
      const findings = await api.listFindings(params);
      set({ findings });
    } catch (error) {
      set((s) => ({
        errors: {
          ...s.errors,
          findings: error instanceof Error ? error.message : "Failed to load findings",
        },
      }));
    } finally {
      set((s) => ({ loading: { ...s.loading, findings: false } }));
    }
  },

  fetchAuditRuns: async () => {
    set((s) => ({ loading: { ...s.loading, auditRuns: true }, errors: { ...s.errors, auditRuns: null } }));
    try {
      const auditRuns = await api.listAuditRuns();
      set({ auditRuns });
    } catch (error) {
      set((s) => ({
        errors: {
          ...s.errors,
          auditRuns: error instanceof Error ? error.message : "Failed to load audit runs",
        },
      }));
    } finally {
      set((s) => ({ loading: { ...s.loading, auditRuns: false } }));
    }
  },

  fetchStats: async () => {
    set((s) => ({ loading: { ...s.loading, stats: true }, errors: { ...s.errors, stats: null } }));
    try {
      const stats = await api.getStats();
      set({ stats });
    } catch (error) {
      set((s) => ({
        errors: {
          ...s.errors,
          stats: error instanceof Error ? error.message : "Failed to load dashboard stats",
        },
      }));
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

  // Assignments page filters
  assignmentsSearch: "",
  assignmentsTypeFilter: "all",
  assignmentsSeverityFilter: "all",
  assignmentsWeekFilter: "all",
  setAssignmentsFilters: (filters) =>
    set((s) => ({
      assignmentsSearch: filters.search !== undefined ? filters.search : s.assignmentsSearch,
      assignmentsTypeFilter: filters.typeFilter !== undefined ? filters.typeFilter : s.assignmentsTypeFilter,
      assignmentsSeverityFilter: filters.severityFilter !== undefined ? filters.severityFilter : s.assignmentsSeverityFilter,
      assignmentsWeekFilter: filters.weekFilter !== undefined ? filters.weekFilter : s.assignmentsWeekFilter,
    })),

  // Course selection — persisted to localStorage via side-effect in CourseSelector
  selectedCourseId:
    typeof window !== "undefined" ? localStorage.getItem("selectedCourseId") : null,
  selectedCourseName:
    typeof window !== "undefined" ? localStorage.getItem("selectedCourseName") : null,
  setSelectedCourse: (id, name) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedCourseId", id);
      localStorage.setItem("selectedCourseName", name);
    }
    set({ selectedCourseId: id, selectedCourseName: name });
  },
}));
