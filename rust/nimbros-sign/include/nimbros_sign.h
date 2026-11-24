#ifndef NIMBROS_SIGN_H
#define NIMBROS_SIGN_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Solana ed25519 signing. Each returns bytes written (no NUL terminator), -1 for bad arguments, -2 if `cap` is too small.
   `seed` is 32 bytes: the Solana keypair's private seed (the same 32 bytes a `solana-keygen` JSON keypair file's first 32 bytes are). */
int32_t nb_sign_b64(const uint8_t* seed, const uint8_t* msg, size_t msg_len, uint8_t* out, size_t cap);
int32_t nb_sign_b58(const uint8_t* seed, const uint8_t* msg, size_t msg_len, uint8_t* out, size_t cap);
int32_t nb_address(const uint8_t* seed, uint8_t* out, size_t cap);
#ifdef __cplusplus
}
#endif
#endif
