**free
// ---------------------------------------------------------------------------
// MATHUTIL - sample service program for IBM i Unit
// Build:  CRTRPGMOD MODULE(IUNITSAMP/MATHUTIL) SRCSTMF('.../mathutil.rpgle')
//         CRTSRVPGM SRVPGM(IUNITSAMP/MATHUTIL) EXPORT(*ALL)
// (or run "IBM i Unit: Build Sample Programs on IBM i")
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'mathutil_h.rpgleinc'

dcl-proc math_add export;
  dcl-pi *n int(10);
    a int(10) const;
    b int(10) const;
  end-pi;
  return a + b;
end-proc;

dcl-proc math_factorial export;
  dcl-pi *n int(20);
    n int(10) const;
  end-pi;
  dcl-s result int(20) inz(1);
  dcl-s i int(10);

  if n < 0 or n > 20;
    return -1;
  endif;
  for i = 2 to n;
    result *= i;
  endfor;
  return result;
end-proc;

dcl-proc math_isPrime export;
  dcl-pi *n ind;
    n int(10) const;
  end-pi;
  dcl-s divisor int(10);

  if n < 2;
    return *off;
  endif;
  if n < 4;
    return *on;
  endif;
  if %rem(n: 2) = 0;
    return *off;
  endif;
  divisor = 3;
  dow divisor * divisor <= n;
    if %rem(n: divisor) = 0;
      return *off;
    endif;
    divisor += 2;
  enddo;
  return *on;
end-proc;

dcl-proc math_round export;
  dcl-pi *n packed(15: 5);
    value packed(15: 5) const;
    places int(10) const;
  end-pi;
  dcl-s factor packed(15: 0) inz(1);
  dcl-s scaled packed(25: 0);
  dcl-s result packed(15: 5);
  dcl-s i int(10);

  if places < 0 or places > 5;
    return value;
  endif;
  for i = 1 to places;
    factor *= 10;
  endfor;
  eval(h) scaled = value * factor;
  result = scaled / factor;
  return result;
end-proc;

dcl-proc math_safeDivide export;
  dcl-pi *n packed(15: 5);
    dividend packed(15: 5) const;
    divisor packed(15: 5) const;
  end-pi;
  dcl-s result packed(15: 5);

  if divisor = 0;
    return 0;
  endif;
  eval(h) result = dividend / divisor;
  return result;
end-proc;
