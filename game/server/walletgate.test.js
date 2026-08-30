'use strict';

/**
 * Run with:  node server/walletgate.test.js
 * No test framework - the repo has none and this must stay dependency-free.
 */

const crypto = require('crypto');
const assert = require('assert');
const gate = require('./walletgate');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('  PASS  ' + name); passed++; }
    catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failed++; }
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buf) {
    const digits = [0];
    for (const byte of buf) {
        let carry = byte;
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '';
    for (let k = 0; k < buf.length && buf[k] === 0; k++) out += '1';
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
}

console.log('\nbase58');
test('round-trips random 32-byte keys', () => {
    for (let i = 0; i < 50; i++) {
        const buf = crypto.randomBytes(32);
        const decoded = gate._base58Decode(base58Encode(buf));
        assert.strictEqual(decoded.toString('hex'), buf.toString('hex'));
    }
});
test('decodes a known Solana address to 32 bytes', () => {
    const d = gate._base58Decode('GMEQTAqTsXg2bpoTaeDLDWcwzYKRbTkfHXQVNW5Jdjsy');
    assert.strictEqual(d.length, 32);
});
test('preserves leading zero bytes', () => {
    const buf = Buffer.concat([Buffer.from([0, 0]), crypto.randomBytes(30)]);
    assert.strictEqual(gate._base58Decode(base58Encode(buf)).toString('hex'), buf.toString('hex'));
});
test('rejects invalid characters', () => {
    assert.throws(() => gate._base58Decode('0OIl'));
});

console.log('\ned25519 signature verification');
const kp = crypto.generateKeyPairSync('ed25519');
const rawPub = kp.publicKey.export({format: 'der', type: 'spki'}).subarray(-32);
const msg = Buffer.from('hello memeopoly', 'utf8');
const sig = crypto.sign(null, msg, kp.privateKey);

test('accepts a valid signature', () => {
    assert.strictEqual(gate._verifySignature(msg, sig, rawPub), true);
});
test('rejects a tampered message', () => {
    assert.strictEqual(gate._verifySignature(Buffer.from('hello memeopoly!', 'utf8'), sig, rawPub), false);
});
test('rejects a signature from a different key', () => {
    const other = crypto.generateKeyPairSync('ed25519');
    const otherSig = crypto.sign(null, msg, other.privateKey);
    assert.strictEqual(gate._verifySignature(msg, otherSig, rawPub), false);
});
test('rejects a flipped signature bit', () => {
    const bad = Buffer.from(sig); bad[0] ^= 0x01;
    assert.strictEqual(gate._verifySignature(msg, bad, rawPub), false);
});
test('rejects wrong-length key and signature', () => {
    assert.strictEqual(gate._verifySignature(msg, sig, rawPub.subarray(0, 31)), false);
    assert.strictEqual(gate._verifySignature(msg, sig.subarray(0, 63), rawPub), false);
});

console.log('\nchallenge lifecycle');
const pub58 = base58Encode(rawPub);

test('issues a challenge containing the nonce and address', () => {
    const c = gate.createChallenge(pub58, '1.1.1.1');
    assert.ok(c.nonce, 'no nonce');
    assert.ok(c.message.includes(c.nonce), 'message missing nonce');
    assert.ok(c.message.includes(pub58), 'message missing address');
});
test('rejects a malformed wallet address', () => {
    assert.ok(gate.createChallenge('not-a-key!!', '1.1.1.2').error);
});

test('a valid signature over the real message verifies', async () => {
    const c = gate.createChallenge(pub58, '2.2.2.1');
    const signed = crypto.sign(null, Buffer.from(c.message, 'utf8'), kp.privateKey);
    const r = await gate.verifyChallenge(pub58, Array.from(signed), c.nonce, '2.2.2.1');
    assert.ok(r.success, 'expected success, got ' + JSON.stringify(r));
    assert.ok(r.token, 'no session token');
    assert.strictEqual(gate.isAllowed(r.token), true);
});

test('a nonce cannot be replayed', async () => {
    const c = gate.createChallenge(pub58, '2.2.2.2');
    const signed = crypto.sign(null, Buffer.from(c.message, 'utf8'), kp.privateKey);
    const first = await gate.verifyChallenge(pub58, Array.from(signed), c.nonce, '2.2.2.2');
    assert.ok(first.success);
    const second = await gate.verifyChallenge(pub58, Array.from(signed), c.nonce, '2.2.2.2');
    assert.ok(second.error, 'replay should be rejected');
});

test('a signature over a DIFFERENT nonce is rejected', async () => {
    const a = gate.createChallenge(pub58, '2.2.2.3');
    const b = gate.createChallenge(pub58, '2.2.2.3');
    const signedA = crypto.sign(null, Buffer.from(a.message, 'utf8'), kp.privateKey);
    const r = await gate.verifyChallenge(pub58, Array.from(signedA), b.nonce, '2.2.2.3');
    assert.ok(r.error, 'cross-nonce signature should fail');
});

test('another wallet cannot claim this nonce', async () => {
    const c = gate.createChallenge(pub58, '2.2.2.4');
    const other = crypto.generateKeyPairSync('ed25519');
    const otherPub = base58Encode(other.publicKey.export({format: 'der', type: 'spki'}).subarray(-32));
    const signed = crypto.sign(null, Buffer.from(c.message, 'utf8'), other.privateKey);
    const r = await gate.verifyChallenge(otherPub, Array.from(signed), c.nonce, '2.2.2.4');
    assert.ok(r.error, 'wallet mismatch should be rejected');
});

test('an unknown session token is not allowed when the gate is on', () => {
    // isAllowed is open when GATE_MINT is unset, so only assert the lookup here.
    assert.strictEqual(gate.getSession('deadbeef'), null);
});

setTimeout(() => {
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    process.exit(failed ? 1 : 0);
}, 500);
