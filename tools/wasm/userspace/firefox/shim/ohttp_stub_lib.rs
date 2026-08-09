/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Stub ohttp for wasm32-unknown-linux-musl.
//!
//! The real crate bindgens NSS (incomplete on this target). Telemetry OHTTP
//! upload is unused for the TinyX example.com demo path.

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("an error was found in the format")]
    Format,
    #[error("an internal error occurred")]
    Internal,
    #[error("the configuration was not supported")]
    Unsupported,
}

pub type Res<T> = Result<T, Error>;

pub type KeyId = u8;

pub fn init() {}

pub struct ClientRequest;

impl ClientRequest {
    pub fn new(_encoded_config: &[u8]) -> Res<Self> {
        Err(Error::Unsupported)
    }

    pub fn encapsulate(self, _request: &[u8]) -> Res<(Vec<u8>, ClientResponse)> {
        Err(Error::Unsupported)
    }
}

pub struct ClientResponse;

impl ClientResponse {
    pub fn decapsulate(self, _enc_response: &[u8]) -> Res<Vec<u8>> {
        Err(Error::Unsupported)
    }
}
