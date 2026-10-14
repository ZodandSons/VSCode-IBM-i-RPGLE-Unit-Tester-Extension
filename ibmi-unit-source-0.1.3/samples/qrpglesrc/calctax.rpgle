**free
// ---------------------------------------------------------------------------
// CALCTAX - sample *PGM for IBM i Unit (tests call it through EXTPGM)
// Build:  CRTBNDRPG PGM(IUNITSAMP/CALCTAX) SRCSTMF('.../calctax.rpgle')
//
// Parameters
//   amount      packed(11:2)  input, must be >= 0
//   state       char(2)       input, US state code (case-insensitive)
//   tax         packed(11:2)  output, half-adjusted
//   returnCode  char(1)       output: '0' ok, '1' unknown state,
//                                     '2' negative amount
// ---------------------------------------------------------------------------
ctl-opt dftactgrp(*no) actgrp(*caller) main(calcTax)
        option(*srcstmt: *nodebugio);

dcl-c UPPER 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
dcl-c LOWER 'abcdefghijklmnopqrstuvwxyz';

dcl-proc calcTax;
  dcl-pi *n extpgm('CALCTAX');
    amount packed(11: 2) const;
    state char(2) const;
    tax packed(11: 2);
    returnCode char(1);
  end-pi;
  dcl-s rate packed(7: 5);
  dcl-s code char(2);

  tax = 0;
  if amount < 0;
    returnCode = '2';
    return;
  endif;

  code = %xlate(LOWER: UPPER: state);
  select;
    when code = 'TX' or code = 'IL';
      rate = 0.0625;
    when code = 'CA';
      rate = 0.0725;
    when code = 'NY';
      rate = 0.04;
    when code = 'OR' or code = 'MT' or code = 'NH' or code = 'DE';
      rate = 0;
    other;
      returnCode = '1';
      return;
  endsl;

  eval(h) tax = amount * rate;
  returnCode = '0';
end-proc;
