import React from 'react';
import {gameService} from './services/GameService';

export default class ReferralPanel extends React.Component {
    state = {
        open: false,
        copied: false,
        referralSent: false
    }

    componentDidMount() {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref) {
            localStorage.setItem('memeopoly_referred_by', ref);
        }
    }

    componentDidUpdate(prevProps) {
        if (this.props.playerName && !prevProps.playerName && !this.state.referralSent) {
            const ref = localStorage.getItem('memeopoly_referred_by');
            if (ref) {
                gameService.registerReferral(ref);
                this.setState({referralSent: true});
            }
            gameService.getCpolyState();
        }
    }

    generateCode = (playerName) => {
        if (!playerName) return '';
        let hash = 0;
        for (let i = 0; i < playerName.length; i++)
            hash = ((hash << 5) - hash + playerName.charCodeAt(i)) | 0;
        return `${playerName.slice(0, 4).toUpperCase()}${Math.abs(hash).toString(36).slice(0, 4).toUpperCase()}`;
    }

    copyCode = () => {
        const code = this.getCode();
        const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
        navigator.clipboard.writeText(link).then(() => {
            this.setState({copied: true});
            setTimeout(() => this.setState({copied: false}), 2000);
            if (this.props.onNotify) {
                this.props.onNotify('Referral link copied!', 'success');
            }
        });
    }

    getCode() {
        if (this.props.playerName) return this.generateCode(this.props.playerName);
        return 'JOIN GAME FIRST';
    }

    render() {
        const code = this.getCode();
        const hasPlayer = !!this.props.playerName;
        const refData = this.props.referralData || {count: 0, earnings: 0};
        const cpolyBalance = this.props.cpolyBalance || 0;

        return (<div>
            <button className="referral-btn" onClick={() => this.setState({open: true})}>
                REFER {cpolyBalance > 0 ? `(${cpolyBalance} $MEMEOPOLY)` : ''}
            </button>
            {this.state.open && <div className="referral-overlay" onClick={() => this.setState({open: false})}>
                <div className="referral-panel" style={{position: 'relative'}} onClick={e => e.stopPropagation()}>
                    <span className="close-panel" onClick={() => this.setState({open: false})}>x</span>
                    <h2>Referral Program</h2>
                    <div className="referral-section">
                        <label>Your Referral Code</label>
                        <span className="referral-code">{code}</span>
                        {hasPlayer && <button className="copy-btn" onClick={this.copyCode}>
                            {this.state.copied ? 'COPIED!' : 'COPY LINK'}
                        </button>}
                    </div>
                    <div className="referral-section">
                        <label>Your $MEMEOPOLY Balance</label>
                        <span className="referral-code">{cpolyBalance}</span>
                    </div>
                    <div className="referral-stats">
                        <div className="stat">
                            <span className="num">{refData.count || 0}</span>
                            <span className="label">Referrals</span>
                        </div>
                        <div className="stat">
                            <span className="num">{refData.earnings || 0}</span>
                            <span className="label">$MEMEOPOLY from Refs</span>
                        </div>
                    </div>
                    <div className="milestones">
                        <div className={`milestone ${(refData.count || 0) >= 5 ? 'claimed' : ''}`}>
                            <span>5 Referrals {(refData.count || 0) >= 5 ? '(claimed)' : ''}</span>
                            <span className="reward">+500 $MEMEOPOLY</span>
                        </div>
                        <div className={`milestone ${(refData.count || 0) >= 10 ? 'claimed' : ''}`}>
                            <span>10 Referrals {(refData.count || 0) >= 10 ? '(claimed)' : ''}</span>
                            <span className="reward">+1,500 $MEMEOPOLY</span>
                        </div>
                        <div className={`milestone ${(refData.count || 0) >= 25 ? 'claimed' : ''}`}>
                            <span>25 Referrals {(refData.count || 0) >= 25 ? '(claimed)' : ''}</span>
                            <span className="reward">+5,000 $MEMEOPOLY</span>
                        </div>
                    </div>
                </div>
            </div>}
        </div>);
    }
}
