/* Minimal stubs so libc++abi can link without libunwind on wasm32-linux.
 * Guest binaries are built with -fno-exceptions; these are never called. */
typedef int _Unwind_Reason_Code;
typedef void *_Unwind_Exception;
typedef void *_Unwind_Context;
typedef int _Unwind_Action;
typedef unsigned _Unwind_State;
typedef unsigned char _Unwind_Exception_Class;

_Unwind_Reason_Code _Unwind_RaiseException(_Unwind_Exception *exception_object) {
  (void)exception_object;
  return 0;
}

void _Unwind_Resume(_Unwind_Exception *exception_object) {
  (void)exception_object;
  __builtin_trap();
}

_Unwind_Reason_Code _Unwind_Resume_or_Rethrow(_Unwind_Exception *exception_object) {
  (void)exception_object;
  return 0;
}

void _Unwind_DeleteException(_Unwind_Exception *exception_object) {
  (void)exception_object;
}

_Unwind_Reason_Code _Unwind_ForcedUnwind(_Unwind_Exception *exception_object,
                                        void *stop, void *stop_parameter) {
  (void)exception_object;
  (void)stop;
  (void)stop_parameter;
  return 0;
}

unsigned long _Unwind_GetGR(_Unwind_Context *context, int index) {
  (void)context;
  (void)index;
  return 0;
}

void _Unwind_SetGR(_Unwind_Context *context, int index, unsigned long new_value) {
  (void)context;
  (void)index;
  (void)new_value;
}

unsigned long _Unwind_GetIP(_Unwind_Context *context) {
  (void)context;
  return 0;
}

void _Unwind_SetIP(_Unwind_Context *context, unsigned long new_value) {
  (void)context;
  (void)new_value;
}

unsigned long _Unwind_GetIPInfo(_Unwind_Context *context, int *ip_before_insn) {
  (void)context;
  if (ip_before_insn)
    *ip_before_insn = 0;
  return 0;
}

unsigned long _Unwind_GetLanguageSpecificData(_Unwind_Context *context) {
  (void)context;
  return 0;
}

unsigned long _Unwind_GetRegionStart(_Unwind_Context *context) {
  (void)context;
  return 0;
}

unsigned long _Unwind_GetDataRelBase(_Unwind_Context *context) {
  (void)context;
  return 0;
}

unsigned long _Unwind_GetTextRelBase(_Unwind_Context *context) {
  (void)context;
  return 0;
}

void *_Unwind_FindEnclosingFunction(void *pc) {
  (void)pc;
  return 0;
}

_Unwind_Reason_Code _Unwind_Backtrace(void *callback, void *ref) {
  (void)callback;
  (void)ref;
  return 0;
}
