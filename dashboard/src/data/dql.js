// Lightweight DQL-style query engine for the Home/Discover search page.
// Supports: `field:value`, `field>=value`, `field<=value`, `field>value`,
// `field<value`, bare keywords (free-text across all fields), chained with
// AND. This is NOT full DQL (no OR/NOT/wildcards) — good enough for a demo,
// swap for a real query-string API call when a real search backend is wired in.

const OPERATORS = [">=", "<=", ">", "<", ":"];

function stripQuotes(v) {
  return v.replace(/^"(.*)"$/, "$1");
}

function parseClause(clause) {
  const trimmed = clause.trim();
  for (const op of OPERATORS) {
    const idx = trimmed.indexOf(op);
    if (idx > 0) {
      return {
        field: trimmed.slice(0, idx).trim(),
        op,
        value: stripQuotes(trimmed.slice(idx + op.length).trim()),
      };
    }
  }
  return { field: null, op: null, value: stripQuotes(trimmed) };
}

export function parseQuery(query) {
  if (!query || !query.trim()) return [];
  return query
    .split(/\s+AND\s+/i)
    .map(parseClause)
    .filter((c) => c.value !== "");
}

function matchClause(doc, clause) {
  const { field, op, value } = clause;

  if (!field) {
    // Free text — substring match across every field's stringified value.
    return Object.values(doc).some((v) => String(v).toLowerCase().includes(value.toLowerCase()));
  }

  const actual = doc[field];
  if (actual === undefined) return false;

  switch (op) {
    case ":":
      return String(actual).toLowerCase().includes(value.toLowerCase());
    case ">=":
      return Number(actual) >= Number(value);
    case "<=":
      return Number(actual) <= Number(value);
    case ">":
      return Number(actual) > Number(value);
    case "<":
      return Number(actual) < Number(value);
    default:
      return false;
  }
}

export function runQuery(docs, query) {
  const clauses = parseQuery(query);
  if (clauses.length === 0) return docs;
  return docs.filter((doc) => clauses.every((c) => matchClause(doc, c)));
}

// Terms worth highlighting in the hit table — just the value side of each clause.
export function extractTerms(query) {
  return parseQuery(query)
    .map((c) => c.value)
    .filter(Boolean);
}
