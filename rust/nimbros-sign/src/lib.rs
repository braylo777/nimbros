//! Solana ed25519 signing: exactly what a Solana wallet itself signs, byte for byte — no intent wrapper, no hashing before signing, unlike
//! Sui/Move's BCS-intent scheme. This crate signs whatever bytes it is given (a serialized transaction message, or a plain UTF-8 message for
//! an off-chain signature like `nimbros-link:<id>`); Solana does not distinguish the two at the cryptography layer, only in what the caller
//! puts together before signing. Verified byte-for-byte against `@noble/curves` + `bs58`, the same libraries `scripts/reference-agent.mjs` uses.
//!
//! * signature: raw ed25519 over the message bytes, 64 bytes
//! * address: base58(pubkey), 32 bytes — no hashing, unlike Sui
//!
//! This crate is for a non-JS AGENT (a C++, Python or Go bot) that wants to sign locally with a key it holds itself. NimBros never calls it
//! against a real key: every trade in the app is signed by the connected wallet, in the browser, and NimBros never holds one.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};

pub mod ffi;

pub struct Keypair {
    sk: SigningKey,
}

impl Keypair {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            sk: SigningKey::from_bytes(&seed),
        }
    }

    pub fn public(&self) -> [u8; 32] {
        self.sk.verifying_key().to_bytes()
    }

    /// A Solana wallet address: base58 of the raw public key.
    pub fn address(&self) -> String {
        address_of(&self.public())
    }

    /// Raw ed25519 signature over exactly these bytes — a serialized transaction message, or any other bytes a caller assembled.
    pub fn sign_raw(&self, bytes: &[u8]) -> [u8; 64] {
        self.sk.sign(bytes).to_bytes()
    }

    /// The signature as base64, the encoding `scripts/reference-agent.mjs` and the agent API use for `link_wallet`.
    pub fn sign_b64(&self, bytes: &[u8]) -> String {
        STANDARD.encode(self.sign_raw(bytes))
    }

    /// The signature as base58, the encoding Solana explorers use for on-chain transaction signatures.
    pub fn sign_b58(&self, bytes: &[u8]) -> String {
        bs58::encode(self.sign_raw(bytes)).into_string()
    }
}

pub fn address_of(pubkey: &[u8; 32]) -> String {
    bs58::encode(pubkey).into_string()
}

/// Checks a base64 ed25519 signature over `bytes`. Returns the signer's base58 address on success — the same check
/// `lib/solVerify.ts` (`verifySolMessage`) does server-side, so an agent can test its own signing against this before calling the API.
pub fn verify_b64(bytes: &[u8], sig_b64: &str, address: &str) -> Option<String> {
    let sig_raw = STANDARD.decode(sig_b64).ok()?;
    verify(bytes, &sig_raw, address)
}

fn verify(bytes: &[u8], sig_raw: &[u8], address: &str) -> Option<String> {
    if sig_raw.len() != 64 {
        return None;
    }
    let pk_raw = bs58::decode(address).into_vec().ok()?;
    let pk: [u8; 32] = pk_raw.try_into().ok()?;
    let vk = VerifyingKey::from_bytes(&pk).ok()?;
    let sig = ed25519_dalek::Signature::from_slice(sig_raw).ok()?;
    vk.verify(bytes, &sig).ok()?;
    Some(address_of(&pk))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vectors produced by @noble/curves + bs58 (scripts/gen_solana_vectors.mjs), the same libraries the JS reference agent and the
    // server's own verifySolMessage use — so this crate is checked against the app's actual crypto, not just against itself.
    fn seed() -> [u8; 32] {
        let mut s = [0u8; 32];
        for (i, b) in s.iter_mut().enumerate() {
            *b = i as u8 + 1;
        }
        s
    }
    const ADDRESS: &str = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";
    const PUB_HEX: &str = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
    const MSG: &[u8] = b"nimbros-link:abc123";
    const SIG_B64: &str =
        "7GpQEgGSIQdhWWaenajqnpDPeQlWjWX7FOOY+QwuM5wXG6uDH1/fYqNzkj0ePrS8tjTVmZxrrmI25Dbz0Nc1Aw==";

    #[test]
    fn address_and_public_key_match_noble_and_bs58() {
        let k = Keypair::from_seed(seed());
        assert_eq!(hex_encode(&k.public()), PUB_HEX);
        assert_eq!(k.address(), ADDRESS);
    }

    #[test]
    fn signature_matches_noble_curves_byte_for_byte() {
        let k = Keypair::from_seed(seed());
        assert_eq!(k.sign_b64(MSG), SIG_B64);
    }

    #[test]
    fn a_signature_verifies_only_for_its_own_bytes_and_address() {
        let k = Keypair::from_seed(seed());
        let sig = k.sign_b64(MSG);
        assert_eq!(
            verify_b64(MSG, &sig, &k.address()).as_deref(),
            Some(ADDRESS)
        );
        assert!(verify_b64(b"other bytes", &sig, &k.address()).is_none());
        assert!(verify_b64(MSG, &sig, "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpk").is_none()); // wrong address
        assert!(verify_b64(MSG, "not base64!!", &k.address()).is_none());
    }

    #[test]
    fn a_malformed_address_is_refused_not_panicked_on() {
        assert!(verify_b64(MSG, SIG_B64, "not-base58-\u{1F600}").is_none());
        assert!(verify_b64(MSG, SIG_B64, "").is_none());
    }

    fn hex_encode(b: &[u8]) -> String {
        b.iter().map(|x| format!("{:02x}", x)).collect()
    }
}
