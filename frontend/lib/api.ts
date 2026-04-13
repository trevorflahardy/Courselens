/* Typed fetch wrapper for the backend API */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    throw new Error(`Network error while calling ${path}: ${message}`);
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// --- Nodes ---

import type {
  AssignmentNote,
  CourseNode,
  CourseNodeSummary,
  NodeLink,
  Finding,
  GraphState,
  NodeGraphNeighbors,
  AuditRun,
  AuditRuntimeState,
  DashboardStats,
  Rubric,
  Suggestion,
  AppliedChange,
  AppliedChangeAction,
  ChangelogStats,
} from "./types";

export const api = {
  // Nodes
  listNodes: (params?: { type?: string; week?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set("type", params.type);
    if (params?.week) qs.set("week", String(params.week));
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return request<CourseNodeSummary[]>(`/api/nodes${query ? `?${query}` : ""}`);
  },

  getNode: (id: string) => request<CourseNode>(`/api/nodes/${id}`),

  listAssignmentNotes: (nodeId: string) =>
    request<AssignmentNote[]>(`/api/nodes/${nodeId}/notes`),

  createAssignmentNote: (nodeId: string, note: string) =>
    request<AssignmentNote>(`/api/nodes/${nodeId}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  deleteAssignmentNote: (nodeId: string, noteId: string) =>
    request<{ deleted: boolean }>(`/api/nodes/${nodeId}/notes/${noteId}`, { method: "DELETE" }),

  getAssignmentRubric: (id: string) => request<Rubric>(`/api/nodes/${id}/rubric`),

  getNodeLinks: (id: string) => request<NodeLink[]>(`/api/nodes/${id}/links`),

  listAllNodeLinks: () => request<NodeLink[]>("/api/nodes/all-links"),

  updateNode: (id: string, body: Partial<CourseNode>) =>
    request<CourseNode>(`/api/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createNodeLink: (sourceId: string, targetId: string, linkType: "file" | "assignment" | "page") =>
    request<{ source_id: string; target_id: string; link_type: string }>(`/api/nodes/${sourceId}/links`, {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, link_type: linkType }),
    }),

  // Findings
  listFindings: (params?: { assignment_id?: string; severity?: string }) => {
    const qs = new URLSearchParams();
    if (params?.assignment_id) qs.set("assignment_id", params.assignment_id);
    if (params?.severity) qs.set("severity", params.severity);
    const query = qs.toString();
    return request<Finding[]>(`/api/findings${query ? `?${query}` : ""}`);
  },

  deleteFindings: (assignmentId?: string) => {
    const qs = assignmentId ? `?assignment_id=${encodeURIComponent(assignmentId)}` : "";
    return request<{ deleted: number }>(`/api/findings${qs}`, { method: "DELETE" });
  },

  // Graph
  getGraph: () => request<GraphState>("/api/graph"),

  getNodeGraph: (id: string) => request<NodeGraphNeighbors>(`/api/graph/node/${id}`),

  // Audit
  startAudit: (assignmentId: string) =>
    request<AuditRun>(`/api/audit/${assignmentId}`, { method: "POST" }),

  listAuditRuns: () => request<AuditRun[]>("/api/audit/runs"),

  getAuditState: () => request<AuditRuntimeState>("/api/audit/state"),

  getAuditRun: (runId: string) => request<AuditRun>(`/api/audit/runs/${runId}`),

  cancelAuditRun: (runId: string) =>
    request<AuditRun>(`/api/audit/runs/${runId}/cancel`, { method: "POST" }),

  resumeAuditRun: (runId: string) =>
    request<AuditRun>(`/api/audit/runs/${runId}/resume`, { method: "POST" }),

  startAuditAll: (batchSize = 4) =>
    request<{ total: number; completed: number; errors: string[] }>(
      `/api/audit/all?batch_size=${batchSize}`,
      { method: "POST" },
    ),

  getAuditSummary: () =>
    request<Record<string, unknown>>("/api/audit/summary"),

  // Dashboard
  getStats: () => request<DashboardStats>("/api/stats"),

  // Ingest
  listCourses: () =>
    request<{ id: string; name: string; course_code: string; term: number | null }[]>(
      "/api/ingest/courses",
    ),

  startIngest: (courseId?: string) =>
    request<{ status: string }>("/api/ingest/course", {
      method: "POST",
      body: courseId ? JSON.stringify({ course_id: courseId }) : undefined,
    }),

  uploadZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE}/api/ingest/zip`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) {
        throw new Error(`API ${r.status}: ${await r.text()}`);
      }
      return r.json();
    });
  },

  rebuildGraph: () =>
    request<{ edges: number; orphans: number }>("/api/ingest/rebuild-graph", { method: "POST" }),

  getIngestStatus: () =>
    request<{ status: string; stage?: string; message?: string; nodes_processed?: number; last_run?: string; feed?: string[] }>("/api/ingest/status"),

  getProcesses: () =>
    request<{ run_id: string; assignment_id: string; status: string; pid: number | null; alive: boolean; started_at: string; finished_at: string | null }[]>("/api/ingest/processes"),

  dedupFiles: () =>
    request<{ groups_merged: number; nodes_deleted: number }>("/api/ingest/dedup-files", { method: "POST" }),

  relinkContent: () =>
    request<{ nodes_processed: number; links_extracted: number; modules_auto_assigned: number; edges_total: number }>(
      "/api/ingest/relink-content",
      { method: "POST" },
    ),

  clearAll: () =>
    request<Record<string, number>>("/api/ingest/clear-all", { method: "POST" }),

  syncRubrics: () =>
    request<{
      assignment_nodes_updated: number;
      rubrics_upserted: number;
      links_created: number;
      errors: string[];
    }>("/api/ingest/sync-rubrics", { method: "POST" }),

  linkRubrics: () =>
    request<{
      linked: number;
      already_linked: number;
      missing_rubric_nodes: { assignment_id: string; rubric_id: string }[];
    }>("/api/ingest/link-rubrics", { method: "POST" }),

  // Suggestions
  listSuggestions: (params?: { finding_id?: string; node_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.finding_id) qs.set("finding_id", params.finding_id);
    if (params?.node_id) qs.set("node_id", params.node_id);
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return request<Suggestion[]>(`/api/suggestions${query ? `?${query}` : ""}`);
  },

  approveSuggestion: (id: string) =>
    request<Suggestion>(`/api/suggestions/${id}/approve`, { method: "POST" }),

  denySuggestion: (id: string, reason: string) =>
    request<Suggestion>(`/api/suggestions/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  ignoreSuggestion: (id: string, reason: string) =>
    request<Suggestion>(`/api/suggestions/${id}/ignore`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  markSuggestionDoneManually: (id: string, note: string | null) =>
    request<Suggestion>(`/api/suggestions/${id}/done-manually`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  generateSuggestionForFinding: (findingId: string) =>
    request<Suggestion>(`/api/suggestions/generate/${findingId}`, { method: "POST" }),

  addManualChangelogEntry: (findingId: string, note: string | null) =>
    request<AppliedChange>(`/api/changelog/manual/${findingId}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  // Changelog
  listChangelog: (params?: {
    node_id?: string;
    action?: AppliedChangeAction;
    since?: string;
    until?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.node_id) qs.set("node_id", params.node_id);
    if (params?.action) qs.set("action", params.action);
    if (params?.since) qs.set("since", params.since);
    if (params?.until) qs.set("until", params.until);
    const query = qs.toString();
    return request<AppliedChange[]>(`/api/changelog${query ? `?${query}` : ""}`);
  },

  getChangelogStats: () => request<ChangelogStats>("/api/changelog/stats"),

  downloadChangelogMarkdown: async () => {
    const res = await fetch(`${API_BASE}/api/changelog/export.md`);
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${await res.text()}`);
    }
    return res.blob();
  },

  cleanupTestData: () =>
    request<{
      nodes_deleted: number;
      edges_deleted: number;
      links_deleted: number;
      findings_deleted: number;
      audit_runs_deleted: number;
      rubrics_deleted: number;
    }>("/api/ingest/cleanup-test-data", { method: "POST" }),
};
