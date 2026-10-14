import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { IBMiSession, CommandResult, clq, shq, isObjectName } from './ibmi';
import { parseSuite, deriveTestObject } from './discovery';
import { Settings } from './settings';

export type TestStatus = 'PASSED' | 'FAILED' | 'ERROR' | 'MISSING' | 'SKIPPED';

export interface TestResult {
  name: string;
  exportName: string;
  status: TestStatus;
  asserts: number;
  message: string;
  durationMs: number;
  line?: number;
}

export interface CompileMessage {
  msgId: string;
  severity: number;
  line: number;
  column: number;
  text: string;
  inMainSource: boolean;
}

export interface SuiteResult {
  label: string;
  uri: string;
  testObject: string;
  library: string;
  compiled: boolean;
  compileLog: string;
  compileMessages: CompileMessage[];
  tests: TestResult[];
  durationMs: number;
  error?: string;
}

export type Log = (line: string) => void;

/** Length of RUNTEST's testList parameter. */
const LIST_LENGTH = 2000;

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').substring(0, 17);
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase().substring(0, 9);
  return (stamp + rand).substring(0, 26);
}

export function frameworkDir(s: Settings): string {
  return `${s.remoteDir}/framework`;
}

export async function frameworkInstalled(session: IBMiSession, s: Settings): Promise<boolean> {
  const r = await session.runCL(`CHKOBJ OBJ(${s.library}/RUNTEST) OBJTYPE(*PGM)`);
  return r.code === 0;
}

export async function purgeOldResults(session: IBMiSession, s: Settings): Promise<void> {
  if (s.keepResultsDays <= 0) { return; }
  try {
    await session.sql(`DELETE FROM ${s.library}.IUNITRES WHERE STARTED < CURRENT TIMESTAMP - ${Math.floor(s.keepResultsDays)} DAYS`);
  } catch {
    // housekeeping only
  }
}

function describeCommand(cl: string, r: CommandResult): string {
  const out = [r.stdout, r.stderr].filter(t => t && t.trim()).join('\n').trim();
  return `> ${cl}\n${out ? out + '\n' : ''}(exit ${r.code})\n`;
}

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------
interface SourceRef {
  label: string;
  baseName: string;
  isSql: boolean;
  srcClause: string;
  incDirs: string[];
}

async function prepareSource(session: IBMiSession, s: Settings, doc: vscode.TextDocument, log: Log): Promise<SourceRef> {
  const uri = doc.uri;
  const isSql = /\.sqlrpgle$/i.test(uri.path) || doc.languageId === 'sqlrpgle';

  // Source member opened through Code for IBM i: member:/[ASP/]LIB/FILE/MBR.EXT
  if (uri.scheme === 'member') {
    const parts = uri.path.split('/').filter(Boolean);
    if (parts.length < 3) {
      throw new Error(`Unrecognised member path ${uri.path}`);
    }
    const [lib, file, mbrExt] = parts.slice(-3).map(p => p.toUpperCase());
    const mbr = mbrExt.split('.')[0];
    return {
      label: `${lib}/${file}(${mbr})`,
      baseName: mbr,
      isSql,
      srcClause: `SRCFILE(${lib}/${file}) SRCMBR(${mbr})`,
      incDirs: []
    };
  }

  // IFS stream file opened through Code for IBM i
  if (uri.scheme === 'streamfile') {
    const p = uri.path;
    return {
      label: p,
      baseName: path.posix.basename(p),
      isSql,
      srcClause: `SRCSTMF(${clq(p)})`,
      incDirs: [path.posix.dirname(p)]
    };
  }

  // Local file (or untitled) - upload it, plus include files beside it
  const isLocal = uri.scheme === 'file';
  const folderKey = isLocal
    ? crypto.createHash('sha1').update(path.dirname(uri.fsPath)).digest('hex').substring(0, 10)
    : 'untitled';
  const remoteDir = `${s.remoteDir}/tests/${folderKey}`;
  const baseName = isLocal ? path.basename(uri.fsPath) : 'untitled.test.rpgle';
  const remotePath = `${remoteDir}/${baseName}`;

  log(`Uploading ${baseName} to ${remotePath}`);
  await session.writeFile(remotePath, doc.getText());

  if (isLocal) {
    const dirUri = vscode.Uri.file(path.dirname(uri.fsPath));
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && /\.(rpgleinc|rpginc|inc)$/i.test(name)) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, name));
        await session.writeFile(`${remoteDir}/${name}`, Buffer.from(bytes).toString('utf8'));
      }
    }
  }

  return {
    label: isLocal ? vscode.workspace.asRelativePath(uri) : baseName,
    baseName,
    isSql,
    srcClause: `SRCSTMF(${clq(remotePath)})`,
    incDirs: [remoteDir]
  };
}

// ---------------------------------------------------------------------------
// Compile helpers
// ---------------------------------------------------------------------------
function moduleCommand(src: SourceRef, lib: string, obj: string, incDirs: string[]): string {
  const dirs = incDirs.slice(0, 32);
  if (src.isSql) {
    // Stream files are uploaded as UTF-8 (CCSID 1208), which the RPG compiler
    // rejects with its default TGTCCSID(*SRC) (RNS9380), so pass *JOB through.
    const ccsidOpt = src.srcClause.startsWith('SRCSTMF') ? ' TGTCCSID(*JOB)' : '';
    const compileOpt = `INCDIR(${dirs.map(clq).join(' ')})${ccsidOpt}`;
    return `CRTSQLRPGI OBJ(${lib}/${obj}) ${src.srcClause} OBJTYPE(*MODULE) COMMIT(*NONE) ` +
      `OPTION(*EVENTF) DBGVIEW(*SOURCE) RPGPPOPT(*LVL2) REPLACE(*YES) COMPILEOPT(${clq(compileOpt)})`;
  }
  const ccsid = src.srcClause.startsWith('SRCSTMF') ? ' TGTCCSID(*JOB)' : '';
  return `CRTRPGMOD MODULE(${lib}/${obj}) ${src.srcClause} INCDIR(${dirs.map(clq).join(' ')}) ` +
    `OPTION(*EVENTF *SRCSTMT) DBGVIEW(*SOURCE)${ccsid} REPLACE(*YES)`;
}

function qualify(name: string): string {
  return name.includes('/') ? name : `*LIBL/${name}`;
}

function serviceProgramCommand(lib: string, obj: string, bndsrvpgm: string[], bnddir: string[]): string {
  const srvpgms = [`(${lib}/TESTASSERT)`, ...bndsrvpgm.map(b => `(${qualify(b)})`)].join(' ');
  const dirs = bnddir.length ? ` BNDDIR(${bnddir.map(qualify).join(' ')})` : '';
  return `CRTSRVPGM SRVPGM(${lib}/${obj}) MODULE(${lib}/${obj}) EXPORT(*ALL) ` +
    `BNDSRVPGM(${srvpgms})${dirs} ACTGRP(*CALLER) REPLACE(*YES) TEXT(${clq('IBM i Unit test suite')})`;
}

/** Read the compiler event file (OPTION(*EVENTF)) for a module. */
async function readEventFile(session: IBMiSession, s: Settings, lib: string, obj: string): Promise<CompileMessage[]> {
  const tmp = `${s.remoteDir}/evf_${obj}_${Date.now()}.txt`;
  const cl = `CPYTOSTMF FROMMBR('/QSYS.LIB/${lib}.LIB/EVFEVENT.FILE/${obj}.MBR') ` +
    `TOSTMF(${clq(tmp)}) STMFOPT(*REPLACE) STMFCCSID(1208) ENDLINFMT(*LF)`;
  const r = await session.shell(
    `system "${cl.replace(/[\\"$`]/g, '\\$&')}" >/dev/null 2>&1; cat ${shq(tmp)} 2>/dev/null; rm -f ${shq(tmp)}`);
  return parseEventFile(r.stdout);
}

export function parseEventFile(text: string): CompileMessage[] {
  const messages: CompileMessage[] = [];
  let mainFileId: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/);
    if (tokens[0] === 'FILEID' && !mainFileId && tokens.length > 2) {
      mainFileId = tokens[2];
    }
    if (tokens[0] === 'ERROR' && tokens.length >= 13) {
      const severity = parseInt(tokens[11], 10);
      if (isNaN(severity) || severity < 10) { continue; }
      messages.push({
        msgId: tokens[9],
        severity,
        line: parseInt(tokens[5], 10) || 0,
        column: parseInt(tokens[6], 10) || 0,
        text: tokens.slice(13).join(' '),
        inMainSource: tokens[2] === mainFileId
      });
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Run one suite: compile -> bind -> RUNTEST -> read IUNITRES
// ---------------------------------------------------------------------------
export async function runSuite(
  session: IBMiSession,
  s: Settings,
  doc: vscode.TextDocument,
  selectedExports: string[] | undefined,
  runId: string,
  log: Log
): Promise<SuiteResult> {
  const started = Date.now();
  const parsed = parseSuite(doc.getText());
  const wanted = selectedExports && selectedExports.length
    ? parsed.tests.filter(t => selectedExports.includes(t.exportName))
    : parsed.tests;

  const result: SuiteResult = {
    label: doc.uri.path,
    uri: doc.uri.toString(),
    testObject: '',
    library: s.library,
    compiled: false,
    compileLog: '',
    compileMessages: [],
    tests: [],
    durationMs: 0
  };

  const failAll = (status: TestStatus, message: string) => {
    result.tests = wanted.map(t => ({
      name: t.name, exportName: t.exportName, status, asserts: 0, message, durationMs: 0, line: t.line
    }));
  };

  try {
    if (wanted.length === 0) {
      throw new Error('No exported test procedures found (procedure names must start with "test" and have EXPORT).');
    }

    const src = await prepareSource(session, s, doc, log);
    result.label = src.label;
    const obj = parsed.directives.testObject ?? deriveTestObject(src.baseName);
    if (!isObjectName(obj)) {
      throw new Error(`Test object name "${obj}" is not valid. Use //#TESTOBJ: NAME to set one.`);
    }
    result.testObject = obj;

    const libl = [...parsed.directives.libl, ...s.additionalLibraries];
    const incDirs = [...src.incDirs, ...parsed.directives.incdir, frameworkDir(s)];

    // 1. Module
    const modCmd = moduleCommand(src, s.library, obj, incDirs);
    log(`> ${modCmd}`);
    let r = await session.runCL(modCmd, libl);
    result.compileLog += describeCommand(modCmd, r);
    if (r.code !== 0) {
      result.compileMessages = await readEventFile(session, s, s.library, obj);
      const top = result.compileMessages.filter(m => m.severity >= 20).slice(0, 3)
        .map(m => `${m.msgId} line ${m.line}: ${m.text}`).join(' | ');
      throw new Error(`Compile failed${top ? ': ' + top : ' (see compile log)'}`);
    }
    result.compileMessages = await readEventFile(session, s, s.library, obj);

    // 2. Service program
    const srvCmd = serviceProgramCommand(s.library, obj, parsed.directives.bndsrvpgm, parsed.directives.bnddir);
    log(`> ${srvCmd}`);
    r = await session.runCL(srvCmd, libl);
    result.compileLog += describeCommand(srvCmd, r);
    if (r.code !== 0) {
      throw new Error(`CRTSRVPGM failed: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
    }
    result.compiled = true;

    // 3. Run, in batches that fit RUNTEST's 2000-character list
    const batches: string[][] = [];
    let current: string[] = [];
    for (const t of wanted) {
      const next = [...current, t.exportName].join(',');
      if (next.length > LIST_LENGTH && current.length) {
        batches.push(current);
        current = [];
      }
      current.push(t.exportName);
    }
    if (current.length) { batches.push(current); }

    let runOutput = '';
    for (const batch of batches) {
      const list = batch.join(',').padEnd(LIST_LENGTH, ' ');
      const call = `CALL PGM(${s.library}/RUNTEST) PARM(${clq(runId)} ${clq(s.library)} ${clq(obj)} ${clq(list)})`;
      log(`> CALL PGM(${s.library}/RUNTEST) ... ${batch.length} test(s)`);
      r = await session.runCL(call, libl);
      runOutput += describeCommand(`CALL PGM(${s.library}/RUNTEST) (${batch.length} tests)`, r);
    }
    result.compileLog += runOutput;

    // 4. Results
    const rows = await session.sql<Record<string, unknown>>(
      `SELECT TESTNAME, STATUS, ASSERTS, MESSAGE, DURATION_MS FROM ${s.library}.IUNITRES ` +
      `WHERE RUNID = '${runId}' AND TESTLIB = '${s.library}' AND TESTOBJ = '${obj}' ORDER BY SEQ`);

    const byName = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      byName.set(String(get(row, 'TESTNAME')).trim(), row);
    }

    for (const t of wanted) {
      const row = byName.get(t.exportName);
      if (!row) {
        result.tests.push({
          name: t.name, exportName: t.exportName, status: 'ERROR', asserts: 0, durationMs: 0, line: t.line,
          message: 'No result recorded - the runner may have ended abnormally. ' + lastLine(runOutput)
        });
        continue;
      }
      byName.delete(t.exportName);
      result.tests.push({
        name: t.name,
        exportName: t.exportName,
        status: normalizeStatus(get(row, 'STATUS')),
        asserts: Number(get(row, 'ASSERTS')) || 0,
        message: String(get(row, 'MESSAGE') ?? '').trim(),
        durationMs: Number(get(row, 'DURATION_MS')) || 0,
        line: t.line
      });
    }
    // Suite-level rows such as a failing tearDownSuite
    for (const [name, row] of byName) {
      result.tests.push({
        name, exportName: name, status: normalizeStatus(get(row, 'STATUS')),
        asserts: 0, message: String(get(row, 'MESSAGE') ?? '').trim(), durationMs: 0
      });
    }
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    log(`ERROR: ${result.error}`);
    if (result.tests.length === 0) {
      failAll('ERROR', result.error!);
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}

function get(row: Record<string, unknown>, key: string): unknown {
  return row[key] ?? row[key.toLowerCase()];
}

function normalizeStatus(value: unknown): TestStatus {
  const s = String(value ?? '').trim().toUpperCase();
  return (['PASSED', 'FAILED', 'ERROR', 'MISSING', 'SKIPPED'].includes(s) ? s : 'ERROR') as TestStatus;
}

function lastLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('>') && !l.startsWith('(exit'));
  return lines.length ? lines[lines.length - 1] : '';
}
