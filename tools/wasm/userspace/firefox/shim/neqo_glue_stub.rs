/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! Stub Neqo/HTTP3 glue for wasm32-unknown-linux-musl.
//!
//! Full neqo-crypto NSS bindgen is not reliable on this target yet.
//! HTTPS still works via HTTP/1.1 and HTTP/2; HTTP/3 fails closed.

use nserror::{nsresult, NS_ERROR_NOT_AVAILABLE, NS_ERROR_NOT_IMPLEMENTED, NS_OK};
use nsstring::{nsACString, nsCString};
use std::os::raw::c_void;
use std::ptr;
use thin_vec::ThinVec;
use xpcom::{AtomicRefcnt, RefCounted};

#[repr(C)]
pub struct NeqoHttp3Conn {
    refcnt: AtomicRefcnt,
}

#[repr(C)]
pub union NetAddr {
    private: [u8; 0],
}

type SendFunc = extern "C" fn(
    context: *mut c_void,
    addr_family: u16,
    addr: *const u8,
    port: u16,
    data: *const u8,
    size: u32,
) -> nsresult;

type SetTimerFunc = extern "C" fn(context: *mut c_void, timeout: u64);

/// NSPR PRErrorCode
pub type PRErrorCode = i32;

#[repr(C)]
pub enum CloseError {
    TransportInternalError,
    TransportInternalErrorOther(u16),
    TransportError(u64),
    CryptoError(u64),
    CryptoAlert(u8),
    PeerAppError(u64),
    PeerError(u64),
    AppError(u64),
    EchRetry,
}

#[repr(C)]
pub enum WebTransportStreamType {
    BiDi,
    UniDi,
}

#[repr(C)]
pub enum SessionCloseReasonExternal {
    Error(u64),
    Status(u16),
    Clean(u32),
}

#[repr(C)]
pub enum WebTransportEventExternal {
    Negotiated(bool),
    Session(u64),
    SessionClosed {
        stream_id: u64,
        reason: SessionCloseReasonExternal,
    },
    NewStream {
        stream_id: u64,
        stream_type: WebTransportStreamType,
        session_id: u64,
    },
    Datagram {
        session_id: u64,
    },
}

#[repr(C)]
pub enum Http3Event {
    DataWritable { stream_id: u64 },
    StopSending { stream_id: u64, error: u64 },
    HeaderReady {
        stream_id: u64,
        fin: bool,
        interim: bool,
    },
    DataReadable { stream_id: u64 },
    Reset {
        stream_id: u64,
        error: u64,
        local: bool,
    },
    PushPromise {
        push_id: u64,
        request_stream_id: u64,
    },
    PushHeaderReady { push_id: u64, fin: bool },
    PushDataReadable { push_id: u64 },
    PushCanceled { push_id: u64 },
    PushReset { push_id: u64, error: u64 },
    RequestsCreatable,
    AuthenticationNeeded,
    ZeroRttRejected,
    ConnectionConnected,
    GoawayReceived,
    ConnectionClosing { error: CloseError },
    ConnectionClosed { error: CloseError },
    ResumptionToken { expire_in: u64 },
    EchFallbackAuthenticationNeeded,
    WebTransport(WebTransportEventExternal),
    NoEvent,
}

#[repr(C)]
pub struct NeqoSecretInfo {
    set: bool,
    version: u16,
    cipher: u16,
    group: u16,
    resumed: bool,
    early_data: bool,
    alpn: nsCString,
    signature_scheme: u16,
    ech_accepted: bool,
}

#[repr(C)]
pub struct NeqoCertificateInfo {
    certs: ThinVec<ThinVec<u8>>,
    stapled_ocsp_responses_present: bool,
    stapled_ocsp_responses: ThinVec<ThinVec<u8>>,
    signed_cert_timestamp_present: bool,
    signed_cert_timestamp: ThinVec<u8>,
}

#[repr(C)]
#[derive(Default)]
pub struct Http3Stats {
    pub packets_rx: usize,
    pub dups_rx: usize,
    pub dropped_rx: usize,
    pub saved_datagrams: usize,
    pub packets_tx: usize,
    pub lost: usize,
    pub late_ack: usize,
    pub pto_ack: usize,
    pub pto_counts: [usize; 16],
}

#[no_mangle]
pub unsafe extern "C" fn neqo_http3conn_addref(conn: &NeqoHttp3Conn) {
    conn.refcnt.inc();
}

#[no_mangle]
pub unsafe extern "C" fn neqo_http3conn_release(conn: &NeqoHttp3Conn) {
    let rc = conn.refcnt.dec();
    if rc == 0 {
        std::mem::drop(Box::from_raw(conn as *const _ as *mut NeqoHttp3Conn));
    }
}

unsafe impl RefCounted for NeqoHttp3Conn {
    unsafe fn addref(&self) {
        neqo_http3conn_addref(self);
    }
    unsafe fn release(&self) {
        neqo_http3conn_release(self);
    }
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_new(
    _origin: &nsACString,
    _alpn: &nsACString,
    _local_addr: *const NetAddr,
    _remote_addr: *const NetAddr,
    _max_table_size: u64,
    _max_blocked_streams: u16,
    _max_data: u64,
    _max_stream_data: u64,
    _version_negotiation: bool,
    _webtransport: bool,
    _qlog_dir: &nsACString,
    _webtransport_datagram_size: u32,
    _max_accumlated_time_ms: u32,
    _provider_flags: u32,
    result: &mut *const NeqoHttp3Conn,
) -> nsresult {
    *result = ptr::null();
    NS_ERROR_NOT_AVAILABLE
}

#[no_mangle]
pub unsafe extern "C" fn neqo_http3conn_process_input(
    _conn: &mut NeqoHttp3Conn,
    _remote_addr: *const NetAddr,
    _packet: *const ThinVec<u8>,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_process_output_and_send(
    _conn: &mut NeqoHttp3Conn,
    _context: *mut c_void,
    _send_func: SendFunc,
    _set_timer_func: SetTimerFunc,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_close(_conn: &mut NeqoHttp3Conn, _error: u64) {}

#[no_mangle]
pub extern "C" fn neqo_http3conn_fetch(
    _conn: &mut NeqoHttp3Conn,
    _method: &nsACString,
    _scheme: &nsACString,
    _host: &nsACString,
    _path: &nsACString,
    _headers: &nsACString,
    _stream_id: &mut u64,
    _urgency: u8,
    _incremental: bool,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_priority_update(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _urgency: u8,
    _incremental: bool,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub unsafe extern "C" fn neqo_htttp3conn_send_request_body(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _buf: *const u8,
    _len: u32,
    _read: &mut u32,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_cancel_fetch(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _error: u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_reset_stream(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _error: u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_stream_stop_sending(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _error: u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_close_stream(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_event(
    _conn: &mut NeqoHttp3Conn,
    ret_event: &mut Http3Event,
    _data: &mut ThinVec<u8>,
) -> nsresult {
    *ret_event = Http3Event::NoEvent;
    NS_OK
}

#[no_mangle]
pub unsafe extern "C" fn neqo_http3conn_read_response_data(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _buf: *mut u8,
    _len: u32,
    _read: &mut u32,
    _fin: &mut bool,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_tls_info(
    _conn: &mut NeqoHttp3Conn,
    _sec_info: &mut NeqoSecretInfo,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_peer_certificate_info(
    _conn: &mut NeqoHttp3Conn,
    _neqo_certs_info: &mut NeqoCertificateInfo,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_authenticated(_conn: &mut NeqoHttp3Conn, _error: PRErrorCode) {}

#[no_mangle]
pub extern "C" fn neqo_http3conn_set_resumption_token(
    _conn: &mut NeqoHttp3Conn,
    _token: &mut ThinVec<u8>,
) {
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_set_ech_config(
    _conn: &mut NeqoHttp3Conn,
    _ech_config: &mut ThinVec<u8>,
) {
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_is_zero_rtt(_conn: &mut NeqoHttp3Conn) -> bool {
    false
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_get_stats(_conn: &mut NeqoHttp3Conn, stats: &mut Http3Stats) {
    *stats = Http3Stats::default();
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_create_session(
    _conn: &mut NeqoHttp3Conn,
    _host: &nsACString,
    _path: &nsACString,
    _headers: &nsACString,
    _stream_id: &mut u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_close_session(
    _conn: &mut NeqoHttp3Conn,
    _session_id: u64,
    _error: u32,
    _message: &nsACString,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_create_stream(
    _conn: &mut NeqoHttp3Conn,
    _session_id: u64,
    _stream_type: WebTransportStreamType,
    _stream_id: &mut u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_send_datagram(
    _conn: &mut NeqoHttp3Conn,
    _session_id: u64,
    _data: &mut ThinVec<u8>,
    _tracking_id: u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_max_datagram_size(
    _conn: &mut NeqoHttp3Conn,
    _session_id: u64,
    _result: &mut u64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}

#[no_mangle]
pub extern "C" fn neqo_http3conn_webtransport_set_sendorder(
    _conn: &mut NeqoHttp3Conn,
    _stream_id: u64,
    _sendorder: *const i64,
) -> nsresult {
    NS_ERROR_NOT_IMPLEMENTED
}
