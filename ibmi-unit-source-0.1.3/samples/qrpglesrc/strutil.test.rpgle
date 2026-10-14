**free
// ---------------------------------------------------------------------------
// Unit tests for service program STRUTIL
// Also demonstrates the setUp / tearDown hooks: setUp runs before every
// test, tearDown after every test (both optional, both must be EXPORTed).
//
//#BNDSRVPGM: *LIBL/STRUTIL
//#LIBL: IUNITSAMP
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'
/include 'strutil_h.rpgleinc'

dcl-s fixture varchar(100);

dcl-proc setUp export;
  fixture = 'the quick brown fox';
end-proc;

dcl-proc tearDown export;
  fixture = '';
end-proc;

dcl-proc test_reverse_word export;
  assertEqualsChar('olleh': str_reverse('hello'));
end-proc;

dcl-proc test_reverse_emptyString export;
  assertEqualsChar('': str_reverse(''));
end-proc;

dcl-proc test_reverse_twiceIsIdentity export;
  assertEqualsChar(fixture: str_reverse(str_reverse(fixture)));
end-proc;

dcl-proc test_padLeft_withZeros export;
  assertEqualsChar('00042': str_padLeft('42': 5: '0'));
end-proc;

dcl-proc test_padLeft_longerValueUnchanged export;
  assertEqualsChar('123456': str_padLeft('123456': 3: '0'));
end-proc;

dcl-proc test_capitalize_fixture export;
  assertEqualsChar('The Quick Brown Fox': str_capitalize(fixture));
end-proc;

dcl-proc test_capitalize_mixedCase export;
  assertEqualsChar('Hello World': str_capitalize('hELLO wORLD'));
end-proc;

dcl-proc test_countOccurrences export;
  assertEqualsInt(2: str_countOccurrences(fixture: 'o'): 'letter o');
  assertEqualsInt(1: str_countOccurrences(fixture: 'quick'): 'word');
  assertEqualsInt(0: str_countOccurrences(fixture: 'zebra'): 'absent');
  assertEqualsInt(0: str_countOccurrences(fixture: ''): 'empty search');
end-proc;
