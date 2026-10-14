import * as vscode from 'vscode';
import { IBMiSession, isObjectName } from './ibmi';

export interface Settings {
  library: string;
  remoteDir: string;
  additionalLibraries: string[];
  testFileGlob: string;
  reportFolder: string;
  openReport: boolean;
  keepResultsDays: number;
}

export function getSettings(session?: IBMiSession): Settings {
  const c = vscode.workspace.getConfiguration('ibmiUnit');
  const library = (c.get<string>('library') || 'IUNIT').trim().toUpperCase();
  if (!isObjectName(library)) {
    throw new Error(`ibmiUnit.library "${library}" is not a valid library name.`);
  }
  const configuredDir = (c.get<string>('remoteDirectory') || '').trim().replace(/\/+$/, '');
  const remoteDir = configuredDir || (session ? `${session.homeDirectory}/.ibmiunit` : '');
  return {
    library,
    remoteDir,
    additionalLibraries: (c.get<string[]>('additionalLibraries') || []).map(l => l.trim().toUpperCase()).filter(Boolean),
    testFileGlob: c.get<string>('testFileGlob') || '**/*.test.{rpgle,sqlrpgle,RPGLE,SQLRPGLE}',
    reportFolder: c.get<string>('reportFolder') || '.ibmi-unit',
    openReport: c.get<boolean>('openReportAfterRun', true),
    keepResultsDays: c.get<number>('keepResultsDays', 7)
  };
}
