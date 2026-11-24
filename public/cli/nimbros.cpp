// NimBros CLI in C++17. One file, no dependencies except libcurl.
//
//   Build:   c++ -std=c++17 -O2 nimbros.cpp -lcurl -o nimbros
//   Check:   ./nimbros selftest
//   Use:     ./nimbros help
//
// It sets up an agent, watches Solana memecoins across every launchpad, manages a wallet, and trades real money on Solana.
// The crypto it needs (SHA-256, SHA-512, ed25519, base58, base64) is written out below and checked against
// known answers by `selftest`, so there is nothing to install besides libcurl (already on macOS; on Debian or
// Ubuntu: apt install libcurl4-openssl-dev). The private key never leaves your machine: linking a wallet sends
// only a signature.

#include <curl/curl.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using u8 = uint8_t;
using u64 = uint64_t;
using i64 = int64_t;
using Bytes = std::vector<u8>;

[[noreturn]] static void die(const std::string& msg) {
  std::cerr << "Error: " << msg << "\n";
  std::exit(1);
}

// ===================================================================================================
// Encoding helpers
// ===================================================================================================
static std::string to_hex(const u8* p, size_t n) {
  static const char* d = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < n; i++) { s += d[p[i] >> 4]; s += d[p[i] & 15]; }
  return s;
}
static std::string to_hex(const Bytes& b) { return to_hex(b.data(), b.size()); }
static Bytes unbase64(const std::string& in);
static std::string base64(const Bytes& in) {
  static const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    u64 n = (u64)in[i] << 16 | (u64)in[i + 1] << 8 | in[i + 2];
    out += t[n >> 18 & 63]; out += t[n >> 12 & 63]; out += t[n >> 6 & 63]; out += t[n & 63];
  }
  if (i + 1 == in.size()) {
    u64 n = (u64)in[i] << 16;
    out += t[n >> 18 & 63]; out += t[n >> 12 & 63]; out += "==";
  } else if (i + 2 == in.size()) {
    u64 n = (u64)in[i] << 16 | (u64)in[i + 1] << 8;
    out += t[n >> 18 & 63]; out += t[n >> 12 & 63]; out += t[n >> 6 & 63]; out += '=';
  }
  return out;
}

// ===================================================================================================
// SHA-512 (used by ed25519)
// ===================================================================================================
namespace sha512 {
static const u64 K[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL, 0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL, 0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL, 0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL, 0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL, 0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL, 0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL, 0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL, 0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
    0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL, 0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL, 0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL};
static const u64 H0[8] = {0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
                          0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL, 0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL};
static inline u64 rotr(u64 x, int n) { return (x >> n) | (x << (64 - n)); }

static void block(u64 h[8], const u8* p) {
  u64 w[80];
  for (int i = 0; i < 16; i++) { w[i] = 0; for (int j = 0; j < 8; j++) w[i] = (w[i] << 8) | p[8 * i + j]; }
  for (int i = 16; i < 80; i++) {
    u64 s0 = rotr(w[i - 15], 1) ^ rotr(w[i - 15], 8) ^ (w[i - 15] >> 7);
    u64 s1 = rotr(w[i - 2], 19) ^ rotr(w[i - 2], 61) ^ (w[i - 2] >> 6);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  u64 a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 80; i++) {
    u64 S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41), ch = (e & f) ^ (~e & g);
    u64 t1 = hh + S1 + ch + K[i] + w[i];
    u64 S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39), maj = (a & b) ^ (a & c) ^ (b & c);
    u64 t2 = S0 + maj;
    hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

static void hash(u8 out[64], const u8* m, size_t n) {
  u64 h[8];
  std::memcpy(h, H0, sizeof h);
  size_t i = 0;
  for (; i + 128 <= n; i += 128) block(h, m + i);
  u8 tail[256] = {0};
  size_t r = n - i;
  if (r) std::memcpy(tail, m + i, r);
  tail[r] = 0x80;
  size_t tl = r + 1 + 16 <= 128 ? 128 : 256;
  u64 bits = (u64)n * 8;  // the high 64 bits of the 128-bit length stay zero
  for (int j = 0; j < 8; j++) tail[tl - 1 - j] = (u8)(bits >> (8 * j));
  block(h, tail);
  if (tl == 256) block(h, tail + 128);
  for (int k = 0; k < 8; k++) for (int j = 0; j < 8; j++) out[8 * k + j] = (u8)(h[k] >> (56 - 8 * j));
}
}  // namespace sha512

// ===================================================================================================
// SHA-256 (used to derive a wallet's token-account address, so the dry run knows which account to watch)
// ===================================================================================================
namespace sha256 {
static const uint32_t K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
static inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
static void hash(u8 out[32], const u8* in, size_t n) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  Bytes m(in, in + n);
  m.push_back(0x80);
  while (m.size() % 64 != 56) m.push_back(0);
  u64 bits = (u64)n * 8;
  for (int i = 7; i >= 0; i--) m.push_back((u8)(bits >> (8 * i)));
  for (size_t off = 0; off < m.size(); off += 64) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) w[i] = (uint32_t)m[off + 4 * i] << 24 | (uint32_t)m[off + 4 * i + 1] << 16 | (uint32_t)m[off + 4 * i + 2] << 8 | m[off + 4 * i + 3];
    for (int i = 16; i < 64; i++) {
      uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int i = 0; i < 64; i++) {
      uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = hh + S1 + ch + K[i] + w[i];
      uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = S0 + mj;
      hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  for (int i = 0; i < 8; i++) { out[4 * i] = (u8)(h[i] >> 24); out[4 * i + 1] = (u8)(h[i] >> 16); out[4 * i + 2] = (u8)(h[i] >> 8); out[4 * i + 3] = (u8)h[i]; }
}
}  // namespace sha256

// ===================================================================================================
// ed25519 (RFC 8032): the compact TweetNaCl construction. Only key derivation and signing are needed.
// ===================================================================================================
namespace ed25519 {
typedef i64 gf[16];
static const gf gf0 = {0}, gf1 = {1};
static const gf D2 = {0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406};
static const gf X = {0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169};
static const gf Y = {0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666};
static const u64 L[32] = {0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10};

static void set25519(gf r, const gf a) { for (int i = 0; i < 16; i++) r[i] = a[i]; }
static void car25519(gf o) {
  for (int i = 0; i < 16; i++) {
    o[i] += (1LL << 16);
    i64 c = o[i] >> 16;
    o[(i + 1) * (i < 15)] += c - 1 + 37 * (c - 1) * (i == 15);
    o[i] -= c << 16;
  }
}
static void sel25519(gf p, gf q, int b) {
  i64 c = ~(b - 1);
  for (int i = 0; i < 16; i++) { i64 t = c & (p[i] ^ q[i]); p[i] ^= t; q[i] ^= t; }
}
static void pack25519(u8* o, const gf n) {
  gf m, t;
  for (int i = 0; i < 16; i++) t[i] = n[i];
  car25519(t); car25519(t); car25519(t);
  for (int j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (int i = 1; i < 15; i++) { m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1); m[i - 1] &= 0xffff; }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    int b = (int)((m[15] >> 16) & 1);
    m[14] &= 0xffff;
    sel25519(t, m, 1 - b);
  }
  for (int i = 0; i < 16; i++) { o[2 * i] = (u8)(t[i] & 0xff); o[2 * i + 1] = (u8)(t[i] >> 8); }
}
static u8 par25519(const gf a) { u8 d[32]; pack25519(d, a); return d[0] & 1; }
static void A(gf o, const gf a, const gf b) { for (int i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
static void Z(gf o, const gf a, const gf b) { for (int i = 0; i < 16; i++) o[i] = a[i] - b[i]; }
static void M(gf o, const gf a, const gf b) {
  i64 t[31] = {0};
  for (int i = 0; i < 16; i++) for (int j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
  for (int i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
  for (int i = 0; i < 16; i++) o[i] = t[i];
  car25519(o); car25519(o);
}
static void S(gf o, const gf a) { M(o, a, a); }
static void inv25519(gf o, const gf in) {
  gf c;
  for (int a = 0; a < 16; a++) c[a] = in[a];
  for (int a = 253; a >= 0; a--) { S(c, c); if (a != 2 && a != 4) M(c, c, in); }
  for (int a = 0; a < 16; a++) o[a] = c[a];
}
static void add(gf p[4], gf q[4]) {
  gf a, b, c, d, t, e, f, g, h;
  Z(a, p[1], p[0]); Z(t, q[1], q[0]); M(a, a, t);
  A(b, p[0], p[1]); A(t, q[0], q[1]); M(b, b, t);
  M(c, p[3], q[3]); M(c, c, D2);
  M(d, p[2], q[2]); A(d, d, d);
  Z(e, b, a); Z(f, d, c); A(g, d, c); A(h, b, a);
  M(p[0], e, f); M(p[1], h, g); M(p[2], g, f); M(p[3], e, h);
}
static void cswap(gf p[4], gf q[4], u8 b) { for (int i = 0; i < 4; i++) sel25519(p[i], q[i], b); }
static void pack(u8* r, gf p[4]) {
  gf tx, ty, zi;
  inv25519(zi, p[2]); M(tx, p[0], zi); M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= (u8)(par25519(tx) << 7);
}
static void scalarmult(gf p[4], gf q[4], const u8* s) {
  set25519(p[0], gf0); set25519(p[1], gf1); set25519(p[2], gf1); set25519(p[3], gf0);
  for (int i = 255; i >= 0; --i) {
    u8 b = (s[i / 8] >> (i & 7)) & 1;
    cswap(p, q, b); add(q, p); add(p, p); cswap(p, q, b);
  }
}
static void scalarbase(gf p[4], const u8* s) {
  gf q[4];
  set25519(q[0], X); set25519(q[1], Y); set25519(q[2], gf1); M(q[3], X, Y);
  scalarmult(p, q, s);
}
static void modL(u8* r, i64 x[64]) {
  i64 carry, i, j;
  for (i = 63; i >= 32; --i) {
    carry = 0;
    for (j = i - 32; j < i - 12; ++j) { x[j] += carry - 16 * x[i] * (i64)L[j - (i - 32)]; carry = (x[j] + 128) >> 8; x[j] -= carry << 8; }
    x[j] += carry; x[i] = 0;
  }
  carry = 0;
  for (j = 0; j < 32; j++) { x[j] += carry - (x[31] >> 4) * (i64)L[j]; carry = x[j] >> 8; x[j] &= 255; }
  for (j = 0; j < 32; j++) x[j] -= carry * (i64)L[j];
  for (i = 0; i < 32; i++) { x[i + 1] += x[i] >> 8; r[i] = (u8)(x[i] & 255); }
}
static void reduce(u8* r) {
  i64 x[64];
  for (int i = 0; i < 64; i++) x[i] = (i64)(u64)r[i];
  for (int i = 0; i < 64; i++) r[i] = 0;
  modL(r, x);
}

/** Public key for a 32-byte seed. */
static void public_key(u8 pk[32], const u8 seed[32]) {
  u8 d[64];
  sha512::hash(d, seed, 32);
  d[0] &= 248; d[31] &= 127; d[31] |= 64;
  gf p[4];
  scalarbase(p, d);
  pack(pk, p);
}
/** 64-byte signature of `m` under the key (seed, pk). Deterministic, so it matches other implementations byte for byte. */
static void sign(u8 sig[64], const u8 seed[32], const u8 pk[32], const u8* m, size_t n) {
  u8 d[64], h[64], r[64];
  sha512::hash(d, seed, 32);
  d[0] &= 248; d[31] &= 127; d[31] |= 64;
  Bytes buf(n + 64);
  std::memcpy(&buf[64], m, n);
  std::memcpy(&buf[32], d + 32, 32);
  sha512::hash(r, buf.data() + 32, n + 32);
  reduce(r);
  gf p[4];
  scalarbase(p, r);
  pack(buf.data(), p);                 // R
  std::memcpy(&buf[32], pk, 32);
  sha512::hash(h, buf.data(), n + 64);
  reduce(h);
  i64 x[64] = {0};
  for (int i = 0; i < 32; i++) x[i] = (i64)(u64)r[i];
  for (int i = 0; i < 32; i++) for (int j = 0; j < 32; j++) x[i + j] += (i64)(u64)h[i] * (i64)(u64)d[j];
  modL(buf.data() + 32, x);            // S
  std::memcpy(sig, buf.data(), 64);
}

/** Is this 32-byte string a valid compressed curve point? A program-derived address is, by definition, one that is NOT. (TweetNaCl's point decompression.) */
static const gf D = {0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203};
static const gf I = {0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83};
static bool neq25519(const gf a, const gf b) { u8 c[32], d[32]; pack25519(c, a); pack25519(d, b); return std::memcmp(c, d, 32) != 0; }
static void pow2523(gf o, const gf in) {
  gf c;
  for (int a = 0; a < 16; a++) c[a] = in[a];
  for (int a = 250; a >= 0; a--) { S(c, c); if (a != 1) M(c, c, in); }
  for (int a = 0; a < 16; a++) o[a] = c[a];
}
static bool on_curve(const u8 p[32]) {
  gf r0, r1, r2, t, chk, num, den, den2, den4, den6;
  set25519(r2, gf1);
  for (int i = 0; i < 16; i++) r1[i] = p[2 * i] + ((i64)p[2 * i + 1] << 8);
  r1[15] &= 0x7fff;
  S(num, r1); M(den, num, D); Z(num, num, r2); A(den, r2, den);
  S(den2, den); S(den4, den2); M(den6, den4, den2);
  M(t, den6, num); M(t, t, den);
  pow2523(t, t);
  M(t, t, num); M(t, t, den); M(t, t, den);
  M(r0, t, den);
  S(chk, r0); M(chk, chk, den);
  if (neq25519(chk, num)) M(r0, r0, I);
  S(chk, r0); M(chk, chk, den);
  return !neq25519(chk, num);
}
}  // namespace ed25519

// ===================================================================================================
// Base58, Solana wallet (keys, addresses, message and transaction signatures), token-account addresses, transaction reader
// ===================================================================================================
static const char* B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
static std::string base58_encode(const u8* p, size_t n) {
  size_t zeros = 0;
  while (zeros < n && p[zeros] == 0) zeros++;
  std::vector<u8> digits;  // base-58 digits, least significant first
  for (size_t i = zeros; i < n; i++) {
    int carry = p[i];
    for (size_t j = 0; j < digits.size(); j++) { carry += (int)digits[j] << 8; digits[j] = (u8)(carry % 58); carry /= 58; }
    while (carry) { digits.push_back((u8)(carry % 58)); carry /= 58; }
  }
  std::string out(zeros, '1');
  for (auto it = digits.rbegin(); it != digits.rend(); ++it) out += B58[*it];
  return out;
}
static bool base58_decode(const std::string& s, Bytes& out) {
  size_t zeros = 0;
  while (zeros < s.size() && s[zeros] == '1') zeros++;
  std::vector<u8> b;  // bytes, least significant first
  for (size_t i = zeros; i < s.size(); i++) {
    const char* p = s[i] ? std::strchr(B58, s[i]) : nullptr;
    if (!p) return false;
    int carry = (int)(p - B58);
    for (size_t j = 0; j < b.size(); j++) { carry += (int)b[j] * 58; b[j] = (u8)(carry & 0xff); carry >>= 8; }
    while (carry) { b.push_back((u8)(carry & 0xff)); carry >>= 8; }
  }
  out.assign(zeros, 0);
  out.insert(out.end(), b.rbegin(), b.rend());
  return true;
}
static bool is_address(const std::string& s) {
  if (s.size() < 32 || s.size() > 44) return false;
  Bytes b;
  return base58_decode(s, b) && b.size() == 32;
}

namespace sol {
struct Wallet { u8 seed[32]; u8 pk[32]; };
static Wallet from_seed(const u8 seed[32]) { Wallet w; std::memcpy(w.seed, seed, 32); ed25519::public_key(w.pk, seed); return w; }
/** A Solana address IS the ed25519 public key, in base58. */
static std::string address(const Wallet& w) { return base58_encode(w.pk, 32); }
/** The same 64-byte secret Phantom exports: seed then public key, in base58. */
static std::string secret_key(const Wallet& w) {
  u8 k[64];
  std::memcpy(k, w.seed, 32); std::memcpy(k + 32, w.pk, 32);
  return base58_encode(k, 64);
}
/** Accepts that base58 form, or the Solana CLI's keypair file: a JSON array of 64 numbers. The public half must match the seed. */
static bool parse_secret_key(const std::string& in, Wallet& w) {
  std::string t = in;
  while (!t.empty() && std::isspace((unsigned char)t.front())) t.erase(t.begin());
  while (!t.empty() && std::isspace((unsigned char)t.back())) t.pop_back();
  Bytes b;
  if (!t.empty() && t[0] == '[') {
    std::stringstream ss(t.substr(1, t.size() > 1 && t.back() == ']' ? t.size() - 2 : t.size() - 1));
    std::string item;
    while (std::getline(ss, item, ',')) {
      char* end = nullptr;
      long v = std::strtol(item.c_str(), &end, 10);
      if (end == item.c_str() || v < 0 || v > 255) return false;
      b.push_back((u8)v);
    }
  } else if (!base58_decode(t, b)) {
    return false;
  }
  if (b.size() != 64) return false;
  Wallet c = from_seed(b.data());
  if (std::memcmp(c.pk, b.data() + 32, 32) != 0) return false;
  w = c;
  return true;
}
/** Sign a message the way Solana wallets do: ed25519 over the raw UTF-8 bytes, no envelope. Returns the base64 signature. */
static std::string sign_personal(const Wallet& w, const std::string& msg) {
  u8 sig[64];
  ed25519::sign(sig, w.seed, w.pk, (const u8*)msg.data(), msg.size());
  return base64(Bytes(sig, sig + 64));
}

/** program-derived address: the first bump (255 down) whose hash is NOT a curve point */
static bool find_pda(const std::vector<Bytes>& seeds, const Bytes& program, Bytes& out) {
  static const char* TAG = "ProgramDerivedAddress";
  for (int bump = 255; bump >= 0; bump--) {
    Bytes in;
    for (const Bytes& s : seeds) in.insert(in.end(), s.begin(), s.end());
    in.push_back((u8)bump);
    in.insert(in.end(), program.begin(), program.end());
    in.insert(in.end(), TAG, TAG + 21);
    u8 h[32];
    sha256::hash(h, in.data(), in.size());
    if (!ed25519::on_curve(h)) { out.assign(h, h + 32); return true; }
  }
  return false;
}
/** The wallet's associated token account for a mint (derived, so it is known even before it exists). */
static bool ata(const std::string& owner, const std::string& mint, const std::string& token_program, std::string& out) {
  Bytes o, m, t, a, pda;
  if (!base58_decode(owner, o) || !base58_decode(mint, m) || !base58_decode(token_program, t) || !base58_decode("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", a)) return false;
  if (o.size() != 32 || m.size() != 32 || t.size() != 32) return false;
  if (!find_pda({o, t, m}, a, pda)) return false;
  out = base58_encode(pda.data(), 32);
  return true;
}

/* ---- reading a transaction (legacy or v0), only as far as the safety checks need ---- */
struct TxIx { size_t prog = 0; std::vector<size_t> accts; Bytes data; };
struct Tx { size_t sig_count = 0, msg_off = 0, required = 0; std::vector<std::string> keys; std::vector<TxIx> ix; };
static bool read_cu16(const Bytes& b, size_t& i, size_t& v) {
  v = 0;
  for (int s = 0; s < 3; s++) {
    if (i >= b.size()) return false;
    u8 x = b[i++];
    v |= (size_t)(x & 0x7f) << (7 * s);
    if (!(x & 0x80)) return true;
  }
  return false;
}
static bool parse_tx(const Bytes& b, Tx& t) {
  size_t i = 0, n = 0;
  if (!read_cu16(b, i, n) || n < 1 || n > 8) return false;
  t.sig_count = n;
  i += n * 64;
  if (i >= b.size()) return false;
  t.msg_off = i;
  if (b[i] & 0x80) { if ((b[i] & 0x7f) != 0) return false; i++; }  // versioned: only version 0 exists
  if (i + 3 > b.size()) return false;
  t.required = b[i]; i += 3;
  size_t nk = 0;
  if (!read_cu16(b, i, nk) || nk < 1 || nk > 256 || i + nk * 32 + 32 > b.size()) return false;
  for (size_t k = 0; k < nk; k++) { t.keys.push_back(base58_encode(&b[i], 32)); i += 32; }
  i += 32;  // recent blockhash
  size_t ni = 0;
  if (!read_cu16(b, i, ni) || ni > 64) return false;
  for (size_t k = 0; k < ni; k++) {
    TxIx x;
    if (i >= b.size()) return false;
    x.prog = b[i++];
    size_t na = 0, nd = 0;
    if (!read_cu16(b, i, na) || i + na > b.size()) return false;
    for (size_t q = 0; q < na; q++) x.accts.push_back(b[i++]);
    if (!read_cu16(b, i, nd) || i + nd > b.size()) return false;
    x.data.assign(b.begin() + (long)i, b.begin() + (long)(i + nd)); i += nd;
    t.ix.push_back(x);
  }
  return true;
}
/** Put this wallet's signature into the (single) signature slot of an unsigned transaction. Refuses anything not paid and signed by this wallet alone. */
static bool sign_tx(const Wallet& w, const Bytes& tx, Bytes& out) {
  Tx t;
  if (!parse_tx(tx, t) || t.sig_count != 1 || t.required != 1 || t.keys[0] != address(w)) return false;
  u8 sig[64];
  ed25519::sign(sig, w.seed, w.pk, tx.data() + t.msg_off, tx.size() - t.msg_off);
  out = tx;
  std::memcpy(&out[1], sig, 64);  // one signature: the count is a single byte, the slot follows it
  return true;
}
}  // namespace sol

// ===================================================================================================
// Minimal JSON
// ===================================================================================================
struct J {
  enum T { Null, Bool, Num, Str, Arr, Obj } t = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<J> a;
  std::map<std::string, J> o;

  J() {}
  J(bool v) : t(Bool), b(v) {}
  J(double v) : t(Num), n(v) {}
  J(int v) : t(Num), n(v) {}
  J(const char* v) : t(Str), s(v) {}
  J(const std::string& v) : t(Str), s(v) {}
  static J object() { J j; j.t = Obj; return j; }
  static J array() { J j; j.t = Arr; return j; }

  J& operator[](const std::string& k) { if (t != Obj) { t = Obj; o.clear(); } return o[k]; }
  const J& at(const std::string& k) const { static const J nul; auto it = o.find(k); return t == Obj && it != o.end() ? it->second : nul; }
  const J& at(size_t i) const { static const J nul; return t == Arr && i < a.size() ? a[i] : nul; }
  bool is_null() const { return t == Null; }
  std::string str(const std::string& d = "") const { return t == Str ? s : d; }
  double num(double d = 0) const { return t == Num ? n : d; }
  bool has(const std::string& k) const { return t == Obj && o.count(k); }
  void push(const J& v) { if (t != Arr) { t = Arr; a.clear(); } a.push_back(v); }

  static std::string esc(const std::string& in) {
    std::string out = "\"";
    for (unsigned char c : in) {
      switch (c) {
        case '"': out += "\\\""; break; case '\\': out += "\\\\"; break; case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break; case '\t': out += "\\t"; break;
        default: if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; } else out += (char)c;
      }
    }
    return out + "\"";
  }
  std::string dump(int indent = -1, int depth = 0) const {
    auto nl = [&](int d) { return indent < 0 ? std::string() : "\n" + std::string((size_t)(d * indent), ' '); };
    switch (t) {
      case Null: return "null";
      case Bool: return b ? "true" : "false";
      case Num: {
        char buf[40];
        if (std::floor(n) == n && std::fabs(n) < 1e15) { std::snprintf(buf, sizeof buf, "%.0f", n); return buf; }
        for (int digits = 15; digits <= 17; digits++) {  // the shortest text that reads back as the same number
          std::snprintf(buf, sizeof buf, "%.*g", digits, n);
          if (std::strtod(buf, nullptr) == n) break;
        }
        return buf;
      }
      case Str: return esc(s);
      case Arr: {
        if (a.empty()) return "[]";
        std::string out = "[";
        for (size_t i = 0; i < a.size(); i++) out += (i ? "," : "") + nl(depth + 1) + a[i].dump(indent, depth + 1);
        return out + nl(depth) + "]";
      }
      case Obj: {
        if (o.empty()) return "{}";
        std::string out = "{";
        bool first = true;
        for (auto& kv : o) { out += (first ? "" : ",") + nl(depth + 1) + esc(kv.first) + (indent < 0 ? ":" : ": ") + kv.second.dump(indent, depth + 1); first = false; }
        return out + nl(depth) + "}";
      }
    }
    return "null";
  }

  // ---- parsing ----
  struct P {
    const std::string& s; size_t i = 0;
    explicit P(const std::string& str) : s(str) {}
    void ws() { while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++; }
    [[noreturn]] void fail() { throw std::runtime_error("bad JSON"); }
    static void utf8(std::string& out, uint32_t c) {
      if (c < 0x80) out += (char)c;
      else if (c < 0x800) { out += (char)(0xC0 | c >> 6); out += (char)(0x80 | (c & 63)); }
      else if (c < 0x10000) { out += (char)(0xE0 | c >> 12); out += (char)(0x80 | (c >> 6 & 63)); out += (char)(0x80 | (c & 63)); }
      else { out += (char)(0xF0 | c >> 18); out += (char)(0x80 | (c >> 12 & 63)); out += (char)(0x80 | (c >> 6 & 63)); out += (char)(0x80 | (c & 63)); }
    }
    uint32_t hex4() {
      if (i + 4 > s.size()) fail();
      uint32_t v = 0;
      for (int k = 0; k < 4; k++) { char c = s[i++]; v = v * 16 + (uint32_t)(c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : (fail(), 0)); }
      return v;
    }
    std::string string() {
      std::string out;
      i++;  // opening quote
      while (true) {
        if (i >= s.size()) fail();
        char c = s[i++];
        if (c == '"') return out;
        if (c != '\\') { out += c; continue; }
        if (i >= s.size()) fail();
        char e = s[i++];
        switch (e) {
          case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break;
          case 'b': out += '\b'; break; case 'f': out += '\f'; break;
          case 'u': { uint32_t c1 = hex4(); if (c1 >= 0xD800 && c1 < 0xDC00 && i + 1 < s.size() && s[i] == '\\' && s[i + 1] == 'u') { i += 2; uint32_t c2 = hex4(); c1 = 0x10000 + ((c1 - 0xD800) << 10) + (c2 - 0xDC00); } utf8(out, c1); break; }
          default: out += e;
        }
      }
    }
    J value(int depth = 0) {
      if (depth > 64) fail();
      ws();
      if (i >= s.size()) fail();
      char c = s[i];
      if (c == '{') {
        J j = J::object(); i++; ws();
        if (i < s.size() && s[i] == '}') { i++; return j; }
        while (true) {
          ws(); if (i >= s.size() || s[i] != '"') fail();
          std::string k = string(); ws();
          if (i >= s.size() || s[i++] != ':') fail();
          j.o[k] = value(depth + 1); ws();
          if (i >= s.size()) fail();
          if (s[i] == ',') { i++; continue; }
          if (s[i] == '}') { i++; return j; }
          fail();
        }
      }
      if (c == '[') {
        J j = J::array(); i++; ws();
        if (i < s.size() && s[i] == ']') { i++; return j; }
        while (true) {
          j.a.push_back(value(depth + 1)); ws();
          if (i >= s.size()) fail();
          if (s[i] == ',') { i++; continue; }
          if (s[i] == ']') { i++; return j; }
          fail();
        }
      }
      if (c == '"') return J(string());
      if (s.compare(i, 4, "true") == 0) { i += 4; return J(true); }
      if (s.compare(i, 5, "false") == 0) { i += 5; return J(false); }
      if (s.compare(i, 4, "null") == 0) { i += 4; return J(); }
      size_t st = i;
      while (i < s.size() && (std::isdigit((unsigned char)s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
      if (st == i) fail();
      return J(std::strtod(s.substr(st, i - st).c_str(), nullptr));
    }
  };
  static J parse(const std::string& text) { P p(text); J j = p.value(); return j; }
};

// ===================================================================================================
// Files, config, HTTP
// ===================================================================================================
static std::string home_dir() {
  if (const char* h = std::getenv("NIMBROS_HOME")) return h;
  const char* h = std::getenv("HOME");
  return std::string(h ? h : ".") + "/.nimbros";
}
static bool read_file(const std::string& path, std::string& out) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::stringstream ss; ss << f.rdbuf(); out = ss.str();
  return true;
}
static void write_private(const std::string& path, const std::string& data) {  // owner-only from the moment it exists
  ::mkdir(home_dir().c_str(), 0700);
  int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) die("couldn't write " + path);
  ssize_t w = ::write(fd, data.data(), data.size());
  ::fchmod(fd, 0600);
  ::close(fd);
  if (w != (ssize_t)data.size()) die("couldn't write " + path);
}
static Bytes random_bytes(size_t n) {
  Bytes b(n);
  std::ifstream f("/dev/urandom", std::ios::binary);
  if (!f.read(reinterpret_cast<char*>(b.data()), (std::streamsize)n)) die("couldn't read secure random bytes");
  return b;
}

static const char* DEFAULT_SITE = "https://x-nimbros-si.pages.dev";
static std::string SITE, KEY, SELF;
static bool SOFT_FAIL = false;  // `instant` keeps running through a dropped connection instead of exiting
static J CFG;
static std::string cfg_path() { return home_dir() + "/config.json"; }
static std::string wallet_path() { return home_dir() + "/wallet.json"; }
static J load_json_file(const std::string& p) { std::string t; if (!read_file(p, t)) return J(); try { return J::parse(t); } catch (...) { return J(); } }

struct Resp { long status = 0; std::string body; };
static size_t write_cb(char* p, size_t s, size_t n, void* u) { static_cast<std::string*>(u)->append(p, s * n); return s * n; }

static Resp http(const std::string& method, const std::string& url, const std::string* body, const std::string* bearer) {
  CURL* c = curl_easy_init();
  if (!c) die("couldn't start the network library");
  Resp r;
  struct curl_slist* hdr = nullptr;
  hdr = curl_slist_append(hdr, "content-type: application/json");
  hdr = curl_slist_append(hdr, "accept: application/json");
  std::string auth;
  if (bearer) { auth = "authorization: Bearer " + *bearer; hdr = curl_slist_append(hdr, auth.c_str()); }
  curl_easy_setopt(c, CURLOPT_URL, url.c_str());
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, hdr);
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, write_cb);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &r.body);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 30L);
  curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(c, CURLOPT_USERAGENT, "nimbros-cli-cpp/1");
  if (method == "POST") { curl_easy_setopt(c, CURLOPT_POST, 1L); curl_easy_setopt(c, CURLOPT_POSTFIELDS, body ? body->c_str() : ""); curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, (long)(body ? body->size() : 0)); }
  CURLcode rc = curl_easy_perform(c);
  if (rc != CURLE_OK) { std::string m = curl_easy_strerror(rc); curl_slist_free_all(hdr); curl_easy_cleanup(c); if (SOFT_FAIL) { r.status = 0; return r; } die("couldn't reach " + SITE + ": " + m); }
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r.status);
  curl_slist_free_all(hdr);
  curl_easy_cleanup(c);
  return r;
}

/** Calls the site and returns the parsed JSON, or stops with the server's own message. */
static J call(const std::string& path, const J* body = nullptr, bool auth = true) {
  if (auth && KEY.empty()) die("No API key yet. Run:  nimbros init <agent-name>");
  std::string payload = body ? body->dump() : "";
  Resp r = http(body ? "POST" : "GET", SITE + path, body ? &payload : nullptr, auth ? &KEY : nullptr);
  J j;
  try { j = J::parse(r.body); } catch (...) { j = J::object(); j["error"] = r.body.substr(0, 200); }
  if (r.status < 200 || r.status >= 300) {
    std::string m = j.at("error").str(j.at("message").str("HTTP " + std::to_string(r.status)));
    if (j.at("errors").t == J::Obj) {  // field-by-field problems, e.g. from launch-check
      m = "That didn't pass the checks:";
      for (auto& kv : j.at("errors").o) m += "\n  " + kv.first + ": " + kv.second.str();
    }
    die(m);
  }
  return j;
}

// ===================================================================================================
// Formatting
// ===================================================================================================
static std::string fmt(const char* f, double v) { char b[64]; std::snprintf(b, sizeof b, f, v); return b; }
static std::string usd(double n) {
  if (n >= 1e6) return "$" + fmt("%.2f", n / 1e6) + "M";
  if (n >= 1e3) return "$" + fmt("%.1f", n / 1e3) + "K";
  return "$" + fmt(n < 1 ? "%.6f" : "%.2f", n);
}
static std::string age(const J& m) {
  if (m.t != J::Num) return "-";
  long v = (long)m.n;
  return v < 60 ? std::to_string(v) + "m" : v < 1440 ? std::to_string(v / 60) + "h" : std::to_string(v / 1440) + "d";
}
static std::string pad(const std::string& s, size_t n) { return s.size() >= n ? s.substr(0, n) : s + std::string(n - s.size(), ' '); }
static std::string coin(const std::string& c) { return c; }  // a token mint address, exactly as given (base58 is case-sensitive)
static double number(const std::string& s, const char* what) {
  char* end = nullptr;
  double v = std::strtod(s.c_str(), &end);
  if (s.empty() || *end || !std::isfinite(v)) die(std::string(what) + " must be a number");
  return v;
}
static std::string flag(const std::vector<std::string>& a, const std::string& name) {
  for (size_t i = 0; i + 1 < a.size(); i++) if (a[i] == "--" + name) return a[i + 1];
  return "";
}
static bool has_flag(const std::vector<std::string>& a, const std::string& name) { return std::find(a.begin(), a.end(), "--" + name) != a.end(); }
static void show(const J& j) { std::cout << j.dump(2) << "\n"; }
static J act(J body) { return call("/api/agent/act", &body); }

static const char* HELP = R"(NimBros CLI (C++)

Setup
  init <agent-name>              register an agent and save its API key
  mcp                            print the line that connects Claude Code (or any MCP client)
  whoami                         show which agent this machine is set up as
  selftest                       check the built-in crypto against known answers

Wallet (optional; needed for real trading later)
  wallet new                     make a wallet on this machine (the key stays here)
  wallet import                  use an existing key (base58 secret, or a Solana CLI keypair JSON): put it in NIMBROS_WALLET_KEY first
  wallet address                 show the wallet address
  wallet link                    prove this wallet is yours and link it to your agent
  wallet sign <text>             sign any text with this wallet (an ed25519 signature over the raw text, in base64)
  wallet sign-tx <base64>        sign an unsigned Solana transaction with this wallet (prints the signed transaction in base64)
  wallet message                 the text to sign with another wallet (then: wallet link --signature <sig> --address <wallet>)
  wallet balance [address]       SOL and tokens in the wallet
  wallet unlink                  remove the link

Markets
  tokens [snipe|scalp] [--limit N]   live Solana tokens from every launchpad. snipe = fresh, before graduation; scalp = graduated
  safety <coin>                      on-chain checks: mint authority, freeze authority, supply

Trading (real money; closed until your wallet is approved; your key never leaves this machine)
  trade <buy|sell> <coin> <amount> [--slippage bps] [--dry] [--yes]
                                     builds the swap (Jupiter), re-checks it yourself against a Solana node, then signs here and sends it.
                                     buy: amount is SOL to spend. sell: amount is coins to sell.
                                     --dry checks everything and stops before signing.

Instant mode (your ⚡ and Close taps on the site run on this machine, no wallet prompt)
  instant allow <OWNER-WALLET>       let that wallet's taps reach this agent (only wallets you name can)
  instant allow <OWNER-WALLET> --off remove it
  instant                            listen and run those trades with this machine's wallet; every trade still
                                     passes the same checks and caps as `trade`. Leave it running.

Alerts and webhooks
  alert <coin> <above|below> <price>      webhook <https-url|off>
  cancel <id>                             remove an alert
  act '<json>'                            any /api/agent/act command

<coin> is a token mint address (base58), e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263.
Set NIMBROS_KEY or NIMBROS_SITE to override the saved settings. Set NIMBROS_RPC_URL to check trades against your own Solana node
(default: the node NimBros proxies at <site>/api/rpc).
)";

// ===================================================================================================
// selftest: known answers computed independently (Node's crypto and @solana/web3.js)
// ===================================================================================================
static int selftest() {
  int bad = 0;
  auto check = [&](const char* name, const std::string& got, const std::string& want) {
    bool ok = got == want;
    std::cout << (ok ? "  ok   " : "  FAIL ") << name << "\n";
    if (!ok) { std::cout << "       got  " << got << "\n       want " << want << "\n"; bad++; }
  };
  const std::string abc = "abc";
  u8 h[64];
  sha512::hash(h, (const u8*)abc.data(), abc.size());
  check("sha-512(abc)", to_hex(h, 64), "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
  Bytes long_in(300, 0x61);  // crosses the block boundary
  sha512::hash(h, long_in.data(), long_in.size());
  check("sha-512(300 x 'a')", to_hex(h, 64).substr(0, 32), "a6a77010dd9696c23831e6549de51724");
  u8 h32[32];
  sha256::hash(h32, (const u8*)abc.data(), 3);
  check("sha-256(abc)", to_hex(h32, 32), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  u8 seed[32];
  for (int i = 0; i < 32; i++) seed[i] = (u8)i;
  sol::Wallet w = sol::from_seed(seed);
  check("ed25519 public key", to_hex(w.pk, 32), "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
  u8 sig[64];
  const std::string hello = "hello";
  ed25519::sign(sig, w.seed, w.pk, (const u8*)hello.data(), hello.size());
  check("ed25519 signature", to_hex(sig, 64), "e1a7fca94a835127885b99e2eba733d6ee5bf5dc463ed8385eb6f1dcaa1117c0f151750a10f46f5b3796a91203578f702c85c67c334b5689a516284d499f710f");
  check("solana address", sol::address(w), "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF");
  check("secret key encode", sol::secret_key(w), "1GMkH3brNXiNNs1tiFZHu4yZSRrzJwxi5wB9bHFtMikjwpAW9DMZzU2Pqakc5it8X3N5vPmqdN7KF4CCUpmKhq");
  sol::Wallet back;
  bool parsed = sol::parse_secret_key("1GMkH3brNXiNNs1tiFZHu4yZSRrzJwxi5wB9bHFtMikjwpAW9DMZzU2Pqakc5it8X3N5vPmqdN7KF4CCUpmKhq", back);
  check("secret key decode", parsed ? to_hex(back.seed, 32) : "unparsed", to_hex(seed, 32));
  check("rejects a corrupted key", sol::parse_secret_key("1GMkH3brNXiNNs1tiFZHu4yZSRrzJwxi5wB9bHFtMikjwpAW9DMZzU2Pqakc5it8X3N5vPmqdN7KF4CCUpmKhr", back) ? "accepted" : "rejected", "rejected");
  {
    std::string arr = "[";
    for (int i = 0; i < 32; i++) arr += std::to_string(i) + ",";
    for (int i = 0; i < 32; i++) arr += std::to_string((int)w.pk[i]) + (i < 31 ? "," : "]");
    sol::Wallet fromjson;
    check("Solana CLI keypair json", sol::parse_secret_key(arr, fromjson) ? sol::address(fromjson) : "unparsed", "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF");
  }
  check("base58 round trip with leading zeros", [] { Bytes b{0, 0, 7, 255, 1}, o; return base58_decode(base58_encode(b.data(), b.size()), o) && o == b ? "same" : "different"; }(), "same");
  check("message signature", sol::sign_personal(w, "nimbros-link:abc123"), "gZuHX8RqOMA01+IWNOu6rGNF3683cIh3kCx/AR8edU+UDSnlN8yUFZpJ+r6tKD8fpo7/5UqrngHmReryYtSHAg==");
  {
    const Bytes wsol = [] { Bytes b; base58_decode("So11111111111111111111111111111111111111112", b); return b; }();
    std::string a;
    check("token account address", sol::ata(sol::address(w), "So11111111111111111111111111111111111111112", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", a) ? a : "failed", "6G1uk4kms3xPSeX1RwzMaYumnqWBs9xxCEUjZk5MxPvF");
    Bytes ab; base58_decode(a, ab);
    check("a program-derived address is off the curve", ed25519::on_curve(ab.data()) ? "on curve" : "off curve", "off curve");
    check("a wallet key is on the curve", ed25519::on_curve(w.pk) ? "on curve" : "off curve", "on curve");
    check("the WSOL mint is on the curve", ed25519::on_curve(wsol.data()) ? "on curve" : "off curve", "on curve");
  }
  {
    // a real v0 transaction built with @solana/web3.js: compute-budget price + a system transfer, paid by the wallet above
    const Bytes tx = unbase64("AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQACBAOhB7/zzhC+HXDdGOdLwJln5NYwm6UNXx3chmQSVTG4hQ8tbgKkevgk0Jq2ncQtcMsoy/okn7fuV7nSVsEnYu8DBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgAJA4gTAAAAAAAAAwIAAQwCAAAAQOIBAAAAAAAA");
    sol::Tx t;
    bool ok = sol::parse_tx(tx, t);
    check("transaction: reads it", ok && t.keys.size() == 4 && t.ix.size() == 2 && t.required == 1 && t.keys[0] == sol::address(w) ? "ok" : "not ok", "ok");
    check("transaction: program ids", ok ? t.keys[t.ix[0].prog] + " " + t.keys[t.ix[1].prog] : "-", "ComputeBudget111111111111111111111111111111 11111111111111111111111111111111");
    Bytes signed_tx;
    bool signed_ok = sol::sign_tx(w, tx, signed_tx);
    check("transaction: signature", signed_ok ? to_hex(&signed_tx[1], 64) : "refused", "a5ef50deedece07f06b3d80dc2775a23de3748be8eff6a66e0b55bb95690a6d588c57d571d1212016c2542f053ae381f2e60ce2705b9b0611ee4152ed6990409");
    check("transaction: only the message changed", signed_ok && std::equal(signed_tx.begin() + 65, signed_tx.end(), tx.begin() + 65) ? "same" : "different", "same");
    u8 other_seed[32] = {9};
    check("transaction: another wallet is refused", sol::sign_tx(sol::from_seed(other_seed), tx, signed_tx) ? "signed" : "refused", "refused");
    check("transaction: garbage is refused", sol::parse_tx(Bytes{1, 2, 3}, t) ? "parsed" : "refused", "refused");
  }
  check("json round trip", J::parse("{\"a\":[1,2.5,\"x\\u00e9\\n\"],\"b\":null,\"c\":true}").dump(), "{\"a\":[1,2.5,\"x\xc3\xa9\\n\"],\"b\":null,\"c\":true}");
  std::cout << (bad ? "\nSome checks failed. Do not use the wallet commands with this build.\n" : "\nAll checks passed.\n");
  return bad ? 1 : 0;
}

// ===================================================================================================
// Commands
// ===================================================================================================

static Bytes unbase64(const std::string& in);
static bool load_wallet(sol::Wallet& w, std::string* addr = nullptr) {
  J j = load_json_file(wallet_path());
  if (!sol::parse_secret_key(j.at("secretKey").str(), w)) return false;
  if (addr) *addr = sol::address(w);
  return true;
}
static void save_wallet(const sol::Wallet& w) {
  J j = J::object();
  j["address"] = sol::address(w);
  j["secretKey"] = sol::secret_key(w);
  write_private(wallet_path(), j.dump(2));
}

static J rpc(const std::string& method, const J& params, std::string* soft_error = nullptr);
static void cmd_wallet(const std::vector<std::string>& args) {
  const std::string sub = args.empty() ? "" : args[0];
  const std::string agent_id = CFG.at("id").str();
  if (sub == "new") {
    sol::Wallet w;
    if (load_wallet(w) && !has_flag(args, "force")) die("A wallet already exists at " + wallet_path() + ". Use --force to replace it. That would lose access to the old one unless it is backed up.");
    Bytes seed = random_bytes(32);
    w = sol::from_seed(seed.data());
    save_wallet(w);
    std::cout << "Wallet created: " << sol::address(w) << "\n";
    std::cout << "The private key is in " << wallet_path() << " (readable only by you). NimBros never sees it.\n";
    std::cout << "Back that file up somewhere safe. Anyone who has it controls the wallet, and there is no recovery.\n\nNext:  nimbros wallet link\n";
  } else if (sub == "import") {
    const char* key = std::getenv("NIMBROS_WALLET_KEY");
    if (!key) die("Set your private key in the NIMBROS_WALLET_KEY environment variable first (so it stays out of your shell history), then run this again.");
    sol::Wallet existing, w;
    if (load_wallet(existing) && !has_flag(args, "force")) die("A wallet already exists at " + wallet_path() + ". Use --force to replace it.");
    std::string k = key;
    while (!k.empty() && std::isspace((unsigned char)k.back())) k.pop_back();
    if (!sol::parse_secret_key(k, w)) die("That isn't a valid Solana secret key (a base58 string of 64 bytes, or the JSON array from a Solana CLI keypair file).");
    save_wallet(w);
    std::cout << "Imported wallet " << sol::address(w) << ". You can clear NIMBROS_WALLET_KEY now.\n";
  } else if (sub == "address") {
    sol::Wallet w; std::string a;
    std::cout << (load_wallet(w, &a) ? a : "No wallet yet. Run: nimbros wallet new") << "\n";
  } else if (sub == "sign") {
    if (args.size() < 2) die("Usage: nimbros wallet sign <text>");
    sol::Wallet w;
    if (!load_wallet(w)) die("No wallet yet. Run:  nimbros wallet new");
    std::cout << sol::sign_personal(w, args[1]) << "\n";
  } else if (sub == "sign-tx") {
    if (args.size() < 2) die("Usage: nimbros wallet sign-tx <unsigned transaction in base64>");
    sol::Wallet w;
    if (!load_wallet(w)) die("No wallet yet. Run:  nimbros wallet new");
    Bytes signed_tx;
    if (!sol::sign_tx(w, unbase64(args[1]), signed_tx)) die("That isn't an unsigned Solana transaction paid and signed by this wallet alone. Nothing was signed.");
    std::cout << base64(signed_tx) << "\n";
  } else if (sub == "message") {
    if (agent_id.empty()) die("Set up an agent first: nimbros init <agent-name>");
    std::cout << "nimbros-link:" << agent_id << "\n";
  } else if (sub == "link") {
    if (agent_id.empty()) die("Set up an agent first: nimbros init <agent-name>");
    J body = J::object();
    body["op"] = "link_wallet";
    std::string given = flag(args, "signature");
    if (!given.empty()) {
      body["signature"] = given;
      if (!flag(args, "address").empty()) body["address"] = flag(args, "address");
    } else {
      sol::Wallet w;
      if (!load_wallet(w)) die("No wallet yet. Run:  nimbros wallet new");
      body["signature"] = sol::sign_personal(w, "nimbros-link:" + agent_id);
      body["address"] = sol::address(w);
    }
    J r = act(body);
    std::cout << "Linked " << r.at("wallet").str() << " to " << CFG.at("name").str() << ".\n";
    std::cout << "Trading is still off until NimBros approves this address.\n";
  } else if (sub == "unlink") {
    J b = J::object(); b["op"] = "unlink_wallet";
    act(b);
    std::cout << "Wallet unlinked.\n";
  } else if (sub == "balance") {
    std::string addr = args.size() > 1 ? args[1] : "";
    if (addr.empty()) { sol::Wallet w; std::string a; if (load_wallet(w, &a)) addr = a; }
    if (addr.empty()) die("No wallet on this machine. Run: nimbros wallet balance <address>");
    if (!is_address(addr)) die("That isn't a Solana address.");
    J p1 = J::array(); p1.push(J(addr));
    const double sol_bal = rpc("getBalance", p1).at("value").num() / 1e9;
    J p2 = J::array(); p2.push(J(addr));
    J f = J::object(); f["programId"] = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"; p2.push(f);
    J e = J::object(); e["encoding"] = "jsonParsed"; p2.push(e);
    std::cout << addr << "\n  " << fmt("%.4f", sol_bal) << "  SOL\n";
    bool any = false;
    std::string tok_err;
    J tokens = rpc("getTokenAccountsByOwner", p2, &tok_err);
    if (!tok_err.empty()) std::cout << "  (token balances unavailable: " << tok_err << ". Set NIMBROS_RPC_URL to a node that allows them, e.g. Helius.)\n";
    for (const J& acc : tokens.at("value").a) {
      const J& ta = acc.at("account").at("data").at("parsed").at("info").at("tokenAmount");
      if (ta.at("amount").str("0") == "0") continue;
      any = true;
      std::cout << "  " << ta.at("uiAmountString").str("?") << "  " << acc.at("account").at("data").at("parsed").at("info").at("mint").str() << "\n";
    }
    if (!any && sol_bal == 0) std::cout << "  nothing yet. Send SOL to this address to fund it.\n";
  } else {
    std::cout << "Usage: nimbros wallet <new | import | address | link | sign | message | balance | unlink>\n";
  }
}

// ===================================================================================================
// Real trading: build on NimBros, verify independently, sign here, submit to a Solana node
// ===================================================================================================
using i128 = __int128;

static Bytes unbase64(const std::string& in) {
  static const std::string t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  Bytes out;
  uint32_t acc = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=' || std::isspace((unsigned char)c)) continue;
    size_t v = t.find(c);
    if (v == std::string::npos) die("that isn't valid base64");
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push_back((u8)((acc >> bits) & 0xff)); }
  }
  return out;
}

static i128 parse_i128(const std::string& s) {
  size_t i = 0;
  bool neg = false;
  if (i < s.size() && (s[i] == '-' || s[i] == '+')) { neg = s[i] == '-'; i++; }
  if (i >= s.size()) die("bad number from the server");
  i128 v = 0;
  for (; i < s.size(); i++) {
    if (s[i] < '0' || s[i] > '9') die("bad number from the server");
    v = v * 10 + (s[i] - '0');
  }
  return neg ? -v : v;
}
/** 25687936 with 6 decimals -> "25.687936" */
static std::string units(i128 v, int dec) {
  bool neg = v < 0;
  if (neg) v = -v;
  std::string d;
  do { d += (char)('0' + (int)(v % 10)); v /= 10; } while (v > 0);
  while ((int)d.size() <= dec) d += '0';
  std::reverse(d.begin(), d.end());
  std::string whole = d.substr(0, d.size() - (size_t)dec), frac = d.substr(d.size() - (size_t)dec);
  while (!frac.empty() && frac.back() == '0') frac.pop_back();
  return (neg ? "-" : "") + whole + (frac.empty() ? "" : "." + frac);
}

static const char* WSOL = "So11111111111111111111111111111111111111112";

/** The Solana node the checks and the send go through: your own (NIMBROS_RPC_URL), or the one NimBros proxies. */
static std::string rpc_url() { const char* e = std::getenv("NIMBROS_RPC_URL"); return e && *e ? std::string(e) : SITE + "/api/rpc"; }
static J rpc(const std::string& method, const J& params, std::string* soft_error) {
  J q = J::object();
  q["jsonrpc"] = "2.0"; q["id"] = 1; q["method"] = method; q["params"] = params;
  std::string payload = q.dump();
  Resp r = http("POST", rpc_url(), &payload, nullptr);
  J j;
  try { j = J::parse(r.body); } catch (...) { die("couldn't read the Solana node's answer (HTTP " + std::to_string(r.status) + ")"); }
  if (j.has("error")) {
    const std::string m = "the Solana node said: " + j.at("error").at("message").str("an error");
    if (!soft_error) die(m);
    *soft_error = m;  // the caller decides what to do: some nodes refuse indexed reads
    return J();
  }
  return j.at("result");
}

/** What this exact transaction does to `address`, according to a Solana node's own simulation (no signature needed): SOL and the traded token. */
struct SimResult { bool ok = false; std::string error; std::vector<std::pair<std::string, i128>> changes; };
static u64 token_amount_of(const J& acc) {  // the amount field of an SPL token account: 8 bytes little-endian at offset 64
  if (acc.is_null()) return 0;
  Bytes d = unbase64(acc.at("data").at(0).str());
  u64 v = 0;
  if (d.size() >= 72) for (int i = 7; i >= 0; i--) v = (v << 8) | d[64 + (size_t)i];
  return v;
}
static SimResult simulate_on_chain(const std::string& b64, const std::string& address, const std::string& traded_mint) {
  SimResult out;
  J pm = J::array(); pm.push(J(traded_mint)); { J o = J::object(); o["encoding"] = "jsonParsed"; pm.push(o); }
  const std::string token_program = rpc("getAccountInfo", pm).at("value").at("owner").str();
  std::string ata;
  if (token_program.empty() || !sol::ata(address, traded_mint, token_program, ata)) { out.error = "couldn't read that coin's mint"; return out; }
  J watch = J::array(); watch.push(J(address)); watch.push(J(ata));
  J pre_p = J::array(); pre_p.push(watch); { J o = J::object(); o["encoding"] = "base64"; pre_p.push(o); }
  J pre = rpc("getMultipleAccounts", pre_p);
  J sim_p = J::array(); sim_p.push(J(b64));
  {
    J o = J::object();
    o["encoding"] = "base64"; o["sigVerify"] = false; o["replaceRecentBlockhash"] = true; o["commitment"] = "confirmed";
    o["accounts"]["encoding"] = "base64"; o["accounts"]["addresses"] = watch;
    sim_p.push(o);
  }
  J sim = rpc("simulateTransaction", sim_p);
  const J& v = sim.at("value");
  if (!v.at("err").is_null()) { out.error = "the simulation failed: " + v.at("err").dump(); return out; }
  if (v.at("accounts").t != J::Arr || v.at("accounts").a.size() != 2) { out.error = "the node returned no balance data"; return out; }
  const i128 sol_delta = (i128)v.at("accounts").at(0).at("lamports").num() - (i128)pre.at("value").at(0).at("lamports").num();
  const i128 tok_delta = (i128)token_amount_of(v.at("accounts").at(1)) - (i128)token_amount_of(pre.at("value").at(1));
  out.changes.push_back({WSOL, sol_delta});
  out.changes.push_back({traded_mint, tok_delta});
  out.ok = true;
  return out;
}

/** The same rules the server applies, run again here: only the traded coins move, at most the chosen amount goes out, at least the minimum comes in. */
static std::string check_swap(const SimResult& s, const std::string& spend_coin, i128 spend, const std::string& recv_coin, i128 min_out) {
  const i128 GAS_ALLOWANCE = 10000000;  // 0.01 SOL: network + priority fees and any new token account's rent, beyond the amount chosen
  const std::string sol_coin = WSOL;
  const bool spend_is_sol = spend_coin == sol_coin;
  i128 spent = 0, got = 0;
  int n_spend = 0, n_recv = 0;
  for (auto& c : s.changes) {
    if (c.second == 0) continue;
    if (c.first == spend_coin) { spent = -c.second; n_spend++; if (c.second >= 0) return "the traded coin would not decrease"; }
    else if (c.first == recv_coin) { got = c.second; n_recv++; }
    else if (!(c.first == sol_coin && c.second < 0 && -c.second <= GAS_ALLOWANCE && !spend_is_sol)) return "it would move another asset (" + c.first + ")";
  }
  if (n_recv != 1 || got <= 0) return "it would not deliver the coin you asked for";
  if (got < min_out) return "it would deliver less than your minimum";
  if (n_spend != 1) return "the amount leaving your wallet is unclear";
  if (spend_is_sol) { i128 fee = spent - spend; if (fee > GAS_ALLOWANCE) return "it would spend more SOL than you chose"; }  // a little LESS is normal: closing a temporary wrapped-SOL account hands its rent back
  else if (spent > spend) return "it would spend more than you chose";
  return "";
}

/** What the transaction itself says it will run, read straight from its bytes. Empty = fine; otherwise why not. Jupiter's swap is one top-level
    instruction; everything else in a swap is wrapping SOL, creating token accounts, a compute budget and the fee transfer. Anything else is refused. */
static std::string check_structure(const Bytes& tx, const std::string& address) {
  sol::Tx t;
  if (!sol::parse_tx(tx, t)) return "the transaction isn't one this program can read";
  if (t.sig_count != 1 || t.required != 1) return "it needs more than your signature";
  if (t.keys[0] != address) return "it isn't paid by your wallet";
  static const char* SYSTEM = "11111111111111111111111111111111";
  static const char* TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  static const char* TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  static const char* ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  static const char* COMPUTE = "ComputeBudget111111111111111111111111111111";
  static const char* JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  for (const sol::TxIx& x : t.ix) {
    if (x.prog >= t.keys.size()) return "an instruction names a program that isn't in the transaction";
    const std::string& p = t.keys[x.prog];
    const u8 kind = x.data.empty() ? 255 : x.data[0];
    if (p == COMPUTE || p == ATA || p == JUPITER) continue;
    if (p == SYSTEM) {  // only plain transfers (wrapping SOL, and the platform fee)
      if (x.data.size() != 12 || kind != 2 || x.data[1] || x.data[2] || x.data[3]) return "it runs a system instruction other than a transfer";
      if (x.accts.empty() || x.accts[0] >= t.keys.size() || t.keys[x.accts[0]] != address) return "it moves SOL that isn't yours";
      continue;
    }
    if (p == TOKEN || p == TOKEN22) {  // open/close the temporary wrapped-SOL account, nothing that hands out control of your tokens
      if (!(kind == 1 || kind == 9 || kind == 17 || kind == 18)) return "it runs a token instruction that could hand over control of your coins";
      if (kind == 9 && (x.accts.size() < 2 || x.accts[1] >= t.keys.size() || t.keys[x.accts[1]] != address)) return "it closes a token account into someone else's wallet";
      continue;
    }
    return "it calls a program a swap doesn't need (" + p + ")";
  }
  return "";
}

static void cmd_trade(const std::vector<std::string>& args) {
  const char* usage = "nimbros trade <buy|sell> <coin> <amount> [--slippage <bps>] [--dry] [--yes]";
  if (args.size() < 3) die(std::string("Usage: ") + usage);
  const std::string side = args[0];
  if (side != "buy" && side != "sell") die("side must be buy or sell");
  if (!is_address(args[1])) die("<coin> must be a token mint address (base58)");
  sol::Wallet w;
  std::string address;
  if (!load_wallet(w, &address)) die("No wallet yet. Run:  nimbros wallet new   then   nimbros wallet link");
  const bool dry = has_flag(args, "dry"), yes = has_flag(args, "yes");

  J b = J::object();
  b["side"] = side; b["coin"] = coin(args[1]); b["amount"] = args[2]; b["address"] = address;
  if (!flag(args, "slippage").empty()) b["slippageBps"] = number(flag(args, "slippage"), "--slippage");
  J plan = call("/api/trade/build", &b);

  const int sd = (int)plan.at("spendDecimals").num(), rd = (int)plan.at("receiveDecimals").num();
  const i128 spend = parse_i128(plan.at("spend").str()), min_out = parse_i128(plan.at("minOutRaw").str()), expect = parse_i128(plan.at("expectedOutRaw").str());
  const std::string spend_coin = plan.at("spendCoin").str(), recv_coin = plan.at("receiveCoin").str();
  const bool buying = side == "buy";
  const double fee_bps = plan.at("feeBps").num(0);
  std::cout << "You pay        " << units(spend, sd) << (buying ? " SOL" : " " + coin(args[1])) << "\n";
  std::cout << "You receive    at least " << units(min_out, rd) << (buying ? " " + coin(args[1]) : " SOL") << "   (expected " << units(expect, rd) << ")\n";
  std::cout << "Size           about $" << fmt("%.2f", plan.at("usd").num()) << "   price impact " << fmt("%.2f", plan.at("impactPct").num()) << "%\n";
  std::cout << "Network fee    up to 0.01 SOL (about " << units(parse_i128(plan.at("gasRaw").str("0")), 9) << " SOL expected)\n";
  if (fee_bps > 0) std::cout << "Platform fee   " << fmt("%.2f", fee_bps / 100.0) << "%   (paid in SOL inside the same transaction)\n";

  // do not take NimBros' word for it: read the transaction's own bytes, then ask a Solana node what it would do
  const std::string tx_b64 = plan.at("txBytes").str();
  if (tx_b64.empty()) die("the server didn't send transaction bytes");
  const Bytes tx = unbase64(tx_b64);
  std::string bad = check_structure(tx, address);
  if (!bad.empty()) die("Not signing. Independent check of the transaction: " + bad + ".");
  const std::string traded = buying ? recv_coin : spend_coin;
  SimResult sim = simulate_on_chain(tx_b64, address, traded);
  if (!sim.ok) die("Not signing. " + sim.error);
  // selling: what lands in the wallet is the swap output less the platform fee and network fees (the swap itself enforces the minimum on-chain)
  i128 sim_min = min_out;
  if (!buying) { sim_min = min_out - (min_out * (i128)fee_bps) / 10000 - 10000000; if (sim_min < 1) sim_min = 1; }
  bad = check_swap(sim, spend_coin, spend, recv_coin, sim_min);
  if (!bad.empty()) die("Not signing. Independent check: " + bad + ".");
  std::cout << "Independent check passed: the transaction runs only a swap, and a Solana node's own simulation matches exactly what you asked for.\n";
  if (dry) { std::cout << "Dry run, nothing was signed or sent.\n"; return; }

  if (!yes) {
    std::cout << "\nType YES to sign with your wallet and send it: " << std::flush;
    std::string line;
    if (!std::getline(std::cin, line) || line != "YES") die("Cancelled. Nothing was sent. (Use --yes to skip this question.)");
  }
  Bytes signed_tx;
  if (!sol::sign_tx(w, tx, signed_tx)) die("Not signing: the transaction isn't paid and signed by this wallet alone.");

  J sp = J::array(); sp.push(J(base64(signed_tx)));
  { J o = J::object(); o["encoding"] = "base64"; o["skipPreflight"] = false; o["maxRetries"] = 3; sp.push(o); }
  const std::string signature = rpc("sendTransaction", sp).str();
  if (signature.empty()) die("The node didn't return a transaction signature. Check your wallet before trying again.");
  std::cout << "\nSent. Waiting for confirmation…\n";
  bool confirmed = false, failed = false;
  for (int i = 0; i < 50 && !confirmed && !failed; i++) {
    ::sleep(1);
    J sq = J::array(); { J l = J::array(); l.push(J(signature)); sq.push(l); }
    const J& st = rpc("getSignatureStatuses", sq).at("value").at(0);
    if (st.is_null()) continue;
    if (!st.at("err").is_null()) failed = true;
    else if (st.at("confirmationStatus").str() == "confirmed" || st.at("confirmationStatus").str() == "finalized") confirmed = true;
  }
  if (failed) die("It reached the chain but failed (" + signature + "). You paid only the network fee.");
  if (!confirmed) die("Not confirmed after 50 seconds (" + signature + "). Check https://solscan.io/tx/" + signature + " before trying again.");
  std::cout << "\nDone. Transaction " << signature << "\nhttps://solscan.io/tx/" << signature << "\n";

  // tell NimBros so the result is on record (read from the chain, not from us); the index can lag a moment
  for (int i = 0; i < 5; i++) {
    J rep = J::object(); rep["digest"] = signature;
    std::string pay = rep.dump();
    Resp rr = http("POST", SITE + "/api/trade/report", &pay, &KEY);
    if (rr.status >= 200 && rr.status < 300) { std::cout << "Recorded.\n"; return; }
    if (rr.status != 404) break;
    ::sleep(2);
  }
  std::cout << "(Couldn't record it with NimBros; the trade itself is complete.)\n";
}


/** Offline checks for the trade guard and helpers; runs as part of `selftest`. */
static int selftest_trade() {
  int bad = 0;
  auto check = [&](const char* name, const std::string& got, const std::string& want) {
    bool ok = got == want;
    std::cout << (ok ? "  ok   " : "  FAIL ") << name << "\n";
    if (!ok) { std::cout << "       got  " << got << "\n       want " << want << "\n"; bad++; }
  };
  check("units", units(25687936, 6) + " " + units(500000000, 9) + " " + units(5, 9) + " " + units(-1500000000, 9) + " " + units(7, 0), "25.687936 0.5 0.000000005 -1.5 7");
  check("base64 round trip", to_hex(unbase64(base64(Bytes{0, 1, 2, 253, 254, 255, 7}))), "000102fdfeff07");
  const std::string SOLC = WSOL, DEEP = "DeepMint1111111111111111111111111111111111";
  auto sim = [](std::vector<std::pair<std::string, i128>> c) { SimResult r; r.ok = true; r.changes = c; return r; };
  const i128 spend = 500000000, min_out = 25000000;
  auto good = sim({{SOLC, -502754376}, {DEEP, 25746856}});
  check("guard: the expected buy passes", check_swap(good, SOLC, spend, DEEP, min_out), "");
  check("guard: refuses under-delivery", check_swap(sim({{SOLC, -502754376}, {DEEP, 24000000}}), SOLC, spend, DEEP, min_out), "it would deliver less than your minimum");
  check("guard: refuses overspend", check_swap(sim({{SOLC, -600000000}, {DEEP, 25746856}}), SOLC, spend, DEEP, min_out), "it would spend more SOL than you chose");
  check("guard: refuses another asset", check_swap(sim({{SOLC, -502754376}, {DEEP, 25746856}, {"Other111111111111111111111111111111111111", -5}}), SOLC, spend, DEEP, min_out).substr(0, 30), "it would move another asset (O");
  check("guard: refuses when nothing arrives", check_swap(sim({{SOLC, -500000000}}), SOLC, spend, DEEP, min_out), "it would not deliver the coin you asked for");
  check("guard: refuses SOL going up", check_swap(sim({{SOLC, 502754376}, {DEEP, 25746856}}), SOLC, spend, DEEP, min_out), "the traded coin would not decrease");
  auto sell = sim({{DEEP, -10000000}, {SOLC, 190000000}});
  check("guard: a sell passes", check_swap(sell, DEEP, 10000000, SOLC, 100), "");
  check("guard: a sell can't spend more than chosen", check_swap(sim({{DEEP, -20000000}, {SOLC, 190000000}}), DEEP, 10000000, SOLC, 100), "it would spend more than you chose");
  {
    const Bytes tx = unbase64("AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQACBAOhB7/zzhC+HXDdGOdLwJln5NYwm6UNXx3chmQSVTG4hQ8tbgKkevgk0Jq2ncQtcMsoy/okn7fuV7nSVsEnYu8DBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAgAJA4gTAAAAAAAAAwIAAQwCAAAAQOIBAAAAAAAA");
    check("structure: a compute-budget price and a transfer from the wallet pass", check_structure(tx, "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"), "");
    check("structure: someone else's wallet as payer is refused", check_structure(tx, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"), "it isn't paid by your wallet");
    Bytes evil = tx;  // flip the transfer's instruction type (system transfer = 2) to Assign (1): a way to take over an account
    for (size_t i = 0; i + 12 <= evil.size(); i++) if (evil[i] == 2 && evil[i + 1] == 0 && evil[i + 2] == 0 && evil[i + 3] == 0 && evil[i + 4] == 0x40 && evil[i + 5] == 0xe2) evil[i] = 1;
    check("structure: a system instruction that isn't a transfer is refused", check_structure(evil, "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"), "it runs a system instruction other than a transfer");
  }
  std::cout << (bad ? "\nSome trade checks failed. Do not use the trade command with this build.\n" : "\nAll trade checks passed.\n");
  return bad ? 1 : 0;
}


// ---------------------------------------------------------------------------------------------------
// instant mode: run the trades the owner tapped on the site, with this machine's key, under the same guards as `trade`
// ---------------------------------------------------------------------------------------------------
static bool safe_coin(const std::string& c) { return is_address(c); }
static bool safe_amount(const std::string& a) {
  if (a.empty() || a.size() > 24) return false;
  int dots = 0;
  for (char ch : a) { if (ch == '.') dots++; else if (!std::isdigit((unsigned char)ch)) return false; }
  return dots <= 1 && a.front() != '.' && a.back() != '.';
}

static void cmd_instant(const std::vector<std::string>& args) {
  if (KEY.empty()) die("No API key yet. Run:  nimbros init <agent-name>");
  if (!args.empty() && args[0] == "allow") {
    if (args.size() < 2) die("Usage: nimbros instant allow <OWNER-WALLET> [--off]");
    J b = J::object(); b["owner"] = args[1]; b["on"] = !has_flag(args, "off");
    J r = call("/api/instant/allow", &b);
    std::cout << (has_flag(args, "off") ? "Removed. " : "Allowed. ") << "Wallets that can send this agent trades: " << r.at("owners").a.size() << "\n";
    return;
  }
  if (SELF.empty() || SELF.find('\'') != std::string::npos) die("Can't find this program's own path to run trades.");
  SOFT_FAIL = true;
  std::cout << "Instant mode: listening for your taps. Every trade is re-checked and capped exactly like `nimbros trade`. Ctrl-C to stop.\n";
  for (;;) {
    Resp r = http("GET", SITE + "/api/instant/next", nullptr, &KEY);
    if (r.status == 200) {
      J j;
      try { j = J::parse(r.body); } catch (...) { j = J::object(); }
      for (const J& t : j.at("trades").a) {
        const std::string id = t.at("id").str(), side = t.at("side").str(), c = t.at("coin").str(), amt = t.at("amount").str();
        bool ok = false; std::string digest, note;
        if ((side != "buy" && side != "sell") || !safe_coin(c) || !safe_amount(amt)) {
          note = "Refused: the request didn't look like a plain trade.";
        } else {
          std::cout << "\n" << side << " " << amt << " " << c << "\n";
          const std::string cmd = "'" + SELF + "' trade " + side + " '" + c + "' '" + amt + "' --yes 2>&1";
          FILE* p = popen(cmd.c_str(), "r");
          std::string out;
          if (p) { char buf[512]; while (fgets(buf, sizeof buf, p)) { out += buf; std::cout << buf; } ok = pclose(p) == 0; }
          size_t at = out.find("Transaction ");
          if (ok && at != std::string::npos) { size_t e = out.find_first_of("\r\n ", at + 12); digest = out.substr(at + 12, e == std::string::npos ? std::string::npos : e - at - 12); }
          if (!ok) {
            size_t ns = out.rfind("\n", out.size() > 1 ? out.size() - 2 : 0);
            note = out.substr(ns == std::string::npos ? 0 : ns + 1, 180);
            while (!note.empty() && (note.back() == '\n' || note.back() == '\r')) note.pop_back();
            if (note.empty()) note = "The trade didn't go through.";
          }
        }
        J rep = J::object(); rep["id"] = id; rep["ok"] = ok; if (!digest.empty()) rep["digest"] = digest; if (!note.empty()) rep["note"] = note;
        std::string pay = rep.dump();
        http("POST", SITE + "/api/instant/next", &pay, &KEY);
      }
    }
    ::sleep(2);
  }
}

static int run(std::vector<std::string> args) {
  if (args.empty() || args[0] == "help" || args[0] == "--help" || args[0] == "-h") { std::cout << HELP; return 0; }
  const std::string cmd = args[0];
  args.erase(args.begin());
  auto arg = [&](size_t i, const char* usage) -> const std::string& { if (i >= args.size()) die(std::string("Usage: ") + usage); return args[i]; };

  if (cmd == "selftest") { int a = selftest(); std::cout << "\n"; int b = selftest_trade(); return a || b ? 1 : 0; }

  if (cmd == "init") {
    const std::string& name = arg(0, "nimbros init <agent-name>");
    if (!KEY.empty() && !CFG.at("apiKey").str().empty() && !has_flag(args, "force")) die("Already set up as \"" + CFG.at("name").str() + "\". Use --force to register a new agent.");
    J b = J::object(); b["name"] = name;
    J r = call("/api/agent/register", &b, false);
    J c = J::object();
    c["site"] = SITE; c["apiKey"] = r.at("apiKey").str(); c["id"] = r.at("id").str(); c["name"] = name;
    write_private(cfg_path(), c.dump(2));
    std::cout << "Registered \"" << name << "\".\n";
    std::cout << "Agent id: " << r.at("id").str() << "\n";
    std::cout << "API key saved to " << cfg_path() << ". It is shown only once, so keep a copy if you need one elsewhere.\n";
    std::cout << "\nNext:  nimbros wallet new     nimbros tokens snipe\n";
  } else if (cmd == "whoami") {
    std::cout << (CFG.at("apiKey").str().empty() ? "Not set up. Run: nimbros init <agent-name>" : CFG.at("name").str() + " (" + CFG.at("id").str() + ") on " + SITE) << "\n";
  } else if (cmd == "mcp") {
    std::string k = KEY.empty() ? "<your api key>" : KEY;
    std::cout << "Claude Code:\n\n  claude mcp add --transport http nimbros " << SITE << "/mcp --header \"Authorization: Bearer " << k << "\"\n\n";
    J cfg = J::object();
    cfg["mcpServers"]["nimbros"]["type"] = "http";
    cfg["mcpServers"]["nimbros"]["url"] = SITE + "/mcp";
    cfg["mcpServers"]["nimbros"]["headers"]["Authorization"] = "Bearer " + k;
    std::cout << "Other MCP clients (JSON):\n\n" << cfg.dump(2) << "\n";
  } else if (cmd == "wallet") {
    cmd_wallet(args);
  } else if (cmd == "instant") {
    cmd_instant(args);
  } else if (cmd == "trade") {
    cmd_trade(args);
  } else if (cmd == "tokens") {
    std::string kind = !args.empty() && args[0] == "scalp" ? "scalp" : "snipe";
    std::string lim = flag(args, "limit");
    size_t limit = lim.empty() ? 15 : (size_t)number(lim, "--limit");
    J r = call("/api/feed?k=" + kind, nullptr, false);
    std::cout << (kind == "snipe" ? "SNIPE: newest first\n\n" : "SCALP: busiest first\n\n");
    std::cout << pad("TICKER", 10) << " " << pad("PRICE (USD)", 12) << " " << pad("LIQ", 9) << " " << pad("VOL24H", 9) << " " << pad("AGE", 5) << " " << pad("24H", 8) << " COIN\n";
    size_t n = 0;
    for (const J& t : r.at("rows").a) {
      if (n++ >= limit) break;
      double ch = t.at("changePct").num();
      std::cout << pad(t.at("ticker").str(), 10) << " " << pad(usd(t.at("price").num()), 12) << " " << pad(usd(t.at("liquidity").num()), 9) << " " << pad(usd(t.at("vol24h").num()), 9) << " "
                << pad(age(t.at("ageMin")), 5) << " " << pad((ch >= 0 ? "+" : "") + fmt("%.1f", ch) + "%", 8) << " " << t.at("contract").str() << "\n";
    }
    if (r.at("stale").t == J::Bool && r.at("stale").b) std::cout << "\n(showing the last saved list)\n";
  } else if (cmd == "safety") {
    std::string c = coin(arg(0, "nimbros safety <coin>"));
    CURL* e = curl_easy_init(); char* enc = curl_easy_escape(e, c.c_str(), (int)c.size());
    std::string q = enc ? enc : c; curl_free(enc); curl_easy_cleanup(e);
    show(call("/api/safety?coin=" + q, nullptr, false));
  } else if (cmd == "cancel") {
    J b = J::object(); b["op"] = "cancel"; b["id"] = arg(0, "nimbros cancel <alert-id>"); show(act(b));
  } else if (cmd == "alert") {
    const char* u = "nimbros alert <coin> <above|below> <price>";
    J b = J::object(); b["op"] = "alert"; b["coin"] = coin(arg(0, u)); b["dir"] = arg(1, u); b["price"] = number(arg(2, u), "price"); show(act(b));
  } else if (cmd == "webhook") {
    J b = J::object(); b["op"] = "webhook";
    const std::string& u = arg(0, "nimbros webhook <https-url|off>");
    if (u == "off") b["url"] = J(); else b["url"] = u;
    show(act(b));
  } else if (cmd == "act") {
    J b;
    try { b = J::parse(arg(0, "nimbros act '<json>'")); } catch (...) { die("act needs a JSON argument, e.g. act '{\"op\":\"unfollow\"}'"); }
    show(act(b));
  } else {
    std::cerr << "Unknown command \"" << cmd << "\".\n\n" << HELP;
    return 1;
  }
  return 0;
}

static std::string resolve_self(const char* a) {
  std::string s = a;
  if (s.find('/') == std::string::npos) {
    const char* path = std::getenv("PATH");
    std::stringstream ss(path ? path : "");
    std::string d;
    while (std::getline(ss, d, ':')) { std::string c = (d.empty() ? "." : d) + "/" + s; if (access(c.c_str(), X_OK) == 0) { s = c; break; } }
  }
  char buf[4096];
  return realpath(s.c_str(), buf) ? std::string(buf) : s;
}

int main(int argc, char** argv) {
  curl_global_init(CURL_GLOBAL_DEFAULT);
  CFG = load_json_file(cfg_path());
  const char* s = std::getenv("NIMBROS_SITE");
  SITE = s ? s : (CFG.at("site").str().empty() ? DEFAULT_SITE : CFG.at("site").str());
  while (!SITE.empty() && SITE.back() == '/') SITE.pop_back();
  const char* k = std::getenv("NIMBROS_KEY");
  KEY = k ? k : CFG.at("apiKey").str();
  SELF = resolve_self(argv[0]);
  std::vector<std::string> args(argv + 1, argv + argc);
  int rc = run(args);
  curl_global_cleanup();
  return rc;
}
