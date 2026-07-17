import * as os from 'os';
import * as path from 'path';

export function stripSurroundingQuotes(value: string): string {
  if (!value) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
    return value.slice(1, -1);
  }
  return value;
}

export function expandHome(value: string): string {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function normalizeInputForFs(value: string): string {
  if (typeof value !== 'string') return value;
  let v = value.trim();
  v = stripSurroundingQuotes(v);
  // handle file:// URIs
  if (v.startsWith('file://')) {
    try {
      // Node's file URL parsing
      const url = new URL(v);
      return url.pathname;
    } catch (e) {
      // fallthrough
    }
  }

  v = expandHome(v);
  // Normalize separators to platform default
  v = v.replace(/\\/g, path.sep).replace(/\//g, path.sep);
  return v;
}
