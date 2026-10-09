import { createHash } from "node:crypto";
import { ContractError, parseCandidate, parseRequest, parseNativeRows, type Candidate, type Decision, type Request, type Source, type NativeRow } from "./contract.ts";

type Gap = { code: string; subject: string };
type Selected = Pick<Decision, "id" | "revision" | "topic" | "scope" | "statement" | "sourceIds">;
type Exclusion = { id: string; revision: number; reason: string };
type EvidenceRef = { id: string; sessionId: string; messageId: number; contentSha256: string; responseIndex: number | null };
type Conflict = { decisionId: string; revisions: number[]; sourceIds: string[] };
export function matchesScope(d: Decision, request: Request): boolean {
  const s = d.scope;
  return s.profile === request.profile && (s.kind === "shared" || (s.projectId === request.projectId && (s.kind === "project" || s.workstreamId === request.workstreamId)));
}
function verifySource(source: Source, rows: NativeRow[]): Gap | null {
  const row = rows.find(r => r.id === source.messageId);
  if (!row) return { code: "SOURCE_MISSING", subject: source.id };
  if (row.session_id !== source.sessionId) return { code: "SOURCE_IDENTITY_MISMATCH", subject: source.id };
  if (createHash("sha256").update(row.content).digest("hex") !== source.contentSha256) return { code: "SOURCE_CONTENT_CHANGED", subject: source.id };
  if (source.kind === "user-message") return row.role === "user" ? null : { code: "SOURCE_ROLE_MISMATCH", subject: source.id };
  if (row.role !== "tool" || row.tool_name !== "clarify" || row.tool_call_id !== source.toolCallId) return { code: "SOURCE_IDENTITY_MISMATCH", subject: source.id };
  try {
    const body: unknown = JSON.parse(row.content);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    const record = body as Record<string, unknown>;
    if (record.timed_out === true || !Array.isArray(record.responses)) throw Error();
    const answer = record.responses[source.responseIndex] as Record<string, unknown> | undefined;
    if (!answer || typeof answer !== "object" || typeof answer.question !== "string" || !answer.question.trim()) throw Error();
    const response = answer.user_response;
    if (!(typeof response === "string" && response.trim()) && !(Array.isArray(response) && response.length > 0 && response.every(x => typeof x === "string" && x.trim()))) throw Error();
    return null;
  } catch { return { code: "SOURCE_ANSWER_UNAVAILABLE", subject: source.id }; }
}
const limits = [
  "Candidate source interpretations; not independent semantic acceptance or Wiki promotion.",
  "Pure resolver verifies supplied row identity/bytes; only the native CLI establishes the actual acquisition route.",
  "No native capability, execution permission, source completeness or cross-session adoption is inferred.",
  "Current higher-priority instructions and native effect guards remain in force; existing Hermes/Scrapling implementations are not replaced.",
];
function result(status: string, nextAction: string, decisions: Selected[], sources: EvidenceRef[], exclusions: Exclusion[], gaps: Gap[], purpose: string | null, conflicts: Conflict[] = []) {
  return { schema: "backend.intent-context.result.v1", status, nextAction, purpose,
    requestedSelectionComplete: status === "RESOLVED", authority: "NO_EXECUTION_AUTHORITY", stage: "candidate",
    decisions, sources, exclusions, gaps, conflicts, limits: [...limits] };
}
export function resolveContext(candidateInput: unknown, requestInput: unknown, rowsInput: unknown) {
  let candidate: Candidate, request: Request;
  try { candidate = parseCandidate(candidateInput); request = parseRequest(requestInput); }
  catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return result("REJECTED", "REPAIR_INPUT", [], [], [], [{ code: error.code, subject: "input" }], null);
  }
  const exclusions: Exclusion[] = [];
  const relevant = candidate.decisions.filter(d => {
    const reason = !request.topics.includes(d.topic) ? "TOPIC_NOT_REQUESTED"
      : !matchesScope(d, request) ? "OUT_OF_SCOPE"
      : d.kind !== "confirmed-direction" ? "NOT_CONFIRMED_DIRECTION" : null;
    if (reason) exclusions.push({ id: d.id, revision: d.revision, reason });
    return reason === null;
  });
  let rows: NativeRow[];
  try { rows = parseNativeRows(rowsInput); }
  catch { return result("NEEDS_EVIDENCE", "RECOVER_EVIDENCE", [], [], exclusions, [{ code: "SOURCE_ACQUISITION_INVALID", subject: "source-rows" }], request.purpose); }
  const superseded = new Set(relevant.flatMap(d => d.supersedes.map(r => `${d.id}@${r}`)));
  const heads = relevant.filter(d => {
    if (!superseded.has(`${d.id}@${d.revision}`)) return true;
    exclusions.push({ id: d.id, revision: d.revision, reason: "SUPERSEDED_IN_SCOPE" });
    return false;
  });
  const byId = new Map<string, Decision[]>();
  for (const d of heads) byId.set(d.id, [...(byId.get(d.id) ?? []), d]);
  const conflicts: Conflict[] = [...byId].filter(([, ds]) => ds.length > 1).map(([decisionId, ds]) => ({
    decisionId, revisions: ds.map(d => d.revision), sourceIds: [...new Set(ds.flatMap(d => d.sourceIds))],
  }));
  const conflictingIds = new Set(conflicts.map(c => c.decisionId));
  const requiredIds = new Set(heads.flatMap(d => d.sourceIds));
  const needed = candidate.sources.filter(s => requiredIds.has(s.id));
  const gaps = needed.map(s => verifySource(s, rows)).filter((x): x is Gap => x !== null);
  const failedSources = new Set(gaps.map(g => g.subject));
  const selected = heads.filter(d => !conflictingIds.has(d.id) && d.sourceIds.every(s => !failedSources.has(s)));
  for (const id of conflictingIds) gaps.push({ code: "CONFLICTING_REVISIONS", subject: id });
  const representedTopics = new Set(heads.map(d => d.topic));
  const missingTopics = request.topics.filter(t => !representedTopics.has(t));
  for (const topic of missingTopics) gaps.push({ code: "NO_APPLICABLE_CONFIRMED_DIRECTION", subject: topic });
  // Acquisition integrity takes precedence: unavailable evidence is not a proven intent conflict.
  const status = failedSources.size ? "NEEDS_EVIDENCE" : conflicts.length ? "NEEDS_DECISION" : missingTopics.length ? "SCOPE_UNRESOLVED" : "RESOLVED";
  const next = failedSources.size ? "RECOVER_EVIDENCE" : conflicts.length ? "RESOLVE_DECISION_CONFLICT" : missingTopics.length ? "CONFIRM_SCOPE_OR_TOPIC" : "USE_SELECTED_CONTEXT";
  return result(status, next,
    selected.map(({ id, revision, topic, scope, statement, sourceIds }) => ({ id, revision, topic, scope, statement, sourceIds: [...sourceIds] })),
    needed.filter(s => !failedSources.has(s.id)).map(s => ({ id: s.id, sessionId: s.sessionId, messageId: s.messageId, contentSha256: s.contentSha256, responseIndex: s.kind === "clarification" ? s.responseIndex : null })),
    exclusions, gaps, request.purpose, conflicts);
}
