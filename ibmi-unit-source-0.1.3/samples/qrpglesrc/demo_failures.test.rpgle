**free
// ---------------------------------------------------------------------------
// DEMO ONLY - these tests fail ON PURPOSE so you can see how FAILED and
// ERROR results look in Test Explorer and in the HTML / JUnit report.
//
//#BNDSRVPGM: *LIBL/MATHUTIL
//#LIBL: IUNITSAMP
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'
/include 'mathutil_h.rpgleinc'

// PASSED
dcl-proc test_demo_passes export;
  assertTrue(math_isPrime(13): '13 is prime');
end-proc;

// FAILED - wrong expectation
dcl-proc test_demo_assertionFailure export;
  assertEqualsInt(42: math_add(20: 21): 'deliberately wrong expectation');
end-proc;

// FAILED - string mismatch
dcl-proc test_demo_charMismatch export;
  assertEqualsChar('Hello': 'World': 'greeting');
end-proc;

// ERROR - runtime exception (divide by zero, RPG status 00102)
dcl-proc test_demo_runtimeError export;
  dcl-s zero int(10) inz(0);
  dcl-s result int(10);
  result = 10 / zero;
  assertEqualsInt(0: result);
end-proc;

// FAILED - explicit fail()
dcl-proc test_demo_explicitFail export;
  fail('Not implemented yet');
end-proc;
