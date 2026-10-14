**free
// ---------------------------------------------------------------------------
// Unit tests for service program MATHUTIL
//
// Directives read by the IBM i Unit extension:
//#BNDSRVPGM: *LIBL/MATHUTIL
//#LIBL: IUNITSAMP
//
// Every exported procedure whose name starts with "test" is a test.
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'
/include 'mathutil_h.rpgleinc'

dcl-proc test_add_positiveNumbers export;
  assertEqualsInt(5: math_add(2: 3): 'math_add(2: 3)');
end-proc;

dcl-proc test_add_negativeNumbers export;
  assertEqualsInt(-7: math_add(-3: -4));
  assertEqualsInt(0: math_add(-3: 3));
end-proc;

dcl-proc test_factorial_ofZeroIsOne export;
  assertEqualsInt(1: math_factorial(0));
end-proc;

dcl-proc test_factorial_ofFive export;
  assertEqualsInt(120: math_factorial(5));
end-proc;

dcl-proc test_factorial_ofTwenty export;
  assertEqualsInt(2432902008176640000: math_factorial(20));
end-proc;

dcl-proc test_factorial_rejectsOutOfRange export;
  assertEqualsInt(-1: math_factorial(-1): 'negative input');
  assertEqualsInt(-1: math_factorial(21): 'overflow guard');
end-proc;

dcl-proc test_isPrime_knownPrimes export;
  assertTrue(math_isPrime(2): '2');
  assertTrue(math_isPrime(3): '3');
  assertTrue(math_isPrime(17): '17');
  assertTrue(math_isPrime(7919): '7919');
end-proc;

dcl-proc test_isPrime_nonPrimes export;
  assertFalse(math_isPrime(0): '0');
  assertFalse(math_isPrime(1): '1');
  assertFalse(math_isPrime(9): '9');
  assertFalse(math_isPrime(7917): '7917');
end-proc;

dcl-proc test_round_halfAdjusts export;
  assertEqualsDec(2.35: math_round(2.345: 2));
  assertEqualsDec(-2.35: math_round(-2.345: 2));
  assertEqualsDec(3: math_round(2.5: 0));
  assertEqualsDec(1.2346: math_round(1.23456: 4));
end-proc;

dcl-proc test_safeDivide_byZeroReturnsZero export;
  assertEqualsDec(0: math_safeDivide(10: 0));
end-proc;

dcl-proc test_safeDivide_rounds export;
  assertEqualsDec(3.33333: math_safeDivide(10: 3));
  assertEqualsDec(2.5: math_safeDivide(5: 2));
end-proc;
