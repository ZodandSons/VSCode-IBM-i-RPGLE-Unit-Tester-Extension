import * as vscode from 'vscode';
import { IBMiSession, clq } from './ibmi';
import { Settings } from './settings';
import { frameworkDir, Log } from './runner';

interface Step {
  cl: string;
  /** Output pattern that means "failed, but that's fine" (e.g. already exists). */
  allow?: RegExp;
  optional?: boolean;
}

async function runSteps(session: IBMiSession, steps: Step[], log: Log, libl: string[] = []): Promise<void> {
  for (const step of steps) {
    log(`> ${step.cl}`);
    const r = await session.runCL(step.cl, libl);
    const out = `${r.stdout}\n${r.stderr}`.trim();
    if (out) { log(out); }
    if (r.code !== 0 && !step.optional && !(step.allow && step.allow.test(out))) {
      throw new Error(`Command failed: ${step.cl.split(' ')[0]} - ${out.split('\n').pop()}`);
    }
  }
}

/**
 * Confirm a library already exists on the IBM i. The extension no longer
 * creates libraries (many shops do not grant CRTLIB authority); the library
 * must be created beforehand by someone with that authority.
 */
async function requireLibrary(session: IBMiSession, lib: string, purpose: string, log: Log): Promise<void> {
  const cl = `CHKOBJ OBJ(QSYS/${lib}) OBJTYPE(*LIB)`;
  log(`> ${cl}`);
  const r = await session.runCL(cl);
  const out = `${r.stdout}\n${r.stderr}`.trim();
  if (out) { log(out); }
  if (/CPF9802/.test(out)) {
    throw new Error(`You are not authorized to library ${lib}. Ask your administrator for *CHANGE authority to ${lib}.`);
  }
  if (r.code !== 0 || /CPF9801|CPF9810/.test(out)) {
    throw new Error(`Library ${lib} does not exist on the IBM i. It must be created before ${purpose} ` +
      `(for example, ask your administrator to run CRTLIB LIB(${lib})).`);
  }
}

async function upload(session: IBMiSession, source: vscode.Uri, files: string[], remoteDir: string, log: Log,
  transform?: (name: string, text: string) => string): Promise<void> {
  for (const name of files) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(source, name));
    let text = Buffer.from(bytes).toString('utf8');
    if (transform) { text = transform(name, text); }
    log(`Uploading ${name} -> ${remoteDir}/${name}`);
    await session.writeFile(`${remoteDir}/${name}`, text);
  }
}

/** Upload framework sources and build TESTASSERT, RUNTEST and IUNITRES. */
export async function installFramework(session: IBMiSession, s: Settings, extensionUri: vscode.Uri, log: Log): Promise<void> {
  const lib = s.library;
  const dir = frameworkDir(s);
  const src = vscode.Uri.joinPath(extensionUri, 'framework');

  await requireLibrary(session, lib, 'installing the test framework', log);
  await upload(session, src, ['testassert.rpgleinc', 'testassert.rpgle', 'runtest.sqlrpgle'], dir, log);

  const ddlBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(src, 'iunitres.sql'));
  const ddl = Buffer.from(ddlBytes).toString('utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join(' ')
    .replace(/\{LIB\}/g, lib).replace(/\s+/g, ' ').trim();

  await runSteps(session, [
    { cl: `RUNSQL SQL(${clq(ddl)}) COMMIT(*NONE) NAMING(*SQL)` },
    { cl: `RUNSQL SQL(${clq(`CREATE INDEX ${lib}.IUNITRES1 ON ${lib}.IUNITRES (RUNID, TESTOBJ, SEQ)`)}) COMMIT(*NONE) NAMING(*SQL)`, optional: true },
    {
      cl: `CRTRPGMOD MODULE(${lib}/TESTASSERT) SRCSTMF(${clq(dir + '/testassert.rpgle')}) ` +
        `INCDIR(${clq(dir)}) DBGVIEW(*SOURCE) TGTCCSID(*JOB) REPLACE(*YES)`
    },
    {
      cl: `CRTSRVPGM SRVPGM(${lib}/TESTASSERT) MODULE(${lib}/TESTASSERT) EXPORT(*ALL) ACTGRP(*CALLER) ` +
        `REPLACE(*YES) TEXT(${clq('IBM i Unit assertions')})`
    },
    {
      cl: `CRTSQLRPGI OBJ(${lib}/RUNTEST) SRCSTMF(${clq(dir + '/runtest.sqlrpgle')}) OBJTYPE(*MODULE) ` +
        `COMMIT(*NONE) DBGVIEW(*SOURCE) RPGPPOPT(*LVL2) REPLACE(*YES) COMPILEOPT(${clq(`INCDIR(${clq(dir)}) TGTCCSID(*JOB)`)})`
    },
    {
      cl: `CRTPGM PGM(${lib}/RUNTEST) MODULE(${lib}/RUNTEST) BNDSRVPGM((${lib}/TESTASSERT)) BNDDIR(QC2LE) ` +
        `ACTGRP(*NEW) REPLACE(*YES) TEXT(${clq('IBM i Unit test runner')})`
    },
    { cl: `DLTMOD MODULE(${lib}/TESTASSERT)`, optional: true },
    { cl: `DLTMOD MODULE(${lib}/RUNTEST)`, optional: true }
  ], log);
}

export const SAMPLE_FILES = [
  'mathutil.rpgle', 'mathutil_h.rpgleinc',
  'strutil.rpgle', 'strutil_h.rpgleinc',
  'calctax.rpgle',
  'mathutil.test.rpgle', 'strutil.test.rpgle', 'calctax.test.rpgle', 'demo_failures.test.rpgle'
];

/** Compile the sample code-under-test (MATHUTIL, STRUTIL, CALCTAX) into a library. */
export async function buildSamples(session: IBMiSession, s: Settings, extensionUri: vscode.Uri, targetLib: string, log: Log): Promise<void> {
  const dir = `${s.remoteDir}/samples`;
  const src = vscode.Uri.joinPath(extensionUri, 'samples', 'qrpglesrc');
  await requireLibrary(session, targetLib, 'building the samples', log);
  await upload(session, src, SAMPLE_FILES.filter(f => !f.includes('.test.')), dir, log);

  const stmf = (name: string) => clq(`${dir}/${name}`);
  await runSteps(session, [
    { cl: `CRTRPGMOD MODULE(${targetLib}/MATHUTIL) SRCSTMF(${stmf('mathutil.rpgle')}) INCDIR(${clq(dir)}) DBGVIEW(*SOURCE) TGTCCSID(*JOB) REPLACE(*YES)` },
    { cl: `CRTSRVPGM SRVPGM(${targetLib}/MATHUTIL) MODULE(${targetLib}/MATHUTIL) EXPORT(*ALL) REPLACE(*YES) TEXT(${clq('Sample math utilities')})` },
    { cl: `CRTRPGMOD MODULE(${targetLib}/STRUTIL) SRCSTMF(${stmf('strutil.rpgle')}) INCDIR(${clq(dir)}) DBGVIEW(*SOURCE) TGTCCSID(*JOB) REPLACE(*YES)` },
    { cl: `CRTSRVPGM SRVPGM(${targetLib}/STRUTIL) MODULE(${targetLib}/STRUTIL) EXPORT(*ALL) REPLACE(*YES) TEXT(${clq('Sample string utilities')})` },
    { cl: `CRTBNDRPG PGM(${targetLib}/CALCTAX) SRCSTMF(${stmf('calctax.rpgle')}) DBGVIEW(*SOURCE) TGTCCSID(*JOB) REPLACE(*YES) TEXT(${clq('Sample sales tax program')})` },
    { cl: `DLTMOD MODULE(${targetLib}/MATHUTIL)`, optional: true },
    { cl: `DLTMOD MODULE(${targetLib}/STRUTIL)`, optional: true }
  ], log, [targetLib]);
}

/** Copy the sample sources into the workspace, pointing //#LIBL at targetLib. */
export async function copySamplesToWorkspace(extensionUri: vscode.Uri, folder: vscode.Uri, targetLib: string): Promise<vscode.Uri> {
  const src = vscode.Uri.joinPath(extensionUri, 'samples', 'qrpglesrc');
  const dest = vscode.Uri.joinPath(folder, 'ibmi-unit-samples', 'qrpglesrc');
  await vscode.workspace.fs.createDirectory(dest);
  for (const name of SAMPLE_FILES) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(src, name));
    let text = Buffer.from(bytes).toString('utf8');
    if (name.includes('.test.')) {
      text = text.replace(/^(\s*\/\/\s*#LIBL\s*:\s*)IUNITSAMP\b/gim, `$1${targetLib}`);
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dest, name), Buffer.from(text, 'utf8'));
  }
  return vscode.Uri.joinPath(dest, 'mathutil.test.rpgle');
}
