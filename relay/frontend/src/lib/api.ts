import axios, { AxiosError } from 'axios';
import type {
  Accepted,
  ApprovalRequest,
  AuditEntry,
  AuditQuery,
  DeadLetter,
  DeadLetterStatus,
  Decision,
  Health,
  NewRequestInput,
  NewUserInput,
  Paged,
  RoutePreview,
  Stats,
  User,
  Workflow,
} from './types';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000/api';

const TOKEN_KEY = 'relay.token';
const USER_KEY = 'relay.user';

export const session = {
  token: (): string | null => safeGet(TOKEN_KEY),
  user: (): User | null => {
    const raw = safeGet(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  },
  save(token: string, user: User) {
    safeSet(TOKEN_KEY, token);
    safeSet(USER_KEY, JSON.stringify(user));
  },
  saveUser(user: User) {
    safeSet(USER_KEY, JSON.stringify(user));
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const http = axios.create({ baseURL: API_URL, timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = session.token();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Called when any authenticated call returns 401 (expired/invalid token). Set by AuthProvider. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

http.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      session.clear();
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  },
);

/** Turn any thrown value into one readable sentence for the UI. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      return err.code === 'ECONNABORTED'
        ? 'The server took too long to answer. Try again in a moment.'
        : `Can't reach the RELAY API at ${API_URL}. Check that the backend is running.`;
    }
    const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      // FastAPI 422 validation errors
      return detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : undefined;
          return field && typeof field === 'string' ? `${field}: ${d.msg}` : d.msg;
        })
        .join('; ');
    }
    if (err.response.status === 403) return "You don't have permission to do that.";
    if (err.response.status === 404) return 'That item no longer exists.';
    return `${fallback} (HTTP ${err.response.status})`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/** Backend documents may come back with `_id` instead of `id`; normalise once here. */
type WithId = { id?: string; _id?: string };
function norm<T>(doc: unknown): T {
  const d = doc as WithId & Record<string, unknown>;
  if (d && typeof d === 'object' && d.id == null && d._id != null) return { ...d, id: String(d._id) } as T;
  return d as T;
}
function normList<T>(data: unknown): T[] {
  const arr = Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? []);
  return arr.map((x) => norm<T>(x));
}
function normPaged<T>(data: unknown): Paged<T> {
  if (Array.isArray(data)) return { items: data.map((x) => norm<T>(x)), total: data.length };
  const d = data as { items?: unknown[]; total?: number };
  const items = (d?.items ?? []).map((x) => norm<T>(x));
  return { items, total: d?.total ?? items.length };
}

function clean<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const newIdempotencyKey = uuid;

export const api = {
  // Auth
  async login(email: string, password: string) {
    const form = new URLSearchParams({ username: email, password });
    const { data } = await http.post('/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return { token: data.access_token as string, user: norm<User>(data.user) };
  },
  async register(input: { email: string; password: string; name: string; department?: string }) {
    const { data } = await http.post('/auth/register', clean(input));
    return norm<User>(data);
  },
  async me() {
    const { data } = await http.get('/auth/me');
    return norm<User>(data);
  },

  // Requests
  async listRequests(params: { scope: 'mine' | 'inbox' | 'all'; status?: string; q?: string; limit?: number; skip?: number }) {
    const { data } = await http.get('/requests', { params: clean({ limit: 50, skip: 0, ...params }) });
    return normPaged<ApprovalRequest>(data);
  },
  async getRequest(id: string) {
    const { data } = await http.get(`/requests/${encodeURIComponent(id)}`);
    return norm<ApprovalRequest>(data);
  },
  async createRequest(input: NewRequestInput, idempotencyKey: string) {
    const { data } = await http.post('/requests', input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return norm<ApprovalRequest>(data);
  },
  async decide(id: string, decision: Decision, comment?: string) {
    const { data } = await http.post(`/requests/${encodeURIComponent(id)}/decision`, clean({ decision, comment }));
    return data as Accepted;
  },
  async cancel(id: string) {
    const { data } = await http.post(`/requests/${encodeURIComponent(id)}/cancel`);
    return data as Accepted;
  },
  async timeline(id: string) {
    const { data } = await http.get(`/requests/${encodeURIComponent(id)}/timeline`);
    return normList<AuditEntry>(data);
  },

  // Workflows
  async workflows() {
    const { data } = await http.get('/workflows');
    return normList<Workflow>(data);
  },
  async preview(params: { amount: number; department?: string; request_type?: string }) {
    const { data } = await http.get('/workflows/preview', { params: clean(params) });
    return data as RoutePreview;
  },
  async createWorkflow(wf: Omit<Workflow, 'id' | 'version'>) {
    const { data } = await http.post('/workflows', wf);
    return norm<Workflow>(data);
  },
  async updateWorkflow(id: string, wf: Partial<Workflow>) {
    const { data } = await http.put(`/workflows/${encodeURIComponent(id)}`, wf);
    return norm<Workflow>(data);
  },
  async deleteWorkflow(id: string) {
    await http.delete(`/workflows/${encodeURIComponent(id)}`);
  },

  // Audit
  async audit(query: AuditQuery) {
    const { data } = await http.get('/audit', { params: clean(query) });
    return normPaged<AuditEntry>(data);
  },

  // Stats
  async stats() {
    const { data } = await http.get('/stats');
    return data as Stats;
  },

  // Admin
  async deadLetters(status: DeadLetterStatus | 'ALL') {
    const { data } = await http.get('/admin/dlq', { params: status === 'ALL' ? {} : { status } });
    return normList<DeadLetter>(data);
  },
  async replayDeadLetter(id: string) {
    const { data } = await http.post(`/admin/dlq/${encodeURIComponent(id)}/replay`);
    return data;
  },
  async discardDeadLetter(id: string) {
    const { data } = await http.post(`/admin/dlq/${encodeURIComponent(id)}/discard`);
    return data;
  },
  async users() {
    const { data } = await http.get('/admin/users');
    return normList<User>(data);
  },
  async createUser(input: NewUserInput) {
    const { data } = await http.post('/admin/users', clean(input));
    return norm<User>(data);
  },

  // Health lives at the API origin root (/health) per the brief; fall back to /api/health.
  async health(): Promise<Health> {
    const explicit = import.meta.env.VITE_HEALTH_URL as string | undefined;
    const candidates = explicit
      ? [explicit]
      : [`${new URL(API_URL, window.location.href).origin}/health`, `${API_URL}/health`];
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const { data } = await axios.get(url, { timeout: 5000 });
        if (data && typeof data === 'object' && 'components' in data) return data as Health;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error('Health endpoint not found');
  },
};
