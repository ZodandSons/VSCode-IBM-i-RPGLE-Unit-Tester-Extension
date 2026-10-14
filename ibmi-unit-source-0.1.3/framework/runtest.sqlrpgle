**free
// ---------------------------------------------------------------------------
// RUNTEST - IBM i Unit test runner
//
// Activates a compiled test service program, resolves each requested test
// procedure by export name, runs it (with optional setUp/tearDown and
// setUpSuite/tearDownSuite hooks) and writes one row per test to IUNITRES
// in the runner's own library.
//
// Built by "IBM i Unit: Install Test Framework on IBM i":
//   CRTSQLRPGI OBJ(lib/RUNTEST) SRCSTMF(...) OBJTYPE(*MODULE) COMMIT(*NONE)
//   CRTPGM PGM(lib/RUNTEST) MODULE(lib/RUNTEST) BNDSRVPGM((lib/TESTASSERT))
//          BNDDIR(QC2LE) ACTGRP(*NEW)
//
// Parameters are fixed length so a CL CALL can pass them safely (the
// extension pads testList to exactly 2000 characters).
// ---------------------------------------------------------------------------
ctl-opt option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'

dcl-pi *n;
  runId    char(26);
  testLib  char(10);
  testObj  char(10);
  testList char(2000);
end-pi;

// ---- System APIs -------------------------------------------------------
dcl-pr rslvsp pointer(*proc) extproc('rslvsp');
  objectType char(2) value;
  objectName pointer value options(*string);
  objectLib pointer value options(*string);
  authority char(2) value;
end-pr;

dcl-pr QleActBndPgm extproc('QleActBndPgm');
  boundProgram pointer(*proc) const;
  activationMark int(10) options(*omit);
  activationInfo char(64) options(*omit);
  activationInfoLength int(10) const options(*omit);
  errorCode char(32767) options(*varsize: *omit);
end-pr;

dcl-pr QleGetExp pointer(*proc) extproc('QleGetExp');
  activationMark int(10) const;
  exportNumber int(10) const;
  exportNameLength int(10) const;
  exportName char(256) const options(*varsize);
  exportPointer pointer(*proc) options(*omit);
  exportType int(10);
  errorCode char(32767) options(*varsize: *omit);
end-pr;

dcl-pr QMHSNDPM extpgm('QMHSNDPM');
  messageId char(7) const;
  messageFile char(20) const;
  messageData char(32767) const options(*varsize);
  messageDataLength int(10) const;
  messageType char(10) const;
  callStackEntry char(10) const;
  callStackCounter int(10) const;
  messageKey char(4);
  errorCode char(32767) options(*varsize);
end-pr;

dcl-pr runProc extproc(procPtr);
end-pr;

// ---- Data --------------------------------------------------------------
dcl-ds psds psds qualified;
  procName char(10) pos(1);
  exceptionId char(7) pos(40);
  pgmLib char(10) pos(81);
  exceptionData char(80) pos(91);
end-ds;

dcl-ds apiError qualified;
  bytesProvided int(10) inz(272);
  bytesAvailable int(10) inz(0);
  messageId char(7);
  reserved char(1);
  messageData char(256);
end-ds;

dcl-c MAX_TESTS 500;
dcl-s testNames varchar(128) dim(MAX_TESTS);
dcl-s testCount int(10) inz(0);
dcl-s activationMark int(10) inz(0);
dcl-s procPtr pointer(*proc);
dcl-s seq int(10) inz(0);
dcl-s suiteError varchar(1024) inz('');
dcl-s activated ind inz(*off);
dcl-s insertPrepared ind inz(*off);
dcl-s sqlError varchar(512) inz('');
dcl-s resultTable varchar(30);
dcl-s i int(10);

// ===========================================================================
// Mainline
// ===========================================================================
exec sql set option commit = *none, naming = *sql, closqlcsr = *endactgrp,
                    datfmt = *iso;

resultTable = %trim(psds.pgmLib) + '.IUNITRES';

splitTestList();

activated = activateTestObject();
if activated;
  runSuiteHook('SETUPSUITE': 'setUpSuite');
endif;

for i = 1 to testCount;
  runTest(testNames(i));
endfor;

if activated;
  runSuiteHook('TEARDOWNSUITE': 'tearDownSuite');
endif;

*inlr = *on;

// Results could not be stored: end with an escape message so the CALL
// fails and the extension shows the reason.
if sqlError <> '';
  endWithError(sqlError);
endif;
return;

// ===========================================================================
// Split the comma-separated list of export names
// ===========================================================================
dcl-proc splitTestList;
  dcl-s remaining varchar(2000);
  dcl-s pos int(10);
  dcl-s name varchar(128);

  remaining = %trim(testList);
  dow %len(remaining) > 0 and testCount < MAX_TESTS;
    pos = %scan(',': remaining);
    if pos = 0;
      name = %trim(remaining);
      remaining = '';
    else;
      if pos > 1;
        name = %trim(%subst(remaining: 1: pos - 1));
      else;
        name = '';
      endif;
      if pos < %len(remaining);
        remaining = %trim(%subst(remaining: pos + 1));
      else;
        remaining = '';
      endif;
    endif;
    if name <> '';
      testCount += 1;
      testNames(testCount) = name;
    endif;
  enddo;
end-proc;

// ===========================================================================
// Activate the test service program into this activation group
// ===========================================================================
dcl-proc activateTestObject;
  dcl-pi *n ind;
  end-pi;
  dcl-s srvPgm pointer(*proc);

  monitor;
    srvPgm = rslvsp(x'0203': %trim(testObj): %trim(testLib): x'0000');
    QleActBndPgm(srvPgm: activationMark: *omit: *omit: *omit);
  on-error;
    suiteError = 'Cannot activate ' + %trim(testLib) + '/' + %trim(testObj)
               + ': ' + describeException();
    return *off;
  endmon;
  return *on;
end-proc;

// ===========================================================================
// Resolve an exported procedure by name (*null when not exported)
// ===========================================================================
dcl-proc findProc;
  dcl-pi *n pointer(*proc);
    exportName varchar(128) const;
  end-pi;
  dcl-s found pointer(*proc) inz(*null);
  dcl-s exportType int(10) inz(0);
  dcl-s nameBuffer char(256);

  if not activated;
    return *null;
  endif;
  nameBuffer = exportName;
  apiError.bytesAvailable = 0;
  QleGetExp(activationMark: 0: %len(exportName): nameBuffer
           : found: exportType: apiError);
  if apiError.bytesAvailable > 0 or exportType <> 1;
    return *null;
  endif;
  return found;
end-proc;

dcl-proc callIfExported;
  dcl-pi *n;
    exportName varchar(128) const;
  end-pi;
  dcl-s hook pointer(*proc);

  hook = findProc(exportName);
  if hook <> *null;
    procPtr = hook;
    runProc();
  endif;
end-proc;

// ===========================================================================
// setUpSuite / tearDownSuite
// ===========================================================================
dcl-proc runSuiteHook;
  dcl-pi *n;
    exportName varchar(128) const;
    label varchar(30) const;
  end-pi;
  dcl-s started timestamp;

  started = %timestamp();
  iu_beginTest(label);
  monitor;
    callIfExported(exportName);
  on-error;
    if exportName = 'SETUPSUITE';
      suiteError = label + ' failed: ' + describeException();
    else;
      writeResult(label: 'ERROR': 0: label + ' failed: ' + describeException()
                 : started: 0);
    endif;
  endmon;
end-proc;

// ===========================================================================
// Run one test (setUp -> test -> tearDown) and record the result
// ===========================================================================
dcl-proc runTest;
  dcl-pi *n;
    testName varchar(128) const;
  end-pi;
  dcl-s status varchar(10);
  dcl-s message varchar(1024);
  dcl-s started timestamp;
  dcl-s elapsed int(20) inz(0);
  dcl-s testPtr pointer(*proc);

  started = %timestamp();

  if suiteError <> '';
    writeResult(testName: 'ERROR': 0: suiteError: started: 0);
    return;
  endif;

  testPtr = findProc(testName);
  if testPtr = *null;
    writeResult(testName: 'MISSING': 0: 'Procedure ' + testName
               + ' is not exported by ' + %trim(testLib) + '/'
               + %trim(testObj) + ' (is EXPORT on the DCL-PROC?)'
               : started: 0);
    return;
  endif;

  iu_beginTest(testName);
  status = 'PASSED';
  message = '';

  monitor;
    callIfExported('SETUP');
    procPtr = testPtr;
    runProc();
  on-error;
    if iu_hasFailed();
      status = 'FAILED';
      message = iu_getFailMessage();
    else;
      status = 'ERROR';
      message = describeException();
    endif;
  endmon;

  monitor;
    callIfExported('TEARDOWN');
  on-error;
    if status = 'PASSED';
      if iu_hasFailed();
        status = 'FAILED';
      else;
        status = 'ERROR';
      endif;
      message = 'tearDown failed: ' + describeException();
    endif;
  endmon;

  if status = 'PASSED' and iu_hasFailed();
    status = 'FAILED';
    message = iu_getFailMessage();
  endif;

  elapsed = %diff(%timestamp(): started: *mseconds);
  writeResult(testName: status: iu_getAssertCount(): message: started: elapsed);
end-proc;

// ===========================================================================
// Describe the exception that was just handled
// ===========================================================================
dcl-proc describeException;
  dcl-pi *n varchar(1024);
  end-pi;
  if iu_hasFailed();
    return iu_getFailMessage();
  endif;
  return %trim(psds.exceptionId) + ' (status ' + %char(%status()) + '): '
       + %trim(psds.exceptionData);
end-proc;

// ===========================================================================
// Insert one result row (dynamic SQL so the table is qualified with the
// runner's own library, whatever library the framework was installed into)
// ===========================================================================
dcl-proc writeResult;
  dcl-pi *n;
    testName varchar(128) const;
    status varchar(10) const;
    asserts int(10) const;
    message varchar(1024) const;
    started timestamp const;
    elapsed int(20) const;
  end-pi;
  dcl-s sqlText varchar(512);
  dcl-s hRunId char(26);
  dcl-s hLib varchar(10);
  dcl-s hObj varchar(10);
  dcl-s hName varchar(128);
  dcl-s hStatus varchar(10);
  dcl-s hAsserts int(10);
  dcl-s hMessage varchar(1024);
  dcl-s hStarted timestamp;
  dcl-s hElapsed int(20);

  if not insertPrepared;
    sqlText = 'insert into ' + resultTable
            + ' (RUNID, TESTLIB, TESTOBJ, TESTNAME, SEQ, STATUS, ASSERTS,'
            + ' MESSAGE, STARTED, DURATION_MS)'
            + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    exec sql prepare INSRESULT from :sqlText;
    if sqlcode < 0;
      sqlError = 'Cannot prepare insert into ' + resultTable
               + ' (SQLCODE ' + %char(sqlcode) + ')';
      return;
    endif;
    insertPrepared = *on;
  endif;

  seq += 1;
  hRunId = runId;
  hLib = %trim(testLib);
  hObj = %trim(testObj);
  hName = testName;
  hStatus = status;
  hAsserts = asserts;
  hMessage = message;
  hStarted = started;
  hElapsed = elapsed;

  exec sql execute INSRESULT using :hRunId, :hLib, :hObj, :hName, :seq,
                                   :hStatus, :hAsserts, :hMessage,
                                   :hStarted, :hElapsed;
  if sqlcode < 0 and sqlError = '';
    sqlError = 'Cannot insert into ' + resultTable
             + ' (SQLCODE ' + %char(sqlcode) + ')';
  endif;
end-proc;

// ===========================================================================
// Send CPF9898 *ESCAPE to RUNTEST's caller
// ===========================================================================
dcl-proc endWithError;
  dcl-pi *n;
    text varchar(512) const;
  end-pi;
  dcl-s messageKey char(4);
  dcl-ds errorCode qualified;
    bytesProvided int(10) inz(0);
    bytesAvailable int(10) inz(0);
  end-ds;

  QMHSNDPM('CPF9898': 'QCPFMSG   *LIBL     ': text: %len(text)
          : '*ESCAPE': '*PGMBDY': 1: messageKey: errorCode);
end-proc;
