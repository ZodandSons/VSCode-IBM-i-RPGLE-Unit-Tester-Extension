**free
// ---------------------------------------------------------------------------
// TESTASSERT - IBM i Unit assertion service program
//
// Built by "IBM i Unit: Install Test Framework on IBM i":
//   CRTRPGMOD MODULE(lib/TESTASSERT) SRCSTMF(...) INCDIR(...)
//   CRTSRVPGM SRVPGM(lib/TESTASSERT) EXPORT(*ALL) ACTGRP(*CALLER)
//
// ACTGRP(*CALLER) matters: the runner (RUNTEST) and every test service
// program bind to this service program and run in the runner's activation
// group, so they all share the state below.
//
// A failing assertion records its message, then sends CPF9898 *ESCAPE to the
// assertion procedure. The exception percolates out of the test procedure to
// the MONITOR in RUNTEST, which reports the test as FAILED.
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'

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

dcl-s gFailed ind inz(*off);
dcl-s gMessage varchar(1024) inz('');
dcl-s gAsserts int(10) inz(0);
dcl-s gTestName varchar(128) inz('');   // available for debugging

// ===========================================================================
// Runner hooks
// ===========================================================================
dcl-proc iu_beginTest export;
  dcl-pi *n;
    testName varchar(128) const;
  end-pi;
  gTestName = testName;
  gFailed = *off;
  gMessage = '';
  gAsserts = 0;
end-proc;

dcl-proc iu_hasFailed export;
  dcl-pi *n ind;
  end-pi;
  return gFailed;
end-proc;

dcl-proc iu_getFailMessage export;
  dcl-pi *n varchar(1024);
  end-pi;
  return gMessage;
end-proc;

dcl-proc iu_getAssertCount export;
  dcl-pi *n int(10);
  end-pi;
  return gAsserts;
end-proc;

// ===========================================================================
// Assertions
// ===========================================================================
dcl-proc assertTrue export;
  dcl-pi *n;
    condition ind const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 2;
    userMessage = message;
  endif;
  gAsserts += 1;
  if not condition;
    raiseFailure(compose(userMessage: 'Expected *ON but was *OFF'));
  endif;
end-proc;

dcl-proc assertFalse export;
  dcl-pi *n;
    condition ind const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 2;
    userMessage = message;
  endif;
  gAsserts += 1;
  if condition;
    raiseFailure(compose(userMessage: 'Expected *OFF but was *ON'));
  endif;
end-proc;

dcl-proc assertEqualsInt export;
  dcl-pi *n;
    expected int(20) const;
    actual int(20) const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 3;
    userMessage = message;
  endif;
  gAsserts += 1;
  if expected <> actual;
    raiseFailure(compose(userMessage: 'Expected ' + %char(expected)
                                    + ' but was ' + %char(actual)));
  endif;
end-proc;

dcl-proc assertEqualsDec export;
  dcl-pi *n;
    expected packed(31: 9) const;
    actual packed(31: 9) const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 3;
    userMessage = message;
  endif;
  gAsserts += 1;
  if expected <> actual;
    raiseFailure(compose(userMessage: 'Expected ' + formatDec(expected)
                                    + ' but was ' + formatDec(actual)));
  endif;
end-proc;

dcl-proc assertEqualsChar export;
  dcl-pi *n;
    expected varchar(32767) const;
    actual varchar(32767) const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 3;
    userMessage = message;
  endif;
  gAsserts += 1;
  if %trimr(expected) <> %trimr(actual);
    raiseFailure(compose(userMessage: 'Expected "' + clip(%trimr(expected))
                       + '" but was "' + clip(%trimr(actual)) + '"'));
  endif;
end-proc;

dcl-proc assertNotEqualsChar export;
  dcl-pi *n;
    unexpected varchar(32767) const;
    actual varchar(32767) const;
    message varchar(1024) const options(*nopass);
  end-pi;
  dcl-s userMessage varchar(1024) inz('');

  if %parms() >= 3;
    userMessage = message;
  endif;
  gAsserts += 1;
  if %trimr(unexpected) = %trimr(actual);
    raiseFailure(compose(userMessage: 'Did not expect "'
                       + clip(%trimr(actual)) + '"'));
  endif;
end-proc;

dcl-proc fail export;
  dcl-pi *n;
    message varchar(1024) const;
  end-pi;
  gAsserts += 1;
  raiseFailure(compose(message: 'fail() called'));
end-proc;

// ===========================================================================
// Internals
// ===========================================================================
dcl-proc raiseFailure;
  dcl-pi *n;
    text varchar(1024) const;
  end-pi;
  dcl-s messageKey char(4);
  dcl-s messageText varchar(512);
  dcl-ds errorCode qualified;
    bytesProvided int(10) inz(0);
    bytesAvailable int(10) inz(0);
  end-ds;

  // The first failure in a test is the one that is reported.
  if not gFailed;
    gFailed = *on;
    gMessage = text;
  endif;

  messageText = text;
  if messageText = '';
    messageText = 'Assertion failed';
  endif;

  // '*' + counter 1 = the assertion procedure that called raiseFailure.
  QMHSNDPM('CPF9898': 'QCPFMSG   *LIBL     ': messageText: %len(messageText)
          : '*ESCAPE': '*': 1: messageKey: errorCode);
end-proc;

dcl-proc compose;
  dcl-pi *n varchar(1024);
    userMessage varchar(1024) const;
    detail varchar(1024) const;
  end-pi;
  if userMessage = '';
    return detail;
  endif;
  return userMessage + ': ' + detail;
end-proc;

dcl-proc clip;
  dcl-pi *n varchar(400);
    value varchar(32767) const;
  end-pi;
  if %len(value) > 400;
    return %subst(value: 1: 397) + '...';
  endif;
  return value;
end-proc;

dcl-proc formatDec;
  dcl-pi *n varchar(64);
    value packed(31: 9) const;
  end-pi;
  dcl-s text varchar(64);

  text = %trim(%char(value));
  if %scan('.': text) > 0;
    text = %trimr(text: '0');
    text = %trimr(text: '.');
  endif;
  if text = '' or text = '-';
    return '0';
  endif;
  if %subst(text: 1: 1) = '.';
    text = '0' + text;
  elseif %len(text) >= 2 and %subst(text: 1: 2) = '-.';
    text = '-0' + %subst(text: 2);
  endif;
  return text;
end-proc;
