/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Stub Oblivious HTTP for wasm32-unknown-linux-musl.
//!
//! ohttp's NSS backend needs bindgen that is incomplete on this target, and
//! the rust-hpke backend is not vendored in-tree. OHTTP is unused for the
//! TinyX example.com demo path.

extern crate nserror;
extern crate thin_vec;
#[macro_use]
extern crate xpcom;

use nserror::{nsresult, NS_ERROR_NOT_IMPLEMENTED, NS_OK};
use thin_vec::ThinVec;
use xpcom::interfaces::{
    nsIObliviousHttpClientRequest, nsIObliviousHttpClientResponse, nsIObliviousHttpServer,
    nsIObliviousHttpServerResponse,
};
use xpcom::{xpcom_method, RefPtr};

#[xpcom(implement(nsIObliviousHttpClientResponse), atomic)]
struct ObliviousHttpClientResponse {}

impl ObliviousHttpClientResponse {
    xpcom_method!(decapsulate => Decapsulate(enc_response: *const ThinVec<u8>) -> ThinVec<u8>);
    fn decapsulate(&self, _enc_response: &ThinVec<u8>) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[xpcom(implement(nsIObliviousHttpClientRequest), atomic)]
struct ObliviousHttpClientRequest {}

impl ObliviousHttpClientRequest {
    xpcom_method!(get_enc_request => GetEncRequest() -> ThinVec<u8>);
    fn get_enc_request(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(get_response => GetResponse() -> *const nsIObliviousHttpClientResponse);
    fn get_response(&self) -> Result<RefPtr<nsIObliviousHttpClientResponse>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[xpcom(implement(nsIObliviousHttpServerResponse), atomic)]
struct ObliviousHttpServerResponse {}

impl ObliviousHttpServerResponse {
    xpcom_method!(get_request => GetRequest() -> ThinVec<u8>);
    fn get_request(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(encapsulate => Encapsulate(response: *const ThinVec<u8>) -> ThinVec<u8>);
    fn encapsulate(&self, _response: &ThinVec<u8>) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[xpcom(implement(nsIObliviousHttpServer), atomic)]
struct ObliviousHttpServer {}

impl ObliviousHttpServer {
    xpcom_method!(get_encoded_config => GetEncodedConfig() -> ThinVec<u8>);
    fn get_encoded_config(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(decapsulate => Decapsulate(enc_request: *const ThinVec<u8>) -> *const nsIObliviousHttpServerResponse);
    fn decapsulate(
        &self,
        _enc_request: &ThinVec<u8>,
    ) -> Result<RefPtr<nsIObliviousHttpServerResponse>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[xpcom(implement(nsIObliviousHttp), atomic)]
struct ObliviousHttp {}

impl ObliviousHttp {
    xpcom_method!(encapsulate_request => EncapsulateRequest(encoded_config: *const ThinVec<u8>,
    request: *const ThinVec<u8>) -> *const nsIObliviousHttpClientRequest);
    fn encapsulate_request(
        &self,
        _encoded_config: &ThinVec<u8>,
        _request: &ThinVec<u8>,
    ) -> Result<RefPtr<nsIObliviousHttpClientRequest>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(server => Server() -> *const nsIObliviousHttpServer);
    fn server(&self) -> Result<RefPtr<nsIObliviousHttpServer>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[no_mangle]
pub extern "C" fn oblivious_http_constructor(
    iid: *const xpcom::nsIID,
    result: *mut *mut xpcom::reexports::libc::c_void,
) -> nserror::nsresult {
    let oblivious_http = ObliviousHttp::allocate(InitObliviousHttp {});
    unsafe { oblivious_http.QueryInterface(iid, result) }
}

// Keep NS_OK referenced so unused-import lint stays quiet if xpcom expands oddly.
#[allow(dead_code)]
fn _keep_ns_ok() -> nsresult {
    NS_OK
}
