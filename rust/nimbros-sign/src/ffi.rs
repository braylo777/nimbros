//! C ABI, so a C++, Python or Go agent can sign locally with its own Solana key using the same implementation.
//! Every function returns the number of bytes written, or a negative number on error, and never panics across the boundary.

use crate::Keypair;
use std::slice;

const ERR_ARGS: i32 = -1;
const ERR_SPACE: i32 = -2;

unsafe fn write_out(text: &str, out: *mut u8, cap: usize) -> i32 {
    let b = text.as_bytes();
    if b.len() > cap {
        return ERR_SPACE;
    }
    std::ptr::copy_nonoverlapping(b.as_ptr(), out, b.len());
    b.len() as i32
}

/// `seed`: 32 bytes. `msg`/`msg_len`: the bytes to sign (a serialized transaction, or any other message). Writes the base64
/// signature (no NUL) into `out`.
///
/// # Safety
/// Pointers must be valid for the given lengths.
#[no_mangle]
pub unsafe extern "C" fn nb_sign_b64(
    seed: *const u8,
    msg: *const u8,
    msg_len: usize,
    out: *mut u8,
    cap: usize,
) -> i32 {
    if seed.is_null() || msg.is_null() || out.is_null() {
        return ERR_ARGS;
    }
    let s: [u8; 32] = match slice::from_raw_parts(seed, 32).try_into() {
        Ok(s) => s,
        Err(_) => return ERR_ARGS,
    };
    write_out(
        &Keypair::from_seed(s).sign_b64(slice::from_raw_parts(msg, msg_len)),
        out,
        cap,
    )
}

/// Same as `nb_sign_b64`, but writes the signature as base58 (the encoding Solana explorers use).
///
/// # Safety
/// Pointers must be valid for the given lengths.
#[no_mangle]
pub unsafe extern "C" fn nb_sign_b58(
    seed: *const u8,
    msg: *const u8,
    msg_len: usize,
    out: *mut u8,
    cap: usize,
) -> i32 {
    if seed.is_null() || msg.is_null() || out.is_null() {
        return ERR_ARGS;
    }
    let s: [u8; 32] = match slice::from_raw_parts(seed, 32).try_into() {
        Ok(s) => s,
        Err(_) => return ERR_ARGS,
    };
    write_out(
        &Keypair::from_seed(s).sign_b58(slice::from_raw_parts(msg, msg_len)),
        out,
        cap,
    )
}

/// Writes the base58 Solana address (32-44 characters) for a seed.
///
/// # Safety
/// Pointers must be valid for the given lengths.
#[no_mangle]
pub unsafe extern "C" fn nb_address(seed: *const u8, out: *mut u8, cap: usize) -> i32 {
    if seed.is_null() || out.is_null() {
        return ERR_ARGS;
    }
    let s: [u8; 32] = match slice::from_raw_parts(seed, 32).try_into() {
        Ok(s) => s,
        Err(_) => return ERR_ARGS,
    };
    write_out(&Keypair::from_seed(s).address(), out, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_matches_the_rust_api_and_reports_small_buffers() {
        let seed = [7u8; 32];
        let msg = [1u8, 2, 3, 4];
        let mut out = [0u8; 256];
        let n = unsafe {
            nb_sign_b64(
                seed.as_ptr(),
                msg.as_ptr(),
                msg.len(),
                out.as_mut_ptr(),
                out.len(),
            )
        };
        assert!(n > 0);
        assert_eq!(
            std::str::from_utf8(&out[..n as usize]).unwrap(),
            Keypair::from_seed(seed).sign_b64(&msg)
        );
        let mut tiny = [0u8; 4];
        assert_eq!(
            unsafe {
                nb_sign_b64(
                    seed.as_ptr(),
                    msg.as_ptr(),
                    msg.len(),
                    tiny.as_mut_ptr(),
                    tiny.len(),
                )
            },
            ERR_SPACE
        );
        assert_eq!(
            unsafe { nb_address(std::ptr::null(), out.as_mut_ptr(), out.len()) },
            ERR_ARGS
        );
    }
}
