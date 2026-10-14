**free
// ---------------------------------------------------------------------------
// Unit tests for program CALCTAX (a *PGM, called through EXTPGM).
// No binding needed - the program is found through the library list.
//
//#LIBL: IUNITSAMP
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'testassert.rpgleinc'

dcl-pr calcTax extpgm('CALCTAX');
  amount packed(11: 2) const;
  state char(2) const;
  tax packed(11: 2);
  returnCode char(1);
end-pr;

dcl-proc test_texas export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  calcTax(100.00: 'TX': tax: rc);
  assertEqualsChar('0': rc: 'return code');
  assertEqualsDec(6.25: tax: 'tax');
end-proc;

dcl-proc test_california_halfAdjusts export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  // 19.99 * 0.0725 = 1.449275 -> 1.45
  calcTax(19.99: 'CA': tax: rc);
  assertEqualsChar('0': rc: 'return code');
  assertEqualsDec(1.45: tax: 'tax');
end-proc;

dcl-proc test_stateIsCaseInsensitive export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  calcTax(200.00: 'ny': tax: rc);
  assertEqualsChar('0': rc: 'return code');
  assertEqualsDec(8.00: tax: 'tax');
end-proc;

dcl-proc test_noSalesTaxState export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  calcTax(500.00: 'OR': tax: rc);
  assertEqualsChar('0': rc);
  assertEqualsDec(0: tax);
end-proc;

dcl-proc test_unknownState_returnsCode1 export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  calcTax(100.00: 'ZZ': tax: rc);
  assertEqualsChar('1': rc: 'return code');
  assertEqualsDec(0: tax: 'tax');
end-proc;

dcl-proc test_negativeAmount_returnsCode2 export;
  dcl-s tax packed(11: 2);
  dcl-s rc char(1);
  calcTax(-1.00: 'TX': tax: rc);
  assertEqualsChar('2': rc: 'return code');
end-proc;
