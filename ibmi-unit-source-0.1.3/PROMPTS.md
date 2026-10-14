# IBM i Unit — prompts by version

The prompts given to Claude to produce each version of the extension, reproduced verbatim. A short note after each one records what changed in response.

---

## 0.1.0 — First release

> Ibmi.  Create an vs code/ibm bob extension that will run unit tests for rpgle free programs and service programs.  The extension should leverage the Code4i extension connection to the ibmi

https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi

The extension should produce a report of the results

Create sample rpgle programs that can be used to test the new extension

---

## 0.1.1 — Remove CRTLIB, fix `liblist`, add icon

### Prompt 1

> I installed the .xsix but when running: IBM i Unit: Install Test Framework on IBM i
>
> CRTLIB I received an error - modify the extension - remove the CRTLIB, the specified library must be present on the IBMi
>
> ```Log
> [1:02:58 PM] Uploading mathutil.rpgle -> /home/JCWZOD/.ibmiunit/samples/mathutil.rpgle
> [1:03:01 PM] Uploading mathutil_h.rpgleinc -> /home/JCWZOD/.ibmiunit/samples/mathutil_h.rpgleinc
> [1:03:04 PM] Uploading strutil.rpgle -> /home/JCWZOD/.ibmiunit/samples/strutil.rpgle
> [1:03:07 PM] Uploading strutil_h.rpgleinc -> /home/JCWZOD/.ibmiunit/samples/strutil_h.rpgleinc
> [1:03:10 PM] Uploading calctax.rpgle -> /home/JCWZOD/.ibmiunit/samples/calctax.rpgle
> [1:03:12 PM] > CRTLIB LIB(JCWZOD2) TEXT('IBM i Unit samples')
> [1:03:13 PM] bsh: liblist: not found
> bsh: liblist: not found
> bsh: liblist: not found
> bsh: liblist: not found
> bsh: liblist: not found
> CPD0032: Not authorized to command CRTLIB in library *LIBL.
> CPF0006: Errors occurred in command.
> ```

### Prompt 2

> _(attached: `ibmi-unit-source.zip` and the extension icon image)_
>
> Also - add this image so it displays in the extension explorer in VS Code / Bob

**Result:**

- Both `CRTLIB` steps were replaced with a `CHKOBJ OBJ(QSYS/<lib>) OBJTYPE(*LIB)` check. The check gives a clear message when the library is missing or the user isn't authorized to it.
- `liblist` and `system` now run under QSH (`/QOpenSys/usr/bin/qsh`). Before, they ran in the PASE shell, which has no `liblist`.
- The image was cropped to a transparent circle and added as `images/icon.png`.

---

## 0.1.2 — Fix `CRTSQLRPGI` CCSID error

> When running the unit tests (installing IUNIT)
>
> ```Log
> RNS9305:  Module TESTASSERT placed in library JCWZOD2. 00 highest severity. Created on 26-10-13 at 18:24:26.
> CPC0904:  Data area RETURNCODE created in library QTEMP.
> [1:24:26 PM] > CRTSRVPGM SRVPGM(JCWZOD2/TESTASSERT) MODULE(JCWZOD2/TESTASSERT) EXPORT(*ALL) ACTGRP(*CALLER) REPLACE(*YES) TEXT('IBM i Unit assertions')
> [1:24:27 PM] CPC5D0B:  Service program TESTASSERT created in library JCWZOD2.
> [1:24:27 PM] > CRTSQLRPGI OBJ(JCWZOD2/RUNTEST) SRCSTMF('/home/JCWZOD/.ibmiunit/framework/runtest.sqlrpgle') OBJTYPE(*MODULE) COMMIT(*NONE) DBGVIEW(*SOURCE) RPGPPOPT(*LVL2) REPLACE(*YES) COMPILEOPT('INCDIR(''/home/JCWZOD/.ibmiunit/framework'')')
> [1:24:28 PM] RNS9380:  The source file CCSID 1208 is a Unicode CCSID which cannot be used with TGTCCSID(*SRC).
> RNS9339:  Unable to open file /home/JCWZOD/.ibmiunit/framework/runtest.sqlrpgle.
> CPC0904:  Data area RETURNCODE created in library QTEMP.
> RNS9309:  Compilation failed. Module RUNTEST not created in library JCWZOD2.
> SQL9019:  SQL precompile failed.
> [1:24:28 PM] Install failed: Command failed: CRTSQLRPGI - SQL9019:  SQL precompile failed.
> ```

**Result:**

- `TGTCCSID(*JOB)` is now passed through `COMPILEOPT` on `CRTSQLRPGI`. This applies both to the framework's `RUNTEST` and to user `.test.sqlrpgle` suites compiled from stream files.

---

## 0.1.3 — README screenshots and this file

> _(attached: five screenshots of the extension running in IBM Bob)_
>
> Add these images to the README.   Also create an .md containing each of the prompts used to create 0.1.0 thru 0.1.2

**Result:**

- Screenshots were added under `images/screenshots/`, with a Screenshots section in the README.
- Troubleshooting entries and a changelog were added to the README.
- This file was created.
