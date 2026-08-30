import React from 'react';
import {gameService} from './services/GameService';

const TOKEN_KEY = 'memeopoly_gate_token';

/**
 * Sign-in-with-Solana wallet gate.
 *
 * connect -> request challenge -> sign it -> server verifies the signature and
 * reads the SPL balance itself -> server issues a session token.
 *
 * The token is what lets you join a room; the server re-checks it on every
 * joinRoom. Nothing here is trusted by the backend.
 */
export default class WalletConnect extends React.Component {
    state = {
        status: 'idle',   // idle | connecting | signing | verifying | ready | error
        address: null,
        balance: null,
        error: null,
        config: null
    };

    componentDidMount() {
        this.restore();
        fetch('/api/wallet/config')
            .then(r => r.json())
            .then(config => this.setState({config}))
            .catch(() => {});
    }

    /** Reuse an existing session so users don't re-sign on every reload. */
    restore = async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return;
        try {
            const r = await fetch('/api/wallet/session?token=' + encodeURIComponent(token));
            const j = await r.json();
            if (j.valid) {
                this.setState({status: 'ready', address: j.publicKey, balance: j.balance});
                this.publish(token, j.publicKey);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (e) {
            // offline or server down - stay logged out rather than fake a pass
        }
    };

    publish = (token, address) => {
        // gameService reads this on every joinRoom; the server re-verifies it.
        gameService.gateToken = token;
        if (this.props.onGateChange) this.props.onGateChange({token, address});
    };

    fail = (msg) => {
        this.setState({status: 'error', error: msg});
        if (this.props.onNotify) this.props.onNotify(msg, 'warning');
    };

    connect = async () => {
        const provider = window.solana;
        if (!provider || !provider.isPhantom) {
            window.open('https://phantom.app/', '_blank');
            return this.fail('Install Phantom to connect a wallet');
        }

        try {
            this.setState({status: 'connecting', error: null});
            const resp = await provider.connect();
            const address = resp.publicKey.toString();
            this.setState({address});

            // 1. challenge
            const cRes = await fetch('/api/wallet/challenge', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({publicKey: address})
            });
            const challenge = await cRes.json();
            if (challenge.error) return this.fail(challenge.error);

            // 2. sign it
            this.setState({status: 'signing'});
            const encoded = new TextEncoder().encode(challenge.message);
            const signed = await provider.signMessage(encoded, 'utf8');

            // 3. server verifies signature AND balance
            this.setState({status: 'verifying'});
            const vRes = await fetch('/api/wallet/verify', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    publicKey: address,
                    signature: Array.from(signed.signature || signed),
                    nonce: challenge.nonce
                })
            });
            const result = await vRes.json();

            if (result.error) {
                this.setState({balance: result.balance != null ? result.balance : null});
                return this.fail(result.error);
            }

            localStorage.setItem(TOKEN_KEY, result.token);
            this.setState({status: 'ready', balance: result.balance, error: null});
            this.publish(result.token, address);
            if (this.props.onNotify) {
                this.props.onNotify(
                    result.gated
                        ? 'Wallet verified - ' + result.balance + ' tokens held'
                        : 'Wallet verified',
                    'success'
                );
            }
        } catch (err) {
            if (err && (err.code === 4001 || /reject/i.test(err.message || ''))) {
                return this.fail('Signature request cancelled');
            }
            this.fail('Wallet verification failed');
        }
    };

    disconnect = () => {
        localStorage.removeItem(TOKEN_KEY);
        this.setState({status: 'idle', address: null, balance: null, error: null});
        this.publish(null, null);
        try { window.solana && window.solana.disconnect(); } catch (e) {}
    };

    short = (a) => a ? a.slice(0, 4) + '...' + a.slice(-4) : '';

    render() {
        const {status, address, balance, error, config} = this.state;
        const min = config ? config.minBalance : null;

        if (status === 'ready') {
            return (
                <button className="wallet-btn connected" onClick={this.disconnect}
                        title={address + (balance != null ? ' - ' + balance + ' tokens' : '')}>
                    <span className="wallet-dot"/>
                    {this.short(address)}
                    {balance != null && <span className="wallet-bal">{balance}</span>}
                </button>
            );
        }

        const busy = status === 'connecting' || status === 'signing' || status === 'verifying';
        const labels = {connecting: 'Connecting...', signing: 'Sign in wallet...', verifying: 'Verifying...'};

        return (
            <button className={'wallet-btn' + (error ? ' wallet-error' : '')}
                    onClick={this.connect}
                    disabled={busy}
                    title={error || (min ? 'Hold ' + min + ' tokens to play' : 'Connect your wallet')}>
                {busy ? labels[status] : (error ? 'Retry' : 'Connect Wallet')}
            </button>
        );
    }
}
