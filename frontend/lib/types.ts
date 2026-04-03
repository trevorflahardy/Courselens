/* TypeScript types mirroring backend Pydantic models */

// --- Enums ---

export type NodeType = "assignment" | "page" | "rubric" | "lecture" | "announcement" | "file";
export type NodeStatus = "ok" | "warn" | "gap" | "orphan" | "unaudited";
export type FindingSeverity = "gap" | "warn" | "info" | "ok";
export type FindingStatus = "active" | "stale" | "resolved" | "superseded" | "confirmed";
export type EdgeType = "explicit" | "inferred" | "artifact" | "gap";
export type EdgeStatus = "active" | "stale";
export type AuditStatus = "running" | "done" | "error";

export type FindingType =
  | "clarity"
  | "rubric_mismatch"
  | "rubric_drift"
  | "assumption_gap"
  | "implicit_prerequisite"
  | "dependency_gap"
  | "format_mismatch"
  | "orphan"
  | "cascade_risk"
  | "curriculum_gap"
  | "broken_file_link";

// --- Rubric Models ---

export interface RubricRating {
  id: string;
  label: string;
  points: number;
  description: string | null;
}

export interface RubricCriterion {
  id: string;
  description: string;
  points: number;
  ratings: RubricRating[];
}

export interface Rubric {
  id: string;
  canvas_id: string | null;
  title: string;
  points_possible: number | null;
  criteria: RubricCriterion[];
  assignment_id: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

// --- Node Models ---

export interface CourseNode {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  module_order: number | null;
  description: string | null;
  points_possible: number | null;
  submission_types: string[] | null;
  rubric_id: string | null;
  file_content: string | null;
  file_path: string | null;
  canvas_url: string | null;
  source: string;
  status: NodeStatus;
  content_hash: string | null;
  last_audited: string | null;
  finding_count: number;
  created_at: string;
  updated_at: string;
}

export interface CourseNodeSummary {
  id: string;
  type: NodeType;
  title: string;
  week: number | null;
  module: string | null;
  rubric_id: string | null;
  status: NodeStatus;
  finding_count: number;
}

export interface NodeLink {
  source_id: string;
  target_id: string;
  link_type: string;
}

// --- Finding Models ---

export interface Finding {
  id: string;
  assignment_id: string;
  audit_run_id: string;
  severity: FindingSeverity;
  finding_type: FindingType;
  title: string;
  body: string;
  linked_node: string | null;
  evidence: string | null;
  pass_number: number;
  status: FindingStatus;
  content_hash_at_creation: string | null;
  superseded_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

// --- Graph Models ---

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: EdgeType;
  label: string | null;
  evidence: string | null;
  confidence: number | null;
  status: EdgeStatus;
  derived_at: string;
}

export interface GraphState {
  nodes: CourseNodeSummary[];
  edges: GraphEdge[];
  flags: CourseNodeSummary[];
}

export interface NodeGraphNeighbors {
  upstream: GraphEdge[];
  downstream: GraphEdge[];
}

// --- Audit Models ---

export interface AuditRun {
  id: string;
  assignment_id: string;
  status: AuditStatus;
  pass1_findings: number;
  pass2_findings: number;
  pass3_findings: number;
  total_findings: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

// --- SSE Event Types ---

export type SSEEventType =
  | "finding"
  | "pass_start"
  | "pass_done"
  | "heartbeat"
  | "done"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: Finding | { pass: number } | { message: string } | null;
}

// --- Dashboard Stats ---

export interface DashboardStats {
  total_nodes: number;
  gap_count: number;
  warn_count: number;
  ok_count: number;
  unaudited_count: number;
  total_findings: number;
  total_edges: number;
}
