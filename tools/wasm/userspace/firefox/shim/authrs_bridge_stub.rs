/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Stub WebAuthn authenticator bridge for wasm32-unknown-linux-musl.
//!
//! The real crate pulls authenticator-rs with crypto_nss / nss-gk-api, whose
//! NSS bindgen is incomplete on this target. WebAuthn is unused for the TinyX
//! example.com demo path.

#[macro_use]
extern crate xpcom;

use nserror::{
    nsresult, NS_ERROR_NOT_AVAILABLE, NS_ERROR_NOT_IMPLEMENTED, NS_ERROR_NULL_POINTER, NS_OK,
};
use nsstring::nsACString;
use nsstring::nsAString;
use thin_vec::ThinVec;
use xpcom::interfaces::{
    nsICredentialParameters, nsIWebAuthnAttObj, nsIWebAuthnAutoFillEntry, nsIWebAuthnRegisterArgs,
    nsIWebAuthnRegisterPromise, nsIWebAuthnService, nsIWebAuthnSignArgs, nsIWebAuthnSignPromise,
};
use xpcom::{xpcom_method, RefPtr};

#[xpcom(implement(nsIWebAuthnAttObj), atomic)]
struct WebAuthnAttObj {}

impl WebAuthnAttObj {
    xpcom_method!(get_attestation_object => GetAttestationObject() -> ThinVec<u8>);
    fn get_attestation_object(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_AVAILABLE)
    }

    xpcom_method!(get_authenticator_data => GetAuthenticatorData() -> ThinVec<u8>);
    fn get_authenticator_data(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_AVAILABLE)
    }

    xpcom_method!(get_public_key => GetPublicKey() -> ThinVec<u8>);
    fn get_public_key(&self) -> Result<ThinVec<u8>, nsresult> {
        Err(NS_ERROR_NOT_AVAILABLE)
    }

    xpcom_method!(get_public_key_algorithm => GetPublicKeyAlgorithm() -> i32);
    fn get_public_key_algorithm(&self) -> Result<i32, nsresult> {
        Err(NS_ERROR_NOT_AVAILABLE)
    }

    xpcom_method!(is_identifying => IsIdentifying() -> bool);
    fn is_identifying(&self) -> Result<bool, nsresult> {
        Ok(false)
    }
}

#[xpcom(implement(nsIWebAuthnService), atomic)]
struct AuthrsService {}

impl AuthrsService {
    xpcom_method!(get_is_uvpaa => GetIsUVPAA() -> bool);
    fn get_is_uvpaa(&self) -> Result<bool, nsresult> {
        Ok(false)
    }

    xpcom_method!(make_credential => MakeCredential(aTid: u64, aBrowsingContextId: u64, aArgs: *const nsIWebAuthnRegisterArgs, aPromise: *const nsIWebAuthnRegisterPromise));
    fn make_credential(
        &self,
        _tid: u64,
        _browsing_context_id: u64,
        _args: &nsIWebAuthnRegisterArgs,
        promise: &nsIWebAuthnRegisterPromise,
    ) -> Result<(), nsresult> {
        unsafe {
            let _ = promise.Reject(NS_ERROR_NOT_IMPLEMENTED);
        }
        Ok(())
    }

    xpcom_method!(get_assertion => GetAssertion(aTid: u64, aBrowsingContextId: u64, aArgs: *const nsIWebAuthnSignArgs, aPromise: *const nsIWebAuthnSignPromise));
    fn get_assertion(
        &self,
        _tid: u64,
        _browsing_context_id: u64,
        _args: &nsIWebAuthnSignArgs,
        promise: &nsIWebAuthnSignPromise,
    ) -> Result<(), nsresult> {
        unsafe {
            let _ = promise.Reject(NS_ERROR_NOT_IMPLEMENTED);
        }
        Ok(())
    }

    xpcom_method!(reset => Reset());
    fn reset(&self) -> Result<(), nsresult> {
        Ok(())
    }

    xpcom_method!(cancel => Cancel(aTransactionId: u64));
    fn cancel(&self, _tid: u64) -> Result<(), nsresult> {
        Ok(())
    }

    xpcom_method!(has_pending_conditional_get => HasPendingConditionalGet(aBrowsingContextId: u64, aOrigin: *const nsAString) -> u64);
    fn has_pending_conditional_get(
        &self,
        _browsing_context_id: u64,
        _origin: &nsAString,
    ) -> Result<u64, nsresult> {
        Ok(0)
    }

    xpcom_method!(get_autofill_entries => GetAutoFillEntries(aTransactionId: u64) -> ThinVec<Option<RefPtr<nsIWebAuthnAutoFillEntry>>>);
    fn get_autofill_entries(
        &self,
        _transaction_id: u64,
    ) -> Result<ThinVec<Option<RefPtr<nsIWebAuthnAutoFillEntry>>>, nsresult> {
        Ok(ThinVec::new())
    }

    xpcom_method!(select_autofill_entry => SelectAutoFillEntry(aTid: u64, aCredentialId: *const ThinVec<u8>));
    fn select_autofill_entry(
        &self,
        _tid: u64,
        _credential_id: &ThinVec<u8>,
    ) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(resume_conditional_get => ResumeConditionalGet(aTid: u64));
    fn resume_conditional_get(&self, _tid: u64) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(pin_callback => PinCallback(aTransactionId: u64, aPin: *const nsACString));
    fn pin_callback(&self, _transaction_id: u64, _pin: &nsACString) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(set_has_attestation_consent => SetHasAttestationConsent(aTid: u64, aHasConsent: bool));
    fn set_has_attestation_consent(&self, _tid: u64, _has_consent: bool) -> Result<(), nsresult> {
        Ok(())
    }

    xpcom_method!(selection_callback => SelectionCallback(aTransactionId: u64, aSelection: u64));
    fn selection_callback(&self, _transaction_id: u64, _selection: u64) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(
        add_virtual_authenticator => AddVirtualAuthenticator(
            protocol: *const nsACString,
            transport: *const nsACString,
            hasResidentKey: bool,
            hasUserVerification: bool,
            isUserConsenting: bool,
            isUserVerified: bool
        ) -> u64
    );
    fn add_virtual_authenticator(
        &self,
        _protocol: &nsACString,
        _transport: &nsACString,
        _has_resident_key: bool,
        _has_user_verification: bool,
        _is_user_consenting: bool,
        _is_user_verified: bool,
    ) -> Result<u64, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(remove_virtual_authenticator => RemoveVirtualAuthenticator(authenticatorId: u64));
    fn remove_virtual_authenticator(&self, _authenticator_id: u64) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(
        add_credential => AddCredential(
            authenticatorId: u64,
            credentialId: *const nsACString,
            isResidentCredential: bool,
            rpId: *const nsACString,
            privateKey: *const nsACString,
            userHandle: *const nsACString,
            signCount: u32
        )
    );
    fn add_credential(
        &self,
        _authenticator_id: u64,
        _credential_id: &nsACString,
        _is_resident_credential: bool,
        _rp_id: &nsACString,
        _private_key: &nsACString,
        _user_handle: &nsACString,
        _sign_count: u32,
    ) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(get_credentials => GetCredentials(authenticatorId: u64) -> ThinVec<Option<RefPtr<nsICredentialParameters>>>);
    fn get_credentials(
        &self,
        _authenticator_id: u64,
    ) -> Result<ThinVec<Option<RefPtr<nsICredentialParameters>>>, nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(remove_credential => RemoveCredential(authenticatorId: u64, credentialId: *const nsACString));
    fn remove_credential(
        &self,
        _authenticator_id: u64,
        _credential_id: &nsACString,
    ) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(remove_all_credentials => RemoveAllCredentials(authenticatorId: u64));
    fn remove_all_credentials(&self, _authenticator_id: u64) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(set_user_verified => SetUserVerified(authenticatorId: u64, isUserVerified: bool));
    fn set_user_verified(
        &self,
        _authenticator_id: u64,
        _is_user_verified: bool,
    ) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(listen => Listen());
    fn listen(&self) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }

    xpcom_method!(run_command => RunCommand(c_cmd: *const nsACString));
    fn run_command(&self, _c_cmd: &nsACString) -> Result<(), nsresult> {
        Err(NS_ERROR_NOT_IMPLEMENTED)
    }
}

#[no_mangle]
pub extern "C" fn authrs_service_constructor(result: *mut *const nsIWebAuthnService) -> nsresult {
    if result.is_null() {
        return NS_ERROR_NULL_POINTER;
    }
    let wrapper = AuthrsService::allocate(InitAuthrsService {});
    unsafe {
        RefPtr::new(wrapper.coerce::<nsIWebAuthnService>()).forget(&mut *result);
    }
    NS_OK
}

#[no_mangle]
pub extern "C" fn authrs_webauthn_att_obj_constructor(
    _att_obj_bytes: &ThinVec<u8>,
    _anonymize: bool,
    result: *mut *const nsIWebAuthnAttObj,
) -> nsresult {
    if result.is_null() {
        return NS_ERROR_NULL_POINTER;
    }
    NS_ERROR_NOT_IMPLEMENTED
}
