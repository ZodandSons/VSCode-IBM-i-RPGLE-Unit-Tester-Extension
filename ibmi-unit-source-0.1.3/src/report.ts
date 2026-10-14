import * as vscode from 'vscode';
import { SuiteResult, TestStatus } from './runner';

export interface RunReport {
  runId: string;
  host: string;
  user: string;
  library: string;
  started: Date;
  finished: Date;
  suites: SuiteResult[];
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  asserts: number;
  durationMs: number;
}

export function summarize(report: RunReport): Summary {
  const s: Summary = { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0, asserts: 0, durationMs: 0 };
  for (const suite of report.suites) {
    for (const t of suite.tests) {
      s.total++;
      s.asserts += t.asserts;
      if (t.status === 'PASSED') { s.passed++; }
      else if (t.status === 'FAILED') { s.failed++; }
      else if (t.status === 'SKIPPED') { s.skipped++; }
      else { s.errors++; }
    }
  }
  s.durationMs = report.finished.getTime() - report.started.getTime();
  return s;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function secs(ms: number): string {
  return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + 's';
}

const STATUS_LABEL: Record<TestStatus, string> = {
  PASSED: 'Passed', FAILED: 'Failed', ERROR: 'Error', MISSING: 'Missing', SKIPPED: 'Skipped'
};

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
export function renderHtml(report: RunReport, opts: { webview?: boolean } = {}): string {
  const sum = summarize(report);
  const ok = sum.failed === 0 && sum.errors === 0;
  const pct = sum.total ? Math.round((sum.passed / sum.total) * 100) : 0;

  const suitesHtml = report.suites.map(suite => {
    const counts = { p: 0, f: 0, e: 0 };
    suite.tests.forEach(t => t.status === 'PASSED' ? counts.p++ : t.status === 'FAILED' ? counts.f++ : counts.e++);
    const suiteOk = counts.f === 0 && counts.e === 0;

    const rows = suite.tests.map(t => `
        <tr class="row ${t.status.toLowerCase()}">
          <td><span class="badge ${t.status.toLowerCase()}">${STATUS_LABEL[t.status]}</span></td>
          <td class="name">${esc(t.name)}${t.line !== undefined ? `<span class="line">line ${t.line + 1}</span>` : ''}</td>
          <td class="num">${t.asserts}</td>
          <td class="num">${t.durationMs} ms</td>
          <td class="msg">${esc(t.message)}</td>
        </tr>`).join('');

    const compileMsgs = suite.compileMessages.filter(m => m.severity >= 20);
    const compileBlock = compileMsgs.length ? `
      <div class="compile-errors">
        <h4>Compiler messages</h4>
        <ul>${compileMsgs.map(m => `<li><code>${esc(m.msgId)}</code> sev ${m.severity} · line ${m.line}: ${esc(m.text)}</li>`).join('')}</ul>
      </div>` : '';

    return `
    <section class="suite ${suiteOk ? 'ok' : 'bad'}">
      <header>
        <div>
          <h3>${esc(suite.label)}</h3>
          <div class="meta">${esc(suite.library)}/${esc(suite.testObject || '—')} · ${secs(suite.durationMs)}</div>
        </div>
        <div class="pills">
          <span class="pill passed">${counts.p} passed</span>
          ${counts.f ? `<span class="pill failed">${counts.f} failed</span>` : ''}
          ${counts.e ? `<span class="pill error">${counts.e} error${counts.e === 1 ? '' : 's'}</span>` : ''}
        </div>
      </header>
      ${suite.error ? `<div class="suite-error">${esc(suite.error)}</div>` : ''}
      ${compileBlock}
      <table>
        <colgroup><col style="width:90px"><col style="width:34%"><col style="width:70px"><col style="width:80px"><col></colgroup>
        <thead><tr><th>Status</th><th>Test</th><th class="num">Asserts</th><th class="num">Time</th><th>Message</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details><summary>Compile &amp; run log</summary><pre>${esc(suite.compileLog)}</pre></details>
    </section>`;
  }).join('');

  const themeVars = opts.webview ? `
    :root {
      --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground); --card: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --border: var(--vscode-panel-border, rgba(128,128,128,.3)); --code: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12));
      --font: var(--vscode-font-family);
    }` : `
    :root { --bg:#f7f7f5; --fg:#1d1f21; --muted:#6b6f76; --card:#ffffff; --border:#e2e2de; --code:#f0f0ec;
      --font: -apple-system, "Segoe UI", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#16181b; --fg:#e6e6e3; --muted:#9a9ea5; --card:#1e2125; --border:#30343a; --code:#262a2f; }
    }`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.webview ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">` : ''}
<title>IBM i Unit Report</title>
<style>
  ${themeVars}
  :root { --pass:#2f9e5f; --fail:#d64545; --err:#d9822b; --skip:#8a8f98; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font-family:var(--font); font-size:13px; line-height:1.45; }
  .wrap { max-width:1200px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; display:flex; align-items:center; gap:10px; }
  .verdict { font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; color:#fff; background:${ok ? 'var(--pass)' : 'var(--fail)'}; }
  .sub { color:var(--muted); margin-bottom:20px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px,1fr)); gap:12px; margin-bottom:12px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:12px 14px; }
  .card .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:22px; font-weight:600; margin-top:2px; font-variant-numeric:tabular-nums; }
  .card.passed .v { color:var(--pass); } .card.failed .v { color:var(--fail); } .card.error .v { color:var(--err); }
  .bar { height:8px; border-radius:4px; overflow:hidden; display:flex; background:var(--border); margin:4px 0 24px; }
  .bar span { display:block; height:100%; }
  .suite { background:var(--card); border:1px solid var(--border); border-left:4px solid var(--pass); border-radius:8px; padding:14px 16px; margin-bottom:16px; }
  .suite.bad { border-left-color:var(--fail); }
  .suite header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
  .suite h3 { margin:0; font-size:14px; word-break:break-all; }
  .meta { color:var(--muted); font-size:12px; }
  .pills { display:flex; gap:6px; flex-wrap:wrap; }
  .pill { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); }
  .pill.passed { color:var(--pass); } .pill.failed { color:var(--fail); } .pill.error { color:var(--err); }
  table { width:100%; border-collapse:collapse; margin-top:6px; table-layout:fixed; }
  th { text-align:left; font-weight:600; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--border); padding:6px 8px; }
  td { padding:7px 8px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .name { font-family:var(--vscode-editor-font-family, ui-monospace, Menlo, Consolas, monospace); word-break:break-all; }
  .line { color:var(--muted); font-family:var(--font); font-size:11px; margin-left:8px; }
  .msg { color:var(--fg); word-break:break-word; }
  tr.passed .msg { color:var(--muted); }
  .badge { display:inline-block; min-width:62px; text-align:center; font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px; color:#fff; }
  .badge.passed { background:var(--pass); } .badge.failed { background:var(--fail); }
  .badge.error, .badge.missing { background:var(--err); } .badge.skipped { background:var(--skip); }
  .suite-error { background:color-mix(in srgb, var(--fail) 12%, transparent); border:1px solid color-mix(in srgb, var(--fail) 40%, transparent); border-radius:6px; padding:8px 10px; margin:6px 0; }
  .compile-errors h4 { margin:10px 0 4px; font-size:12px; }
  .compile-errors ul { margin:0; padding-left:18px; }
  code { background:var(--code); padding:1px 4px; border-radius:3px; }
  details { margin-top:10px; } summary { cursor:pointer; color:var(--muted); font-size:12px; }
  pre { background:var(--code); padding:10px; border-radius:6px; overflow:auto; max-height:320px; font-size:11.5px; white-space:pre-wrap; word-break:break-word; }
  @media (max-width:640px) { body { padding:16px; } .msg { min-width:160px; } table { display:block; overflow-x:auto; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>IBM i Unit Report <span class="verdict">${ok ? 'ALL PASSED' : 'FAILURES'}</span></h1>
  <div class="sub">${esc(report.user)}@${esc(report.host)} · library ${esc(report.library)} · ${esc(report.started.toLocaleString())} · run ${esc(report.runId)}</div>

  <div class="cards">
    <div class="card"><div class="k">Tests</div><div class="v">${sum.total}</div></div>
    <div class="card passed"><div class="k">Passed</div><div class="v">${sum.passed}</div></div>
    <div class="card failed"><div class="k">Failed</div><div class="v">${sum.failed}</div></div>
    <div class="card error"><div class="k">Errors</div><div class="v">${sum.errors}</div></div>
    <div class="card"><div class="k">Pass rate</div><div class="v">${pct}%</div></div>
    <div class="card"><div class="k">Assertions</div><div class="v">${sum.asserts}</div></div>
    <div class="card"><div class="k">Duration</div><div class="v">${secs(sum.durationMs)}</div></div>
  </div>
  <div class="bar" title="${sum.passed} passed, ${sum.failed} failed, ${sum.errors} errors">
    ${sum.total ? `<span style="width:${(sum.passed / sum.total) * 100}%;background:var(--pass)"></span>
    <span style="width:${(sum.failed / sum.total) * 100}%;background:var(--fail)"></span>
    <span style="width:${(sum.errors / sum.total) * 100}%;background:var(--err)"></span>` : ''}
  </div>

  ${suitesHtml || '<p>No suites were run.</p>'}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// JUnit XML (for CI dashboards: Jenkins, GitLab, Azure DevOps ...)
// ---------------------------------------------------------------------------
function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderJUnit(report: RunReport): string {
  const sum = summarize(report);
  const suites = report.suites.map(suite => {
    const failures = suite.tests.filter(t => t.status === 'FAILED').length;
    const errors = suite.tests.filter(t => !['PASSED', 'FAILED', 'SKIPPED'].includes(t.status)).length;
    const skipped = suite.tests.filter(t => t.status === 'SKIPPED').length;
    const cases = suite.tests.map(t => {
      const head = `    <testcase classname="${xml(suite.library + '.' + suite.testObject)}" name="${xml(t.name)}" assertions="${t.asserts}" time="${(t.durationMs / 1000).toFixed(3)}"`;
      switch (t.status) {
        case 'PASSED': return `${head}/>`;
        case 'FAILED': return `${head}>\n      <failure message="${xml(t.message)}" type="AssertionFailure">${xml(t.message)}</failure>\n    </testcase>`;
        case 'SKIPPED': return `${head}>\n      <skipped/>\n    </testcase>`;
        default: return `${head}>\n      <error message="${xml(t.message)}" type="${xml(t.status)}">${xml(t.message)}</error>\n    </testcase>`;
      }
    }).join('\n');
    return `  <testsuite name="${xml(suite.label)}" tests="${suite.tests.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${(suite.durationMs / 1000).toFixed(3)}" timestamp="${report.started.toISOString()}" hostname="${xml(report.host)}">
${cases}
    <system-out>${xml(suite.compileLog)}</system-out>
  </testsuite>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="IBM i Unit" tests="${sum.total}" failures="${sum.failed}" errors="${sum.errors}" time="${(sum.durationMs / 1000).toFixed(3)}">
${suites}
</testsuites>
`;
}

// ---------------------------------------------------------------------------
// Persist + show
// ---------------------------------------------------------------------------
export async function saveReports(report: RunReport, folder: vscode.Uri): Promise<{ html: vscode.Uri; junit: vscode.Uri }> {
  await vscode.workspace.fs.createDirectory(folder);
  const html = vscode.Uri.joinPath(folder, 'report.html');
  const junit = vscode.Uri.joinPath(folder, 'junit.xml');
  const json = vscode.Uri.joinPath(folder, 'results.json');
  await vscode.workspace.fs.writeFile(html, Buffer.from(renderHtml(report), 'utf8'));
  await vscode.workspace.fs.writeFile(junit, Buffer.from(renderJUnit(report), 'utf8'));
  await vscode.workspace.fs.writeFile(json, Buffer.from(JSON.stringify(report, null, 2), 'utf8'));
  return { html, junit };
}

export class ReportPanel {
  private static panel: vscode.WebviewPanel | undefined;

  static show(report: RunReport): void {
    const sum = summarize(report);
    const title = `IBM i Unit: ${sum.passed}/${sum.total} passed`;
    if (!ReportPanel.panel) {
      ReportPanel.panel = vscode.window.createWebviewPanel('ibmiUnitReport', title, vscode.ViewColumn.Beside, {
        enableScripts: false,
        retainContextWhenHidden: true
      });
      ReportPanel.panel.onDidDispose(() => { ReportPanel.panel = undefined; });
    }
    ReportPanel.panel.title = title;
    ReportPanel.panel.webview.html = renderHtml(report, { webview: true });
    ReportPanel.panel.reveal(vscode.ViewColumn.Beside, true);
  }
}
