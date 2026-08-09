/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! No-op gecko-profiler API for wasm32-unknown-linux-musl.
//!
//! MOZ_GECKO_PROFILER is not enabled for wasm32, but the real crate still
//! bindgens ProfilerBindings.h and fails when MarkerTiming et al. are absent.
//! Provide the public surface used by webrender/style as no-ops.

#[macro_use]
extern crate lazy_static;

pub mod gecko_bindings {
    pub mod profiling_categories;
    pub use profiling_categories::*;
}

pub use gecko_bindings::profiling_categories::*;
pub use serde::{Deserialize, Serialize};

pub use profiler_macros::gecko_profiler_fn_label;

#[inline]
pub fn is_active() -> bool {
    false
}

#[inline]
pub fn can_accept_markers() -> bool {
    false
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ProfilerTime;

impl ProfilerTime {
    pub fn now() -> Self {
        Self
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct MarkerTiming;

impl MarkerTiming {
    pub fn instant_at(_time: ProfilerTime) -> Self {
        Self
    }
    pub fn instant_now() -> Self {
        Self
    }
    pub fn interval(_start: ProfilerTime, _end: ProfilerTime) -> Self {
        Self
    }
    pub fn interval_until_now_from(_start: ProfilerTime) -> Self {
        Self
    }
    pub fn interval_start(_time: ProfilerTime) -> Self {
        Self
    }
    pub fn interval_end(_time: ProfilerTime) -> Self {
        Self
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub enum MarkerStack {
    #[default]
    NoStack,
    Full,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct MarkerOptions {
    pub timing: MarkerTiming,
    pub stack: MarkerStack,
}

pub trait ProfilerMarker {
    fn marker_type_name() -> &'static str;
    fn stream_json_marker_data(&self, _json_writer: &mut JsonWriter) {}
    fn marker_type_display() -> MarkerSchema {
        MarkerSchema::default()
    }
}

#[derive(Debug, Default)]
pub struct MarkerSchema;

#[derive(Debug, Default)]
pub struct JsonWriter;

impl JsonWriter {
    pub fn int_property(&mut self, _name: &str, _value: i64) {}
    pub fn uint_property(&mut self, _name: &str, _value: u64) {}
    pub fn bool_property(&mut self, _name: &str, _value: bool) {}
    pub fn string_property(&mut self, _name: &str, _value: &str) {}
    pub fn unique_string_property(&mut self, _name: &str, _value: &str) {}
    pub fn null_property(&mut self, _name: &str) {}
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Tracing(pub String);

impl ProfilerMarker for Tracing {
    fn marker_type_name() -> &'static str {
        "tracing"
    }
}

pub fn add_untyped_marker(
    _name: &str,
    _category: ProfilingCategoryPair,
    _options: MarkerOptions,
) {
}

pub fn add_text_marker(
    _name: &str,
    _category: ProfilingCategoryPair,
    _options: MarkerOptions,
    _text: &str,
) {
}

pub fn add_marker<T: ProfilerMarker>(
    _name: &str,
    _category: ProfilingCategoryPair,
    _options: MarkerOptions,
    _marker: T,
) {
}

pub fn register_thread(_thread_name: &str) {}

pub fn unregister_thread() {}

#[macro_export]
macro_rules! gecko_profiler_label {
    ($category:ident) => {};
    ($category:ident, $subcategory:ident) => {};
}
