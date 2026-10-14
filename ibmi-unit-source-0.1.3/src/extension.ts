import * as vscode from 'vscode';
import { IBMiSession, isObjectName } from './ibmi';
import { getSettings, Settings } from './settings';
import { parseSuite, isRpgPath } from './discovery';
import { runSuite, newRunId, frameworkInstalled, purgeOldResults, SuiteResult } from './runner';
import { RunReport, ReportPanel, saveReports, summarize } from './report';
import { installFramework, buildSamples, copySamplesToWorkspace } from './setup';

let lastReport: RunReport | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('IBM i Unit');
  const diagnostics = vscode.languages.createDiagnosticCollection('ibmiUnit');
  const ctrl = vscode.tests.createTestController('ibmiUnit', 'IBM i RPGLE Unit Tests');
  context.subscriptions.push(output, diagnostics, ctrl);

  const log = (line: string) => output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------
  const isRpgDoc = (doc: vscode.TextDocument) =>
    doc.languageId === 'rpgle' || doc.languageId === 'sqlrpgle' || isRpgPath(doc.uri.path);

  const suiteLabel = (uri: vscode.Uri): string => {
    if (uri.scheme === 'member') {
      const parts = uri.path.split('/').filter(Boolean).slice(-3);
      return parts.length === 3 ? `${parts[0]}/${parts[1]}(${parts[2].split('.')[0]})` : uri.path;
    }
    if (uri.scheme === 'file') { return vscode.workspace.asRelativePath(uri); }
    return uri.path;
  };

  const upsertSuite = (uri: vscode.Uri, text: string): vscode.TestItem | undefined => {
    const parsed = parseSuite(text);
    const id = uri.toString();
    if (parsed.tests.length === 0) {
      ctrl.items.delete(id);
      return undefined;
    }
    let suite = ctrl.items.get(id);
    if (!suite) {
      suite = ctrl.createTestItem(id, suiteLabel(uri), uri);
      ctrl.items.add(suite);
    }
    suite.label = suiteLabel(uri);
    suite.description = uri.scheme === 'file' ? undefined : uri.scheme;
    suite.range = new vscode.Range(0, 0, 0, 0);

    // Reuse existing items so in-flight runs keep valid references
    const keep: vscode.TestItem[] = [];
    for (const t of parsed.tests) {
      const childId = `${id}::${t.exportName}`;
      const item = suite.children.get(childId) ?? ctrl.createTestItem(childId, t.name, uri);
      item.label = t.name;
      item.range = new vscode.Range(t.line, 0, t.line, 0);
      keep.push(item);
    }
    suite.children.replace(keep);
    return suite;
  };

  const discoverWorkspace = async () => {
    const glob = getSettings().testFileGlob;
    const files = await vscode.workspace.findFiles(glob, '**/node_modules/**');
    for (const uri of files) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        upsertSuite(uri, Buffer.from(bytes).toString('utf8'));
      } catch {
        // unreadable file - ignore
      }
    }
  };

  ctrl.resolveHandler = async item => {
    if (!item) { await discoverWorkspace(); }
  };
  ctrl.refreshHandler = async () => { await discoverWorkspace(); };

  const watcher = vscode.workspace.createFileSystemWatcher(getSettings().testFileGlob);
  const fromDisk = async (uri: vscode.Uri) => {
    const bytes = await vscode.workspace.fs.readFile(uri);
    upsertSuite(uri, Buffer.from(bytes).toString('utf8'));
  };
  watcher.onDidCreate(fromDisk);
  watcher.onDidChange(fromDisk);
  watcher.onDidDelete(uri => ctrl.items.delete(uri.toString()));
  context.subscriptions.push(watcher);

  // Members and stream files opened through Code for IBM i become suites as
  // soon as they contain exported test procedures.
  const onDoc = (doc: vscode.TextDocument) => { if (isRpgDoc(doc)) { upsertSuite(doc.uri, doc.getText()); } };
  vscode.workspace.textDocuments.forEach(onDoc);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(onDoc),
    vscode.workspace.onDidChangeTextDocument(e => onDoc(e.document))
  );

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------
  const ensureReady = async (): Promise<{ session: IBMiSession; s: Settings } | undefined> => {
    let session: IBMiSession;
    try {
      session = await IBMiSession.connect();
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message);
      return undefined;
    }
    const s = getSettings(session);
    if (!(await frameworkInstalled(session, s))) {
      const choice = await vscode.window.showWarningMessage(
        `The IBM i Unit test framework is not installed in library ${s.library}. Install it now?`,
        { modal: true }, 'Install');
      if (choice !== 'Install') { return undefined; }
      const ok = await doInstall(session, s);
      if (!ok) { return undefined; }
    }
    return { session, s };
  };

  const doInstall = async (session: IBMiSession, s: Settings): Promise<boolean> => {
    output.show(true);
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Installing IBM i Unit into ${s.library}…` },
        () => installFramework(session, s, context.extensionUri, log));
      vscode.window.showInformationMessage(`IBM i Unit framework installed in ${s.library}.`);
      return true;
    } catch (e: any) {
      log(`Install failed: ${e.message}`);
      vscode.window.showErrorMessage(`Framework install failed: ${e.message}. See the "IBM i Unit" output.`);
      return false;
    }
  };

  const applyDiagnostics = (doc: vscode.TextDocument, result: SuiteResult) => {
    const diags = result.compileMessages
      .filter(m => m.inMainSource && m.severity >= 20 && m.line > 0)
      .map(m => {
        const line = Math.min(Math.max(m.line - 1, 0), Math.max(doc.lineCount - 1, 0));
        const range = doc.lineAt(line).range;
        const d = new vscode.Diagnostic(range, `${m.msgId}: ${m.text}`,
          m.severity >= 30 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        d.source = 'IBM i Unit';
        return d;
      });
    diagnostics.set(doc.uri, diags);
  };

  const runHandler = async (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
    // Group requested items by suite
    const plan = new Map<string, { suite: vscode.TestItem; tests: vscode.TestItem[] }>();
    const excluded = new Set((request.exclude ?? []).map(i => i.id));
    const add = (item: vscode.TestItem) => {
      if (excluded.has(item.id)) { return; }
      if (!item.parent) {
        item.children.forEach(add);
        return;
      }
      const entry = plan.get(item.parent.id) ?? { suite: item.parent, tests: [] };
      entry.tests.push(item);
      plan.set(item.parent.id, entry);
    };
    if (request.include) { request.include.forEach(add); } else { ctrl.items.forEach(add); }
    if (plan.size === 0) {
      vscode.window.showInformationMessage('No RPGLE tests to run.');
      return;
    }

    const run = ctrl.createTestRun(request, 'IBM i Unit', true);
    const out = (line: string) => { log(line); run.appendOutput(line.replace(/\r?\n/g, '\r\n') + '\r\n'); };

    const ready = await ensureReady();
    if (!ready) {
      plan.forEach(e => e.tests.forEach(t => run.skipped(t)));
      run.end();
      return;
    }
    const { session, s } = ready;
    await purgeOldResults(session, s);

    const report: RunReport = {
      runId: newRunId(), host: session.host, user: session.user, library: s.library,
      started: new Date(), finished: new Date(), suites: []
    };
    out(`Run ${report.runId} on ${session.user}@${session.host}`);

    for (const { suite, tests } of plan.values()) {
      if (token.isCancellationRequested) {
        tests.forEach(t => run.skipped(t));
        continue;
      }
      tests.forEach(t => run.started(t));
      out(`--- ${suite.label} (${tests.length} test(s))`);

      const doc = await vscode.workspace.openTextDocument(suite.uri!);
      if (doc.isDirty) { await doc.save(); }

      const exportNames = tests.map(t => t.id.substring(t.id.lastIndexOf('::') + 2));
      const result = await runSuite(session, s, doc, exportNames, report.runId, out);
      report.suites.push(result);
      applyDiagnostics(doc, result);

      const byExport = new Map(result.tests.map(r => [r.exportName, r]));
      for (const item of tests) {
        const r = byExport.get(item.id.substring(item.id.lastIndexOf('::') + 2));
        if (!r) { run.skipped(item); continue; }
        const location = item.uri && item.range ? new vscode.Location(item.uri, item.range) : undefined;
        const message = () => {
          const m = new vscode.TestMessage(r.message || r.status);
          m.location = location;
          return m;
        };
        switch (r.status) {
          case 'PASSED': run.passed(item, r.durationMs); break;
          case 'FAILED': run.failed(item, message(), r.durationMs); break;
          case 'SKIPPED': run.skipped(item); break;
          default: run.errored(item, message(), r.durationMs);
        }
      }
    }

    report.finished = new Date();
    lastReport = report;
    const sum = summarize(report);
    out(`Done: ${sum.passed} passed, ${sum.failed} failed, ${sum.errors} errors in ${(sum.durationMs / 1000).toFixed(1)}s`);
    run.end();

    await publishReport(report, s);
  };

  const publishReport = async (report: RunReport, s: Settings) => {
    const folder = vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, s.reportFolder)
      : vscode.Uri.joinPath(context.globalStorageUri, 'reports');
    try {
      const files = await saveReports(report, folder);
      log(`Report written to ${files.html.fsPath} and ${files.junit.fsPath}`);
    } catch (e: any) {
      log(`Could not save report files: ${e.message}`);
    }
    const sum = summarize(report);
    if (s.openReport) { ReportPanel.show(report); }
    const msg = `IBM i Unit: ${sum.passed}/${sum.total} passed` +
      (sum.failed ? `, ${sum.failed} failed` : '') + (sum.errors ? `, ${sum.errors} errors` : '');
    const action = await (sum.failed || sum.errors
      ? vscode.window.showWarningMessage(msg, 'Show Report')
      : vscode.window.showInformationMessage(msg, 'Show Report'));
    if (action === 'Show Report') { ReportPanel.show(report); }
  };

  const runProfile = ctrl.createRunProfile('Run on IBM i', vscode.TestRunProfileKind.Run, runHandler, true);

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('ibmiUnit.runFile', async (uri?: vscode.Uri) => {
      const doc = uri instanceof vscode.Uri
        ? await vscode.workspace.openTextDocument(uri)
        : vscode.window.activeTextEditor?.document;
      if (!doc) {
        vscode.window.showWarningMessage('Open an RPGLE test source first.');
        return;
      }
      const suite = upsertSuite(doc.uri, doc.getText());
      if (!suite) {
        vscode.window.showWarningMessage('No tests found. Tests are exported procedures whose names start with "test", e.g. dcl-proc test_add export;');
        return;
      }
      const cts = new vscode.CancellationTokenSource();
      await runHandler(new vscode.TestRunRequest([suite], undefined, runProfile), cts.token);
    }),

    vscode.commands.registerCommand('ibmiUnit.runAll', async () => {
      await discoverWorkspace();
      const cts = new vscode.CancellationTokenSource();
      await runHandler(new vscode.TestRunRequest(undefined, undefined, runProfile), cts.token);
    }),

    vscode.commands.registerCommand('ibmiUnit.showReport', () => {
      if (lastReport) { ReportPanel.show(lastReport); }
      else { vscode.window.showInformationMessage('No tests have been run in this session yet.'); }
    }),

    vscode.commands.registerCommand('ibmiUnit.installFramework', async () => {
      try {
        const session = await IBMiSession.connect();
        await doInstall(session, getSettings(session));
      } catch (e: any) {
        vscode.window.showErrorMessage(e.message);
      }
    }),

    vscode.commands.registerCommand('ibmiUnit.buildSamples', async () => {
      let session: IBMiSession;
      try { session = await IBMiSession.connect(); } catch (e: any) { vscode.window.showErrorMessage(e.message); return; }
      const lib = (await vscode.window.showInputBox({
        title: 'Library for the sample programs',
        value: 'IUNITSAMP',
        validateInput: v => isObjectName(v.trim()) ? undefined : 'Enter a valid library name (max 10 characters)'
      }))?.trim().toUpperCase();
      if (!lib) { return; }

      const s = getSettings(session);
      output.show(true);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Building samples in ${lib}…` },
          () => buildSamples(session, s, context.extensionUri, lib, log));
      } catch (e: any) {
        vscode.window.showErrorMessage(`Sample build failed: ${e.message}. See the "IBM i Unit" output.`);
        return;
      }

      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!folder) {
        vscode.window.showInformationMessage(`Samples built in ${lib}. Open a workspace folder and run this command again to get the test sources.`);
        return;
      }
      const first = await copySamplesToWorkspace(context.extensionUri, folder, lib);
      await vscode.window.showTextDocument(first);
      await discoverWorkspace();
      vscode.window.showInformationMessage(
        `Samples built in ${lib} and copied to ibmi-unit-samples/. Run the tests from Test Explorer or the ▷ button.`);
    }),

    vscode.commands.registerCommand('ibmiUnit.newTestSuite', async () => {
      const name = await vscode.window.showInputBox({ title: 'Name of the program or service program under test', value: 'MYSRVPGM' });
      if (!name) { return; }
      const upper = name.trim().toUpperCase();
      const doc = await vscode.workspace.openTextDocument({ language: 'rpgle', content: newSuiteTemplate(upper) });
      await vscode.window.showTextDocument(doc);
    })
  );
}

function newSuiteTemplate(target: string): string {
  return `**free
// Unit tests for ${target}
//#BNDSRVPGM: *LIBL/${target}
//#LIBL: MYLIB
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'
// /include 'qrpgleref/${target.toLowerCase()}_h.rpgleinc'

dcl-proc setUp export;
  // runs before each test
end-proc;

dcl-proc test_example export;
  assertEqualsInt(4: 2 + 2: 'arithmetic still works');
end-proc;
`;
}

export function deactivate(): void {
  // nothing to clean up
}

// Exposed for other extensions that want to read results
export function getLastReport(): RunReport | undefined {
  return lastReport;
}
