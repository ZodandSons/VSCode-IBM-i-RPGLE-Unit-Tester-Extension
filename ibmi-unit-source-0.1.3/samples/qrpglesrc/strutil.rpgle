**free
// ---------------------------------------------------------------------------
// STRUTIL - sample service program for IBM i Unit
// Build:  CRTRPGMOD MODULE(IUNITSAMP/STRUTIL) SRCSTMF('.../strutil.rpgle')
//         CRTSRVPGM SRVPGM(IUNITSAMP/STRUTIL) EXPORT(*ALL)
// ---------------------------------------------------------------------------
ctl-opt nomain option(*srcstmt: *nodebugio);

/include 'strutil_h.rpgleinc'

dcl-c UPPER 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
dcl-c LOWER 'abcdefghijklmnopqrstuvwxyz';

dcl-proc str_reverse export;
  dcl-pi *n varchar(1024);
    value varchar(1024) const;
  end-pi;
  dcl-s result varchar(1024) inz('');
  dcl-s i int(10);

  for i = %len(value) downto 1;
    result += %subst(value: i: 1);
  endfor;
  return result;
end-proc;

dcl-proc str_padLeft export;
  dcl-pi *n varchar(1024);
    value varchar(1024) const;
    length int(10) const;
    padChar char(1) const;
  end-pi;
  dcl-s result varchar(1024);
  dcl-s target int(10);

  result = value;
  target = length;
  if target > 1024;
    target = 1024;
  endif;
  dow %len(result) < target;
    result = padChar + result;
  enddo;
  return result;
end-proc;

dcl-proc str_capitalize export;
  dcl-pi *n varchar(1024);
    value varchar(1024) const;
  end-pi;
  dcl-s result varchar(1024);
  dcl-s ch char(1);
  dcl-s startOfWord ind inz(*on);
  dcl-s i int(10);

  result = %xlate(UPPER: LOWER: value);
  for i = 1 to %len(result);
    ch = %subst(result: i: 1);
    if ch = ' ';
      startOfWord = *on;
    elseif startOfWord;
      %subst(result: i: 1) = %xlate(LOWER: UPPER: ch);
      startOfWord = *off;
    endif;
  endfor;
  return result;
end-proc;

dcl-proc str_countOccurrences export;
  dcl-pi *n int(10);
    value varchar(1024) const;
    search varchar(256) const;
  end-pi;
  dcl-s count int(10) inz(0);
  dcl-s pos int(10) inz(1);
  dcl-s found int(10);

  if %len(search) = 0 or %len(value) = 0;
    return 0;
  endif;
  dow pos <= %len(value);
    found = %scan(search: value: pos);
    if found = 0;
      leave;
    endif;
    count += 1;
    pos = found + %len(search);
  enddo;
  return count;
end-proc;
