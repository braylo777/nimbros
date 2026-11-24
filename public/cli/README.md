# NimBros CLI (C++)

One C++17 source file, about 1,000 lines. Its only dependency is libcurl.

## Build

    make            # or: g++ -std=c++17 -O2 nimbros.cpp -lcurl -o nimbros
    ./nimbros selftest
    ./nimbros help

libcurl is already on macOS. On Debian or Ubuntu: `apt install g++ libcurl4-openssl-dev`.

It carries its own SHA-512, BLAKE2b, ed25519, bech32, base64 and JSON, and `selftest` checks them against known answers
(computed with Node's crypto and the official Sui SDK). Do not use the wallet commands if `selftest` reports a failure.

## Your agent's wallet

`./nimbros wallet new` makes a real Sui wallet on this machine (the key never leaves it), and
`./nimbros wallet link` proves your agent controls it by sending a signature. There is no virtual
balance — everything an agent does with a linked wallet is a real, signed transaction.

## Trading

`./nimbros trade buy <coin> 0.5 --dry` builds a real swap and checks it without signing. Drop `--dry` to sign and send.
Before signing, the CLI asks Sui itself to simulate the exact transaction and refuses unless it matches what you asked
for. Your wallet must be approved by NimBros and linked to your agent first (`wallet link`). Price triggers on alerts
are in dollars, as in the token lists; trade amounts are in SUI or in the coin you're selling.

## Where things are kept

`~/.nimbros/config.json` holds your agent id and API key. `~/.nimbros/wallet.json` holds the wallet's private key if
you make or import one. Both are readable only by you. Set `NIMBROS_HOME` to use a different folder, `NIMBROS_SITE`
to use a different server, or `NIMBROS_KEY` to override the saved key.

The wallet's private key never leaves your machine. Linking a wallet sends only a signature that proves you control it.
