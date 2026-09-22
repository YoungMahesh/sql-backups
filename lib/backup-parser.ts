import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

function isMatchingTable(dumpTable: string, requestedTable: string): boolean {
  if (dumpTable === requestedTable) return true;
  if (dumpTable === `public.${requestedTable}`) return true;
  if (requestedTable === `public.${dumpTable}`) return true;
  return false;
}

/**
 * Extracts the `CREATE TABLE` statement for `tableName` from a gzipped dump
 * stream produced by the writers in `mysql-backup.ts` or `postgres-backup.ts`.
 *
 * Returns null if the table is not present in the dump. Returns the verbatim
 * SQL string (including any internal whitespace) when found.
 *
 * Supports both MySQL (`table`) and PostgreSQL (`schema.table`) dumps.
 * Skips view and trigger sections transparently.
 */
export async function extractTableSchema(
  stream: Readable,
  tableName: string
): Promise<string | null> {
  let foundDrop = false;
  for await (const stmt of parseDumpStatements(stream)) {
    if (stmt.kind === "drop_table" && isMatchingTable(stmt.tableName, tableName)) {
      foundDrop = true;
      continue;
    }
    if (!foundDrop) continue;
    if (stmt.kind === "create_table" && isMatchingTable(stmt.tableName, tableName)) {
      return stmt.sql;
    }
    if (stmt.kind === "drop_table" || stmt.kind === "drop_view" || stmt.kind === "trigger_section_start") {
      return null;
    }
  }
  return null;
}

/**
 * Extracts up to `limit` rows from `tableName` from a gzipped dump stream.
 *
 * Returns null if the table is not present in the dump. Returns an empty
 * array if the table is present but has no rows. Caps results at `limit`;
 * the cap is enforced server-side by this module (the client cannot request
 * more rows than the parser will yield).
 *
 * Supports both MySQL and PostgreSQL batched INSERT statements.
 */
export async function extractTableRows(
  stream: Readable,
  tableName: string,
  limit: number
): Promise<Record<string, unknown>[] | null> {
  let foundDrop = false;
  const collected: Record<string, unknown>[] = [];

  for await (const stmt of parseDumpStatements(stream)) {
    if (stmt.kind === "drop_table" && isMatchingTable(stmt.tableName, tableName)) {
      foundDrop = true;
      continue;
    }
    if (!foundDrop) continue;
    if (stmt.kind === "insert" && isMatchingTable(stmt.tableName, tableName)) {
      for (const row of stmt.rows) {
        collected.push(row);
        if (collected.length >= limit) {
          return collected;
        }
      }
      continue;
    }
    if (stmt.kind === "drop_table" || stmt.kind === "drop_view" || stmt.kind === "trigger_section_start") {
      return collected;
    }
  }

  return foundDrop ? collected : null;
}

type ParsedStatement =
  | { kind: "drop_table"; tableName: string }
  | { kind: "create_table"; tableName: string; sql: string }
  | { kind: "dumping_data"; tableName: string }
  | { kind: "insert"; tableName: string; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: "drop_view"; tableName: string }
  | { kind: "create_view"; sql: string }
  | { kind: "trigger_section_start" };

type ParserState =
  | "outside"
  | "in_trigger"
  | "in_trigger_body"
  | "in_view"
  | "accumulating_create_table"
  | "accumulating_create_view";

async function* parseDumpStatements(
  stream: Readable
): AsyncGenerator<ParsedStatement> {
  const gunzip = createGunzip();
  const rl = createInterface({
    input: stream.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let buffer = "";
  let state: ParserState = "outside";

  try {
    try {
      for await (const rawLine of rl) {
        const line = rawLine;
        const trimmed = line.trim();

        if (state === "in_trigger") {
          if (trimmed === "DELIMITER ;") {
            state = "outside";
          }
          continue;
        }

        if (state === "in_trigger_body") {
          if (trimmed === ";;") {
            continue;
          }
          if (trimmed === "DELIMITER ;") {
            state = "outside";
            continue;
          }
          continue;
        }

        if (state === "in_view") {
          buffer += line + "\n";
          if (trimmed.endsWith(";")) {
            yield { kind: "create_view", sql: stripTrailingSemicolon(buffer.trim()) };
            buffer = "";
            state = "outside";
          }
          continue;
        }

        if (state === "accumulating_create_table") {
          buffer += line + "\n";
          if (trimmed.endsWith(";")) {
            const sql = stripTrailingSemicolon(buffer.trim());
            const name = extractCreateTableName(sql);
            if (name) {
              yield { kind: "create_table", tableName: name, sql };
            }
            buffer = "";
            state = "outside";
          }
          continue;
        }

        if (state === "accumulating_create_view") {
          buffer += line + "\n";
          if (trimmed.endsWith(";")) {
            yield { kind: "create_view", sql: stripTrailingSemicolon(buffer.trim()) };
            buffer = "";
            state = "outside";
          }
          continue;
        }

        if (trimmed === "") continue;

        if (trimmed.startsWith("-- Triggers for database")) {
          state = "in_trigger";
          yield { kind: "trigger_section_start" };
          continue;
        }

        const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)$/);
        if (delimMatch) {
          if (delimMatch[1] === ";;") {
            state = "in_trigger_body";
            yield { kind: "trigger_section_start" };
          } else if (delimMatch[1] === ";") {
            state = "outside";
          }
          continue;
        }

        const dropTableName = parseDropTable(trimmed);
        if (dropTableName) {
          yield { kind: "drop_table", tableName: dropTableName };
          continue;
        }

        const dropViewName = parseDropView(trimmed);
        if (dropViewName) {
          yield { kind: "drop_view", tableName: dropViewName };
          state = "in_view";
          continue;
        }

        if (trimmed.startsWith("CREATE TABLE")) {
          if (trimmed.endsWith(";")) {
            const sql = stripTrailingSemicolon(trimmed);
            const name = extractCreateTableName(sql);
            if (name) yield { kind: "create_table", tableName: name, sql };
          } else {
            state = "accumulating_create_table";
            buffer = line + "\n";
          }
          continue;
        }

        if (trimmed.startsWith("CREATE VIEW")) {
          if (trimmed.endsWith(";")) {
            yield { kind: "create_view", sql: stripTrailingSemicolon(trimmed) };
          } else {
            state = "accumulating_create_view";
            buffer = line + "\n";
          }
          continue;
        }

        const dumpingDataName = parseDumpingData(trimmed);
        if (dumpingDataName) {
          yield { kind: "dumping_data", tableName: dumpingDataName };
          continue;
        }

        const insert = parseInsertLine(trimmed);
        if (insert) {
          yield insert;
          continue;
        }
      }
    } catch {
    }
  } finally {
    rl.close();
    gunzip.destroy();
  }
}

function parseDropTable(line: string): string | null {
  const mysqlMatch = line.match(/^DROP TABLE IF EXISTS `((?:[^`]|``)+)`;?$/i);
  if (mysqlMatch) {
    return mysqlMatch[1].replace(/``/g, "`");
  }
  const pgQualifiedMatch = line.match(
    /^DROP TABLE IF EXISTS "((?:[^"]|"")+)"\."((?:[^"]|"")+)"(?:\s+CASCADE)?;\s*$/i
  );
  if (pgQualifiedMatch) {
    return `${pgQualifiedMatch[1].replace(/""/g, '"')}.${pgQualifiedMatch[2].replace(/""/g, '"')}`;
  }
  const pgMatch = line.match(/^DROP TABLE IF EXISTS "((?:[^"]|"")+)"(?:\s+CASCADE)?;\s*$/i);
  if (pgMatch) {
    return pgMatch[1].replace(/""/g, '"');
  }
  return null;
}

function parseDropView(line: string): string | null {
  const mysqlMatch = line.match(/^DROP VIEW IF EXISTS `((?:[^`]|``)+)`;?$/i);
  if (mysqlMatch) {
    return mysqlMatch[1].replace(/``/g, "`");
  }
  const pgQualifiedMatch = line.match(
    /^DROP VIEW IF EXISTS "((?:[^"]|"")+)"\."((?:[^"]|"")+)"(?:\s+CASCADE)?;\s*$/i
  );
  if (pgQualifiedMatch) {
    return `${pgQualifiedMatch[1].replace(/""/g, '"')}.${pgQualifiedMatch[2].replace(/""/g, '"')}`;
  }
  const pgMatch = line.match(/^DROP VIEW IF EXISTS "((?:[^"]|"")+)"(?:\s+CASCADE)?;\s*$/i);
  if (pgMatch) {
    return pgMatch[1].replace(/""/g, '"');
  }
  return null;
}

function parseDumpingData(line: string): string | null {
  const mysqlMatch = line.match(/^-- Dumping data for table `([^`]+)`$/);
  if (mysqlMatch) {
    return mysqlMatch[1].replace(/``/g, "`");
  }
  const pgQualifiedMatch = line.match(
    /^-- Dumping data for table "((?:[^"]|"")+)"\."((?:[^"]|"")+)"$/
  );
  if (pgQualifiedMatch) {
    return `${pgQualifiedMatch[1].replace(/""/g, '"')}.${pgQualifiedMatch[2].replace(/""/g, '"')}`;
  }
  const pgMatch = line.match(/^-- Dumping data for table "((?:[^"]|"")+)"$/);
  if (pgMatch) {
    return pgMatch[1].replace(/""/g, '"');
  }
  return null;
}

function extractCreateTableName(sql: string): string | null {
  const mysqlMatch = sql.match(/^CREATE TABLE `((?:[^`]|``)+)`/i);
  if (mysqlMatch) {
    return mysqlMatch[1].replace(/``/g, "`");
  }
  const pgQualifiedMatch = sql.match(
    /^CREATE TABLE (?:IF NOT EXISTS )?"((?:[^"]|"")+)"\."((?:[^"]|"")+)"/i
  );
  if (pgQualifiedMatch) {
    return `${pgQualifiedMatch[1].replace(/""/g, '"')}.${pgQualifiedMatch[2].replace(/""/g, '"')}`;
  }
  const pgMatch = sql.match(/^CREATE TABLE (?:IF NOT EXISTS )?"((?:[^"]|"")+)"/i);
  if (pgMatch) {
    return pgMatch[1].replace(/""/g, '"');
  }
  return null;
}

function stripTrailingSemicolon(sql: string): string {
  return sql.endsWith(";") ? sql.slice(0, -1) : sql;
}

function parseInsertLine(line: string): ParsedStatement | null {
  let tableName: string | null = null;
  let columnsPart = "";
  let valuesPart = "";

  const mysqlMatch = line.match(/^INSERT INTO `((?:[^`]|``)+)` \((.*)\) VALUES\s+(.+);$/i);
  if (mysqlMatch) {
    tableName = mysqlMatch[1].replace(/``/g, "`");
    columnsPart = mysqlMatch[2];
    valuesPart = mysqlMatch[3];
  } else {
    const pgQualifiedMatch = line.match(
      /^INSERT INTO "((?:[^"]|"")+)"\."((?:[^"]|"")+)" \((.*)\) VALUES\s+(.+);$/i
    );
    if (pgQualifiedMatch) {
      tableName = `${pgQualifiedMatch[1].replace(/""/g, '"')}.${pgQualifiedMatch[2].replace(/""/g, '"')}`;
      columnsPart = pgQualifiedMatch[3];
      valuesPart = pgQualifiedMatch[4];
    } else {
      const pgMatch = line.match(/^INSERT INTO "((?:[^"]|"")+)" \((.*)\) VALUES\s+(.+);$/i);
      if (pgMatch) {
        tableName = pgMatch[1].replace(/""/g, '"');
        columnsPart = pgMatch[2];
        valuesPart = pgMatch[3];
      }
    }
  }

  if (!tableName) return null;

  const rawColumns = parseColumnList(columnsPart);
  const columns = rawColumns.map(parseColumnIdentifier);
  const tuples = parseValuesList(valuesPart);
  const rows: Record<string, unknown>[] = tuples.map((tuple) => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = i < tuple.length ? parseSqlValue(tuple[i]) : null;
    }
    return row;
  });

  return { kind: "insert", tableName, columns, rows };
}

function parseColumnIdentifier(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replace(/``/g, "`");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function parseColumnList(input: string): string[] {
  const cols: string[] = [];
  let i = 0;
  let current = "";
  let inString = false;
  while (i < input.length) {
    const c = input[i];
    if (inString) {
      current += c;
      if (c === "\\" && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (c === "'") inString = false;
      i++;
      continue;
    }
    if (c === "'") {
      current += c;
      inString = true;
      i++;
      continue;
    }
    if (c === ",") {
      cols.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += c;
    i++;
  }
  if (current.trim()) cols.push(current.trim());
  return cols;
}

/**
 * Lexes the textual body of an SQL VALUES list into one tuple per row.
 * Accepts e.g. `(1, 'Alice'), (2, 'Bob')`.
 * Supports both MySQL and PostgreSQL string literal escaping.
 */
export function parseValuesList(input: string): string[][] {
  const tuples: string[][] = [];
  let i = 0;
  let currentTuple: string[] | null = null;
  let currentValue = "";
  let inString = false;
  let tupleDepth = 0;

  function flushValue() {
    if (currentTuple && currentValue !== "") {
      currentTuple.push(currentValue.trim());
    }
    currentValue = "";
  }

  while (i < input.length) {
    const c = input[i];

    if (inString) {
      if (c === "\\" && i + 1 < input.length) {
        currentValue += c + input[i + 1];
        i += 2;
        continue;
      }
      if (c === "'" && i + 1 < input.length && input[i + 1] === "'") {
        currentValue += "''";
        i += 2;
        continue;
      }
      if (c === "'") {
        currentValue += c;
        inString = false;
        i++;
        continue;
      }
      currentValue += c;
      i++;
      continue;
    }

    if (c === "'") {
      currentValue += c;
      inString = true;
      i++;
      continue;
    }

    if (c === "(") {
      if (tupleDepth === 0) {
        currentTuple = [];
      }
      tupleDepth++;
      i++;
      continue;
    }

    if (c === ")") {
      tupleDepth--;
      if (tupleDepth === 0) {
        flushValue();
        if (currentTuple) tuples.push(currentTuple);
        currentTuple = null;
      }
      i++;
      continue;
    }

    if (c === "," && tupleDepth === 1) {
      flushValue();
      i++;
      continue;
    }

    if (tupleDepth >= 1) {
      currentValue += c;
    }
    i++;
  }

  return tuples;
}

/**
 * Converts a single SQL literal into a plain JavaScript value.
 * Supports MySQL and PostgreSQL values (NULL, booleans, numeric, bytea, JSON, strings).
 */
export function parseSqlValue(token: string): unknown {
  const trimmed = token.trim();
  if (trimmed === "NULL") return null;
  if (trimmed === "'0'") return false;
  if (trimmed === "'1'") return true;
  if (trimmed === "TRUE" || trimmed === "true") return true;
  if (trimmed === "FALSE" || trimmed === "false") return false;

  if (trimmed.startsWith("X'") && trimmed.endsWith("'") && trimmed.length >= 4) {
    return Buffer.from(trimmed.slice(2, -1), "hex");
  }

  if (trimmed.startsWith("'\\x") && trimmed.endsWith("'") && trimmed.length >= 4) {
    return Buffer.from(trimmed.slice(3, -1), "hex");
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    const unescaped = unescapeSqlString(inner);
    if (
      (unescaped.startsWith("{") && unescaped.endsWith("}")) ||
      (unescaped.startsWith("[") && unescaped.endsWith("]"))
    ) {
      try {
        return JSON.parse(unescaped);
      } catch {
      }
    }
    return unescaped;
  }

  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);

  return trimmed;
}

function unescapeSqlString(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'" && i + 1 < s.length && s[i + 1] === "'") {
      result += "'";
      i += 2;
      continue;
    }
    if (s[i] === "\\" && i + 1 < s.length) {
      const c = s[i + 1];
      switch (c) {
        case "\\":
          result += "\\";
          break;
        case "'":
          result += "'";
          break;
        case "0":
          result += "\0";
          break;
        case "n":
          result += "\n";
          break;
        case "r":
          result += "\r";
          break;
        case "Z":
          result += "\x1a";
          break;
        default:
          result += c;
      }
      i += 2;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}
