import { ContractError } from "./contract.ts";

// A deliberately narrow JSON representation for this candidate's public ingress.
// Whitespace formatting is allowed. Duplicate keys, rounded numeric spellings,
// and alternative escaping/key order that would change on re-encoding refuse.
// This is not a universal JSON importer or an RFC canonicalization service.
export function parseLosslessJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const next = stack.pop()!;
    if (++nodes > 8192 || next.depth > 16) throw new ContractError("JSON_STRUCTURE_LIMIT");
    if (next.value && typeof next.value === "object") {
      for (const child of Object.values(next.value)) stack.push({ value: child, depth: next.depth + 1 });
    }
  }
  // Work only on privately parsed JSON; caller objects/getters are not inspected.
  const compact = text.replace(/"(?:\\[\s\S]|[^"\\])*"|\s+/gu, token => token.startsWith('"') ? token : "");
  if (compact !== JSON.stringify(value)) throw new ContractError("NON_CANONICAL_JSON_REPRESENTATION");
  return value;
}
