/* Host gdbus-codegen may target GLib >= 2.84 while the wasm sysroot is older. */
#ifndef GLIB_VERSION_2_84
#define g_variant_builder_init_static(builder, type) \
  g_variant_builder_init ((builder), (type))
#endif
