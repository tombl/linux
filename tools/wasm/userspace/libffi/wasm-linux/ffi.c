/* wasm32-unknown-linux-musl native libffi port (no Emscripten, no mmap).
 *
 * Function pointers on this target are __indirect_function_table indices.
 * ffi_call supports GObject's g_cclosure_marshal_generic (integer/pointer/float
 * args, arity <= 8). Closure trampolines are recorded in the closure object;
 * indirect invocation still needs wasm table stubs (future work).
 */

#include <ffi.h>
#include <ffi_common.h>

#include <alloca.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define STACK_ARG_SIZE(x) FFI_ALIGN (x, FFI_SIZEOF_ARG)

static ffi_status
initialize_aggregate (ffi_type *arg)
{
  ffi_type **ptr;

  FFI_ASSERT (arg != NULL);
  FFI_ASSERT (arg->elements != NULL);
  FFI_ASSERT (arg->size == 0);
  FFI_ASSERT (arg->alignment == 0);

  for (ptr = arg->elements; *ptr != NULL; ptr++)
    {
      if ((*ptr)->size == 0 && initialize_aggregate (*ptr) != FFI_OK)
        return FFI_BAD_TYPEDEF;
      FFI_ASSERT (ffi_type_test (*ptr));
      arg->size += (*ptr)->size;
      if ((*ptr)->alignment > arg->alignment)
        arg->alignment = (*ptr)->alignment;
    }

  return arg->size == 0 ? FFI_BAD_TYPEDEF : FFI_OK;
}

ffi_status
ffi_prep_cif_machdep (ffi_cif *cif)
{
  ffi_type **ptr;
  unsigned bytes = 0;
  unsigned int i;

  if (cif->rtype->size == 0 && initialize_aggregate (cif->rtype) != FFI_OK)
    return FFI_BAD_TYPEDEF;

  for (ptr = cif->arg_types, i = cif->nargs; i > 0; i--, ptr++)
    {
      if ((*ptr)->size == 0 && initialize_aggregate (*ptr) != FFI_OK)
        return FFI_BAD_TYPEDEF;

      bytes = STACK_ARG_SIZE (bytes);
      bytes += STACK_ARG_SIZE ((*ptr)->size);
    }

  cif->bytes = bytes;

  switch (cif->rtype->type)
    {
    case FFI_TYPE_VOID:
    case FFI_TYPE_STRUCT:
    case FFI_TYPE_FLOAT:
    case FFI_TYPE_DOUBLE:
    case FFI_TYPE_UINT64:
    case FFI_TYPE_SINT64:
    case FFI_TYPE_LONGDOUBLE:
      cif->flags = (unsigned) cif->rtype->type;
      break;
    default:
      cif->flags = FFI_TYPE_INT;
      break;
    }

  if (!cif->nfixedargs)
    cif->nfixedargs = cif->nargs;

  return FFI_OK;
}

ffi_status
ffi_prep_cif_machdep_var (ffi_cif *cif, unsigned int nfixedargs,
                          unsigned int ntotalargs)
{
  cif->nfixedargs = nfixedargs;
  (void) ntotalargs;
  return ffi_prep_cif_machdep (cif);
}

static uintptr_t
load_uint_arg (ffi_type *type, void *src)
{
  switch (type->type)
    {
    case FFI_TYPE_UINT8:
      return *(uint8_t *) src;
    case FFI_TYPE_SINT8:
      return (uintptr_t) *(int8_t *) src;
    case FFI_TYPE_UINT16:
      return *(uint16_t *) src;
    case FFI_TYPE_SINT16:
      return (uintptr_t) *(int16_t *) src;
    case FFI_TYPE_UINT32:
    case FFI_TYPE_SINT32:
    case FFI_TYPE_INT:
      return *(uint32_t *) src;
    case FFI_TYPE_POINTER:
      return (uintptr_t) *(void **) src;
    case FFI_TYPE_FLOAT:
      return *(uintptr_t *) src;
    case FFI_TYPE_DOUBLE:
    case FFI_TYPE_UINT64:
    case FFI_TYPE_SINT64:
      return *(uintptr_t *) src;
    case FFI_TYPE_STRUCT:
      if (type->size <= FFI_SIZEOF_ARG)
        return *(uintptr_t *) src;
      return (uintptr_t) src;
    default:
      return *(uintptr_t *) src;
    }
}

typedef void (*fn_v)(void);
typedef void (*fn_vu)(uintptr_t);
typedef void (*fn_vuu)(uintptr_t, uintptr_t);
typedef void (*fn_vuuu)(uintptr_t, uintptr_t, uintptr_t);
typedef void (*fn_vuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef void (*fn_vuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef void (*fn_vuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef void (*fn_vuuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef void (*fn_vuuuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);

typedef uintptr_t (*fn_u)(void);
typedef uintptr_t (*fn_uu)(uintptr_t);
typedef uintptr_t (*fn_uuu)(uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuu)(uintptr_t, uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
typedef uintptr_t (*fn_uuuuuuuuu)(uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);

static void
call_void (ffi_cif *cif, void (*fn) (void), uintptr_t *args)
{
  switch (cif->nargs)
    {
    case 0: ((fn_v) fn) (); break;
    case 1: ((fn_vu) fn) (args[0]); break;
    case 2: ((fn_vuu) fn) (args[0], args[1]); break;
    case 3: ((fn_vuuu) fn) (args[0], args[1], args[2]); break;
    case 4: ((fn_vuuuu) fn) (args[0], args[1], args[2], args[3]); break;
    case 5: ((fn_vuuuuu) fn) (args[0], args[1], args[2], args[3], args[4]); break;
    case 6: ((fn_vuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5]); break;
    case 7: ((fn_vuuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5], args[6]); break;
    case 8: ((fn_vuuuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7]); break;
    default: abort ();
    }
}

static uintptr_t
call_uint (ffi_cif *cif, void (*fn) (void), uintptr_t *args)
{
  switch (cif->nargs)
    {
    case 0: return ((fn_u) fn) ();
    case 1: return ((fn_uu) fn) (args[0]);
    case 2: return ((fn_uuu) fn) (args[0], args[1]);
    case 3: return ((fn_uuuu) fn) (args[0], args[1], args[2]);
    case 4: return ((fn_uuuuu) fn) (args[0], args[1], args[2], args[3]);
    case 5: return ((fn_uuuuuu) fn) (args[0], args[1], args[2], args[3], args[4]);
    case 6: return ((fn_uuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5]);
    case 7: return ((fn_uuuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    case 8: return ((fn_uuuuuuuuu) fn) (args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
    default: abort ();
    }
}

void
ffi_call (ffi_cif *cif, void (*fn) (void), void *rvalue, void **avalue)
{
  uintptr_t args[8];
  void *struct_copies[8];

  if (cif->abi != FFI_WASM_LINUX)
    return;

  if (cif->nargs > 8)
    abort ();

  for (unsigned i = 0; i < cif->nargs; i++)
    {
      ffi_type *t = cif->arg_types[i];
      if (t->type == FFI_TYPE_STRUCT && t->size > FFI_SIZEOF_ARG)
        {
          struct_copies[i] = alloca (t->size);
          memcpy (struct_copies[i], avalue[i], t->size);
          args[i] = (uintptr_t) struct_copies[i];
        }
      else
        args[i] = load_uint_arg (t, avalue[i]);
    }

  if (cif->rtype->type == FFI_TYPE_STRUCT)
    {
      void *buf = alloca (cif->rtype->size > FFI_SIZEOF_ARG ? cif->rtype->size : FFI_SIZEOF_ARG);
      ffi_cif call_cif = *cif;
      call_cif.rtype = &ffi_type_pointer;
      call_cif.flags = FFI_TYPE_POINTER;
      uintptr_t hidden = (uintptr_t) buf;
      uintptr_t sargs[9];
      memcpy (sargs, args, sizeof (uintptr_t) * cif->nargs);
      sargs[cif->nargs] = hidden;
      call_cif.nargs = cif->nargs + 1;
      call_void (&call_cif, fn, sargs);
      if (rvalue)
        memcpy (rvalue, buf, cif->rtype->size);
      return;
    }

  if (cif->rtype->type == FFI_TYPE_VOID)
    {
      call_void (cif, fn, args);
      return;
    }

  uintptr_t ret = call_uint (cif, fn, args);

  if (!rvalue)
    return;

  switch (cif->rtype->type)
    {
    case FFI_TYPE_UINT8:
    case FFI_TYPE_SINT8:
    case FFI_TYPE_UINT16:
    case FFI_TYPE_SINT16:
    case FFI_TYPE_UINT32:
    case FFI_TYPE_SINT32:
    case FFI_TYPE_INT:
      *(ffi_arg *) rvalue = (ffi_arg) ret;
      break;
    case FFI_TYPE_POINTER:
      *(void **) rvalue = (void *) ret;
      break;
    case FFI_TYPE_FLOAT:
      *(float *) rvalue = *(float *) &ret;
      break;
    case FFI_TYPE_DOUBLE:
    case FFI_TYPE_UINT64:
    case FFI_TYPE_SINT64:
      memcpy (rvalue, &ret, cif->rtype->size);
      break;
    default:
      memcpy (rvalue, &ret, cif->rtype->size);
      break;
    }
}

void *
ffi_closure_alloc (size_t size, void **code)
{
  void *closure = malloc (size);

  if (closure == NULL)
    return NULL;

  if (code != NULL)
    *code = FFI_FN (closure);

  return closure;
}

void
ffi_closure_free (void *closure)
{
  free (closure);
}

ffi_status
ffi_prep_closure_loc (ffi_closure *closure, ffi_cif *cif,
                      void (*fun) (ffi_cif *, void *, void **, void *),
                      void *user_data, void *codeloc)
{
  (void) codeloc;

  if (cif->abi != FFI_WASM_LINUX)
    return FFI_BAD_ABI;

  closure->cif = cif;
  closure->fun = fun;
  closure->user_data = user_data;

  return FFI_OK;
}
