import * as vscode from 'vscode';

/**
 * Thin wrapper over the Code for IBM i extension API.
 *
 * Everything that touches the IBM i goes through the connection that
 * Code for IBM i already owns, so the user's host, credentials, library list
 * and current library are reused - this extension never opens its own SSH
 * session.
 */
export const CODE4I_ID = 'halcyontechltd.code-for-ibmi';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const OBJECT_NAME = /^[A-Z0-9_$#@]{1,10}$/;

export function isObjectName(name: string): boolean {
  return OBJECT_NAME.test(name.toUpperCase());
}

/** Single-quote a value for the PASE shell. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a value as a CL character literal. */
export function clq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Escape a value for use inside a double-quoted shell string. */
function dq(value: string): string {
  return value.replace(/[\\"$`]/g, '\\$&');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class IBMiSession {
  private constructor(private readonly connection: any) {}

  static async connect(): Promise<IBMiSession> {
    const ext = vscode.extensions.getExtension(CODE4I_ID);
    if (!ext) {
      throw new Error('Code for IBM i (halcyontechltd.code-for-ibmi) is not installed.');
    }
    const api: any = ext.isActive ? ext.exports : await ext.activate();
    const connection = api?.instance?.getConnection?.();
    if (!connection) {
      throw new Error('Not connected to an IBM i. Connect with Code for IBM i, then try again.');
    }
    return new IBMiSession(connection);
  }

  static async isConnected(): Promise<boolean> {
    try {
      await IBMiSession.connect();
      return true;
    } catch {
      return false;
    }
  }

  get config(): any {
    const c = this.connection;
    return (typeof c.getConfig === 'function' ? c.getConfig() : c.config) ?? {};
  }

  get user(): string {
    return String(this.connection.currentUser ?? this.config.username ?? '').toUpperCase();
  }

  get host(): string {
    return String(this.connection.currentHost ?? this.config.host ?? 'IBM i');
  }

  get homeDirectory(): string {
    const home = this.config.homeDirectory;
    return home && home !== '.' ? String(home).replace(/\/+$/, '') : `/home/${this.user}`;
  }

  get libraryList(): string[] {
    return (this.config.libraryList ?? []).map((l: unknown) => String(l).toUpperCase());
  }

  get currentLibrary(): string | undefined {
    const cur = this.config.currentLibrary;
    return cur ? String(cur).toUpperCase() : undefined;
  }

  private get content(): any {
    const c = this.connection;
    return typeof c.getContent === 'function' ? c.getContent() : c.content;
  }

  /** Run a PASE shell command. */
  async shell(command: string, stdin?: string): Promise<CommandResult> {
    const r = await this.connection.sendCommand({ command, stdin });
    return {
      code: typeof r?.code === 'number' ? r.code : 0,
      stdout: r?.stdout ?? '',
      stderr: r?.stderr ?? ''
    };
  }

  /**
   * Run a CL command with the Code for IBM i library list plus any extra
   * libraries (extra libraries end up on top).
   *
   * `liblist` is a QSH utility, not a PASE one, so the script is fed to QSH
   * on stdin; the library list it sets is in effect for the `system` call
   * that follows in the same QSH job.
   */
  async runCL(cl: string, extraLibraries: string[] = []): Promise<CommandResult> {
    const libs = unique([...extraLibraries.map(l => l.toUpperCase()), ...this.libraryList])
      .filter(isObjectName);
    const lines: string[] = [];
    for (const lib of [...libs].reverse()) {
      lines.push(`liblist -a ${shq(lib)} >/dev/null 2>&1`);
    }
    const cur = this.currentLibrary;
    if (cur && isObjectName(cur)) {
      lines.push(`liblist -c ${shq(cur)} >/dev/null 2>&1`);
    }
    lines.push(`system "${dq(cl)}"`);
    lines.push('exit $?');
    return this.shell('/QOpenSys/usr/bin/qsh', lines.join('\n') + '\n');
  }

  /** Run an SQL statement through Code for IBM i. */
  async sql<T = Record<string, unknown>>(statement: string): Promise<T[]> {
    const c = this.connection;
    if (typeof c.runSQL === 'function') {
      return (await c.runSQL(statement)) ?? [];
    }
    const content = this.content;
    if (content && typeof content.runSQL === 'function') {
      return (await content.runSQL(statement)) ?? [];
    }
    throw new Error('This version of Code for IBM i does not expose runSQL.');
  }

  /** Write a UTF-8 stream file (CCSID 1208), creating the directory. */
  async writeFile(remotePath: string, data: string): Promise<void> {
    const dir = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
    await this.shell(`mkdir -p ${shq(dir)}`);

    let written = false;
    const content = this.content;
    try {
      if (typeof content?.writeStreamfileRaw === 'function') {
        await content.writeStreamfileRaw(remotePath, Buffer.from(data, 'utf8'));
        written = true;
      } else if (typeof content?.writeStreamfile === 'function') {
        await content.writeStreamfile(remotePath, data);
        written = true;
      }
    } catch {
      written = false;
    }
    if (!written) {
      const r = await this.shell(`cat > ${shq(remotePath)}`, data);
      if (r.code !== 0) {
        throw new Error(`Could not write ${remotePath}: ${r.stderr || r.stdout}`);
      }
    }
    await this.shell(`setccsid 1208 ${shq(remotePath)}`);
  }
}
