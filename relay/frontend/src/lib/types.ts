// Types mirror relay/docs/CONTRACT.md §4–§6. Ids are normalised to `id` in lib/api.ts
// (the backend may serialise Mongo `_id` either way).

export const ROLES = ['EMPLOYEE', 'MANAGER', 'FINANCE', 'DIRECTOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export const APPROVER_ROLES: Role[] = ['MANAGER', 'FINANCE', 'DIRECTOR', 'ADMIN'];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  department?: string | null;
}

export const REQUEST_STATUSES = [
  'SUBMITTED',
  'PENDING_APPROVAL',
  'ESCALATED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const FINAL_STATUSES: RequestStatus[] = ['APPROVED', 'REJECTED', 'CANCELLED'];

export type StepStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

export interface Step {
  index: number;
  role: Role;
  assigned_role: Role;
  sla_hours: number;
  status: StepStatus;
  started_at: string | null;
  due_at: string | null;
  breached: boolean;
  escalation_level: number;
  acted_by: string | null;
  acted_by_name: string | null;
  acted_at: string | null;
  comment: string | null;
}

export interface ApprovalRequest {
  id: string;
  request_type: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  department: string;
  requester_id: string;
  requester_name: string;
  status: RequestStatus;
  workflow_id: string | null;
  workflow_version: number | null;
  rule_name: string | null;
  steps: Step[];
  current_step: number | null;
  current_approver_role: Role | null;
  sla_due_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface NewRequestInput {
  title: string;
  description: string;
  amount: number;
  currency: string;
  department: string;
  request_type: string;
}

export type Decision = 'APPROVE' | 'REJECT';

export interface Accepted {
  accepted: boolean;
  event_id: string;
}

export interface WorkflowStep {
  role: Role;
  sla_hours: number;
}

export interface RuleConditions {
  min_amount?: number | null;
  max_amount?: number | null;
  departments?: string[] | null;
  request_types?: string[] | null;
}

export interface WorkflowRule {
  name: string;
  priority: number;
  conditions: RuleConditions;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  request_type: string;
  active: boolean;
  version: number;
  rules: WorkflowRule[];
  escalation: Partial<Record<Role, Role | null>>;
  created_at?: string;
  updated_at?: string;
}

export interface RoutePreview {
  workflow_id: string | null;
  rule_name: string | null;
  steps: WorkflowStep[];
}

export type EventSource = 'api' | 'workflow-engine' | 'sla-monitor';
export const EVENT_SOURCES: EventSource[] = ['api', 'workflow-engine', 'sla-monitor'];

export const EVENT_TYPES = [
  'REQUEST_SUBMITTED',
  'REQUEST_ROUTED',
  'STEP_ACTIVATED',
  'APPROVAL_DECISION',
  'STEP_APPROVED',
  'STEP_REJECTED',
  'SLA_BREACHED',
  'REQUEST_ESCALATED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'REQUEST_CANCEL_REQUESTED',
  'REQUEST_CANCELLED',
  'EVENT_DEAD_LETTERED',
  'EVENT_REPLAYED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface AuditEntry {
  id: string;
  event_id: string;
  event_type: EventType | string;
  request_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: Role | string | null;
  source: EventSource | string;
  occurred_at: string;
  recorded_at?: string | null;
  payload: Record<string, unknown> | null;
  request_title?: string | null;
  correlation_id?: string | null;
  attempt?: number | null;
}

export interface AuditQuery {
  request_id?: string;
  event_type?: string;
  actor_id?: string;
  source?: string;
  from?: string;
  to?: string;
  limit: number;
  skip: number;
}

export interface Stats {
  by_status: Partial<Record<RequestStatus, number>>;
  my_open: number;
  inbox: number;
  breached: number;
  dlq_pending: number;
  approved_last_7d: number;
  avg_cycle_hours: number | null;
}

export type DeadLetterStatus = 'PENDING' | 'REPLAYED' | 'DISCARDED';

export interface DeadLetter {
  id: string;
  event: {
    event_id?: string;
    event_type?: string;
    request_id?: string;
    actor_name?: string;
    occurred_at?: string;
    payload?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error: string;
  group: string;
  failed_at: string;
  attempts: number;
  status: DeadLetterStatus;
}

export interface NewUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  department?: string;
}

export type ComponentState = 'up' | 'down' | 'disabled';
export interface Health {
  status: 'ok' | 'degraded';
  components: { mongo: ComponentState; redis: ComponentState; kafka: ComponentState };
  event_bus?: string;
  workers?: boolean;
}
