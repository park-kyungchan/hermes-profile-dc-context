// Contract-specific decoders are the runtime source of truth; exported types are inferred.
import { dataSnapshot } from '../review/data-snapshot';
export class ContractError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new ContractError(code); };
const capture = (value: unknown): any => { try { return dataSnapshot(value); } catch { return fail('INVALID_DATA'); } };
const ensure = (ok: unknown, code: string): void => { if (!ok) fail(code); };
function object(value: unknown, fields: readonly string[]) {
  value = capture(value);
  ensure(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_OBJECT");
  const obj = value as Record<string, unknown>;
  ensure(Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null, "INVALID_OBJECT");
  ensure(Object.keys(obj).every(k => fields.includes(k)), "UNKNOWN_FIELD");
  ensure(fields.every(k => Object.hasOwn(obj, k)), "MISSING_FIELD");
  return obj;
}
function text(value: unknown, max = 4096): string {
  ensure(typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max, "INVALID_TEXT");
  return value as string;
}
function id(value: unknown): string {
  const s = text(value, 128);
  ensure(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(s), "INVALID_IDENTIFIER");
  return s;
}
function integer(value: unknown, min = 1): number {
  ensure(typeof value === "number" && Number.isSafeInteger(value) && value >= min, "INVALID_INTEGER");
  return value as number;
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  ensure(typeof value === "string" && values.includes(value), "INVALID_ENUM");
  return value as T[number];
}
function list<T>(value: unknown, parse: (item: unknown) => T, max = 128, min = 0): T[] {
  value = capture(value);
  ensure(Array.isArray(value) && value.length >= min && value.length <= max, "INVALID_ARRAY");
  const items = value as unknown[], decoded: T[] = [];
  for (let index = 0; index < items.length; index++) {
    ensure(Object.hasOwn(items, index), "INVALID_ARRAY");
    decoded.push(parse(items[index]));
  }
  return decoded;
}
function unique<T>(values: T[]): T[] {
  ensure(new Set(values).size === values.length, "DUPLICATE_VALUE");
  return values;
}
function literal(value: unknown, expected: string) { ensure(value === expected, "INVALID_SCHEMA"); return expected; }

export function parseScope(value: unknown) {
  value = capture(value);
  const tag = value !== null && typeof value === "object" ? (value as Record<string, unknown>).kind : undefined;
  if (tag === "shared") {
    const o = object(value, ["kind", "profile"]);
    return { kind: "shared" as const, profile: id(o.profile) };
  }
  if (tag === "project") {
    const o = object(value, ["kind", "profile", "projectId"]);
    return { kind: "project" as const, profile: id(o.profile), projectId: id(o.projectId) };
  }
  const o = object(value, ["kind", "profile", "projectId", "workstreamId"]);
  ensure(o.kind === "workstream", "INVALID_SCOPE");
  return { kind: "workstream" as const, profile: id(o.profile), projectId: id(o.projectId), workstreamId: id(o.workstreamId) };
}
export function parseSource(value: unknown) {
  value = capture(value);
  const tag = value !== null && typeof value === "object" ? (value as Record<string, unknown>).kind : undefined;
  const fields = tag === "clarification"
    ? ["id", "kind", "sessionId", "messageId", "toolCallId", "responseIndex", "contentSha256"]
    : ["id", "kind", "sessionId", "messageId", "contentSha256"];
  const o = object(value, fields);
  const digest = text(o.contentSha256, 64);
  ensure(/^[a-f0-9]{64}$/u.test(digest), "INVALID_DIGEST");
  const common = { id: id(o.id), sessionId: id(o.sessionId), messageId: integer(o.messageId), contentSha256: digest };
  if (tag === "clarification") return { ...common, kind: "clarification" as const, toolCallId: text(o.toolCallId, 256), responseIndex: integer(o.responseIndex, 0) };
  ensure(o.kind === "user-message", "INVALID_SOURCE_KIND");
  return { ...common, kind: "user-message" as const };
}
export function parseDecision(value: unknown) {
  const o = object(value, ["id", "revision", "topic", "scope", "kind", "statement", "sourceIds", "supersedes"]);
  return {
    id: id(o.id), revision: integer(o.revision), topic: id(o.topic), scope: parseScope(o.scope),
    kind: choice(o.kind, ["confirmed-direction", "proposal", "historical-authorization"] as const),
    statement: text(o.statement), sourceIds: unique(list(o.sourceIds, id, 16, 1)),
    supersedes: unique(list(o.supersedes, x => integer(x), 32)),
  };
}
export function parseCandidate(value: unknown) {
  const o = object(value, ["schema", "stage", "meaningStatus", "sources", "decisions"]);
  literal(o.schema, "backend.intent-context.candidate.v1");
  ensure(o.stage === "candidate", "UNSUPPORTED_STAGE");
  ensure(o.meaningStatus === "curated-user-source-interpretations", "UNSUPPORTED_MEANING_STATUS");
  const sources = list(o.sources, parseSource, 128, 1);
  const decisions = list(o.decisions, parseDecision, 128, 1);
  unique(sources.map(s => s.id));
  unique(decisions.map(d => `${d.id}@${d.revision}`));
  const sourceIds = new Set(sources.map(s => s.id));
  ensure(decisions.every(d => d.sourceIds.every(s => sourceIds.has(s))), "UNKNOWN_SOURCE_REFERENCE");
  const sourceById = new Map(sources.map(s => [s.id, s]));
  // Descriptor IDs may alias evidence; occurrence identity cannot alias contradictory bytes.
  // A native row has one kind/call/content even when it contains multiple response slots.
  const rows = new Map<string, string>(), occurrences = new Map<string, string>();
  for (const s of sources) {
    const row = JSON.stringify([s.sessionId, s.messageId]);
    const claim = JSON.stringify([s.kind, s.kind === "clarification" ? s.toolCallId : null, s.contentSha256]);
    ensure(!rows.has(row) || rows.get(row) === claim, "CONTRADICTORY_SOURCE_OCCURRENCE");
    rows.set(row, claim);
    const occurrence = s.kind === "clarification"
      ? JSON.stringify([s.kind, s.sessionId, s.toolCallId, s.responseIndex])
      : JSON.stringify([s.kind, s.sessionId, s.messageId]);
    ensure(!occurrences.has(occurrence) || occurrences.get(occurrence) === s.contentSha256, "CONTRADICTORY_SOURCE_OCCURRENCE");
    occurrences.set(occurrence, s.contentSha256);
  }
  const anchor = (sourceId: string) => {
    const s = sourceById.get(sourceId)!;
    // Native compaction can copy a row without creating a new user answer.
    // Clarification occurrence identity is its call + response slot, not the row ID.
    // Direct chat has no call ID here: identical content is conservatively not new evidence.
    return s.kind === "clarification"
      ? JSON.stringify([s.kind, s.sessionId, s.toolCallId, s.responseIndex])
      : JSON.stringify([s.kind, s.sessionId, s.contentSha256]);
  };
  for (const d of decisions) {
    const siblings = decisions.filter(x => x.id === d.id);
    ensure(siblings.every(x => JSON.stringify(x.scope) === JSON.stringify(d.scope)), "DECISION_SCOPE_CHANGED");
    ensure(siblings.every(x => x.topic === d.topic), "DECISION_TOPIC_CHANGED");
    for (const revision of d.supersedes) {
      const previous = siblings.find(x => x.revision === revision);
      ensure(previous && revision < d.revision, "INVALID_SUPERSESSION_TARGET");
      if (d.kind === "confirmed-direction") {
        ensure(previous!.kind === "confirmed-direction", "INVALID_SUPERSESSION_TARGET");
      }
    }
  }
  // The validated graph is strictly descending within one decision identity.
  // Collect its entire predecessor closure before resolver selection drops history.
  for (const d of decisions) {
    if (d.kind !== "confirmed-direction" || d.supersedes.length === 0) continue;
    const siblings = decisions.filter(x => x.id === d.id);
    const oldAnchors = new Set<string>(), visited = new Set<number>();
    const pending = [...d.supersedes];
    while (pending.length) {
      const revision = pending.pop()!;
      if (visited.has(revision)) continue;
      visited.add(revision);
      const previous = siblings.find(x => x.revision === revision)!;
      for (const sourceId of previous.sourceIds) oldAnchors.add(anchor(sourceId));
      pending.push(...previous.supersedes);
    }
    ensure(d.sourceIds.some(s => !oldAnchors.has(anchor(s))), "SUPERSESSION_NEEDS_NEW_SOURCE");
  }
  return { schema: "backend.intent-context.candidate.v1" as const, stage: "candidate" as const,
    meaningStatus: "curated-user-source-interpretations" as const, sources, decisions };
}
export function parseRequest(value: unknown) {
  const o = object(value, ["schema", "purpose", "profile", "projectId", "workstreamId", "topics"]);
  literal(o.schema, "backend.intent-context.request.v1");
  return { schema: "backend.intent-context.request.v1" as const, purpose: text(o.purpose), profile: id(o.profile),
    projectId: id(o.projectId), workstreamId: id(o.workstreamId), topics: unique(list(o.topics, id, 32, 1)) };
}
export function parseNativeRow(value: unknown) {
  const o = object(value, ["id", "session_id", "role", "tool_name", "tool_call_id", "content", "timestamp"]);
  ensure(typeof o.timestamp === "number" && Number.isFinite(o.timestamp) && o.timestamp >= 0, "INVALID_SOURCE_TIME");
  return { id: integer(o.id), session_id: id(o.session_id), role: text(o.role, 32),
    tool_name: o.tool_name === null ? null : text(o.tool_name, 128),
    tool_call_id: o.tool_call_id === null ? null : text(o.tool_call_id, 256),
    content: text(o.content, 65536), timestamp: o.timestamp as number };
}
export function parseNativeRows(value: unknown) {
  const rows = list(value, parseNativeRow);
  unique(rows.map(r => r.id));
  return rows;
}
export type Candidate = ReturnType<typeof parseCandidate>;
export type Decision = ReturnType<typeof parseDecision>;
export type Source = ReturnType<typeof parseSource>;
export type Scope = ReturnType<typeof parseScope>;
export type Request = ReturnType<typeof parseRequest>;
export type NativeRow = ReturnType<typeof parseNativeRow>;
