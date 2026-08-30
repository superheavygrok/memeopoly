'use strict';

/**
 * Server-verified wallet gate.
 *
 * Flow (all four steps matter):
 *   1. client asks for a challenge  -> server issues a single-use nonce
 *   2. client signs the challenge   -> proves it controls the private key
 *   3. server verifies the signature AND reads the SPL balance itself
 *   4. server issues a session token -> required to join a game room
 *
 * The balance is read server-side from an RPC node. A client-reported balance
 * is worthless: anyone can edit it in devtools. Likewise the gate is enforced
 * on the websocket join, not just by hiding a button.
 *
 * No new npm dependencies: Node >= 18 ships ed25519 in `crypto` and a global
 * `fetch`, so base58 is the only thing worth hand-rolling.
 */

const crypto = require('crypto');

const MINT = process.env.GATE_MINT || '';
const MIN_BALANCE = Number(process.env.GATE_MIN_BALANCE || 100);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DOMAIN = process.env.GATE_DOMAIN || 'memeopoly';

const NONCE_TTL_MS = 5 * 60 * 1000;      // 5 minutes to sign
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours of play
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;

const nonces = new Map();   // nonce -> {publicKey, expires}
const sessions = new Map(); // token  -> {publicKey, balance, expires}
const rate = new Map();     // ip     -> {count, resetAt}

// --- base58 ------------------------------------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = (() => { const m = {}; for (let i = 0; i < B58.length; i++) m[B58[i]] = i; return m; })();

function base58Decode(str) {
    if (typeof str !== 'string' || str.length === 0) throw new Error('empty base58');
    const bytes = [0];
    for (const ch of str) {
        const val = B58MAP[ch];
        if (val === undefined) throw new Error('invalid base58 character');
        let carry = val;
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
    return Buffer.from(bytes.reverse());
}

// --- ed25519 -----------------------------------------------------------
// SPKI DER header for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifySignature(messageBytes, signatureBytes, publicKeyBytes) {
    if (publicKeyBytes.length !== 32) return false;
    if (signatureBytes.length !== 64) return false;
    try {
        const key = crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
            format: 'der',
            type: 'spki'
        });
        return crypto.verify(null, messageBytes, key, signatureBytes);
    } catch (e) {
        return false;
    }
}

// --- helpers -----------------------------------------------------------
function isEnabled() {
    return Boolean(MINT);
}

function rateLimited(ip) {
    const now = Date.now();
    const entry = rate.get(ip);
    if (!entry || now > entry.resetAt) {
        rate.set(ip, {count: 1, resetAt: now + RATE_WINDOW_MS});
        return false;
    }
    entry.count++;
    return entry.count > RATE_MAX;
}

function sweep() {
    const now = Date.now();
    for (const [k, v] of nonces) if (now > v.expires) nonces.delete(k);
    for (const [k, v] of sessions) if (now > v.expires) sessions.delete(k);
    for (const [k, v] of rate) if (now > v.resetAt) rate.delete(k);
}
setInterval(sweep, 60 * 1000).unref();

function buildMessage(publicKey, nonce) {
    return [
        DOMAIN + ' wants you to sign in with your Solana account:',
        publicKey,
        '',
        'Signing proves you own this wallet. It costs nothing and sends no transaction.',
        '',
        'Nonce: ' + nonce
    ].join('\n');
}

// --- public API --------------------------------------------------------

function getConfig() {
    return {
        enabled: isEnabled(),
        mint: MINT || null,
        minBalance: MIN_BALANCE,
        // Never leak the RPC URL; it may contain an API key.
        message: isEnabled()
            ? 'Hold at least ' + MIN_BALANCE + ' tokens to play.'
            : 'Wallet gate is disabled (no GATE_MINT configured).'
    };
}

function createChallenge(publicKey, ip) {
    if (rateLimited(ip)) return {error: 'Too many requests, slow down'};
    let keyBytes;
    try {
        keyBytes = base58Decode(String(publicKey || ''));
    } catch (e) {
        return {error: 'Invalid wallet address'};
    }
    if (keyBytes.length !== 32) return {error: 'Invalid wallet address'};

    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(nonce, {publicKey, expires: Date.now() + NONCE_TTL_MS});
    return {nonce, message: buildMessage(publicKey, nonce), expiresIn: NONCE_TTL_MS / 1000};
}

/**
 * Reads the wallet's balance of MINT directly from an RPC node.
 * Returns a UI amount (decimals already applied), or null if the read failed.
 */
async function readTokenBalance(publicKey) {
    const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [publicKey, {mint: MINT}, {encoding: 'jsonParsed'}]
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(RPC_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.error || !json.result) return null;
        let total = 0;
        for (const acc of json.result.value || []) {
            const amt = acc.account.data.parsed.info.tokenAmount;
            total += Number(amt.uiAmount || 0);
        }
        return total;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function verifyChallenge(publicKey, signature, nonce, ip) {
    if (rateLimited(ip)) return {error: 'Too many requests, slow down'};

    const record = nonces.get(nonce);
    if (!record) return {error: 'Challenge expired or already used'};
    // Single use, no matter the outcome.
    nonces.delete(nonce);
    if (Date.now() > record.expires) return {error: 'Challenge expired'};
    if (record.publicKey !== publicKey) return {error: 'Challenge does not match this wallet'};

    let keyBytes, sigBytes;
    try {
        keyBytes = base58Decode(String(publicKey));
        sigBytes = Array.isArray(signature) ? Buffer.from(signature) : base58Decode(String(signature));
    } catch (e) {
        return {error: 'Malformed signature'};
    }

    const message = Buffer.from(buildMessage(publicKey, nonce), 'utf8');
    if (!verifySignature(message, sigBytes, keyBytes)) {
        return {error: 'Signature verification failed'};
    }

    // Signature is good. Now the part the client cannot influence.
    if (!isEnabled()) {
        const token = issueSession(publicKey, null);
        return {success: true, token, gated: false, balance: null, minBalance: MIN_BALANCE};
    }

    const balance = await readTokenBalance(publicKey);
    if (balance === null) return {error: 'Could not reach the network to check your balance. Try again.'};
    if (balance < MIN_BALANCE) {
        return {
            error: 'You hold ' + balance + ' but need ' + MIN_BALANCE + ' to play.',
            balance,
            minBalance: MIN_BALANCE,
            insufficient: true
        };
    }

    const token = issueSession(publicKey, balance);
    return {success: true, token, gated: true, balance, minBalance: MIN_BALANCE};
}

function issueSession(publicKey, balance) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {publicKey, balance, expires: Date.now() + SESSION_TTL_MS});
    return token;
}

function getSession(token) {
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expires) { sessions.delete(token); return null; }
    return s;
}

/** True when this token may join a room. Open when the gate is not configured. */
function isAllowed(token) {
    if (!isEnabled()) return true;
    return getSession(token) !== null;
}

module.exports = {
    getConfig,
    createChallenge,
    verifyChallenge,
    getSession,
    isAllowed,
    isEnabled,
    // exported for tests
    _base58Decode: base58Decode,
    _verifySignature: verifySignature,
    _buildMessage: buildMessage
};
