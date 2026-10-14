/**
 * Finds tests in RPGLE free-form source.
 *
 * A test is any procedure declared with EXPORT whose name starts with "test"
 * (case-insensitive). setUp, tearDown, setUpSuite and tearDownSuite are
 * hooks. Directives are comment lines of the form  //#NAME: value
 */
export interface TestProcedure {
  /** Name as written in the source (used for display). */
  name: string;
  /** Name as exported by the service program (upper case unless EXTPROC). */
  exportName: string;
  /** Zero-based line of the DCL-PROC. */
  line: number;
}

export interface SuiteDirectives {
  bndsrvpgm: string[];
  bnddir: string[];
  libl: string[];
  incdir: string[];
  testObject?: string;
}

export interface ParsedSuite {
  tests: TestProcedure[];
  hooks: string[];
  directives: SuiteDirectives;
}

const PROC_RE = /^\s*dcl-proc\s+([a-z_$#@][a-z0-9_$#@]*)\b(.*)$/i;
const EXTPROC_RE = /\bextproc\s*\(\s*'([^']+)'\s*\)/i;
const DIRECTIVE_RE = /^\s*\/\/\s*#(BNDSRVPGM|BNDDIR|LIBL|INCDIR|TESTOBJ)\s*:\s*(.+?)\s*$/i;
const HOOKS = ['SETUP', 'TEARDOWN', 'SETUPSUITE', 'TEARDOWNSUITE'];

function stripComment(line: string): string {
  const idx = line.indexOf('//');
  return idx >= 0 ? line.substring(0, idx) : line;
}

export function parseSuite(text: string): ParsedSuite {
  const lines = text.split(/\r?\n/);
  const tests: TestProcedure[] = [];
  const hooks: string[] = [];
  const directives: SuiteDirectives = { bndsrvpgm: [], bnddir: [], libl: [], incdir: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const d = DIRECTIVE_RE.exec(line);
    if (d) {
      const key = d[1].toUpperCase();
      const value = d[2];
      switch (key) {
        case 'BNDSRVPGM': directives.bndsrvpgm.push(...splitList(value).map(v => v.toUpperCase())); break;
        case 'BNDDIR': directives.bnddir.push(...splitList(value).map(v => v.toUpperCase())); break;
        case 'LIBL': directives.libl.push(...splitList(value).map(v => v.toUpperCase())); break;
        case 'INCDIR': directives.incdir.push(...value.split(',').map(v => v.trim()).filter(Boolean)); break;
        case 'TESTOBJ': directives.testObject = value.trim().toUpperCase(); break;
      }
      continue;
    }

    const m = PROC_RE.exec(stripComment(line));
    if (!m) { continue; }
    const name = m[1];
    const rest = m[2];
    if (!/\bexport\b/i.test(rest)) { continue; }

    const upper = name.toUpperCase();
    const extproc = EXTPROC_RE.exec(rest);
    const exportName = extproc ? extproc[1] : upper;

    if (HOOKS.includes(upper)) {
      hooks.push(upper);
    } else if (upper.startsWith('TEST')) {
      tests.push({ name, exportName, line: i });
    }
  }
  return { tests, hooks, directives };
}

function splitList(value: string): string[] {
  return value.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
}

/** Derive a 10-character service program name for a suite. */
export function deriveTestObject(baseName: string): string {
  const stem = baseName.split('.')[0].toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return ('T' + (stem || 'SUITE')).substring(0, 10);
}

export function isRpgPath(p: string): boolean {
  return /\.(sql)?rpgle$/i.test(p);
}
