import React from 'react';
import {gameService} from './services/GameService';

export default class VaultPanel extends React.Component {
    state = {
        vault: null,
        tokenBalance: null,
        tab: 'overview'
    }

    componentDidMount() {
        this.load();
        gameService.onVaultState = (data) => this.setState({vault: data});
        gameService.onTokenBalance = (data) => this.setState({tokenBalance: data});
    }

    componentWillUnmount() {
        gameService.onVaultState = null;
        gameService.onTokenBalance = null;
    }

    load = () => {
        if (gameService.ws && gameService.ws.readyState === 1) {
            gameService.ws.send(JSON.stringify({type: 'wsGetVault'}));
            if (this.props.accountId) {
                gameService.ws.send(JSON.stringify({type: 'wsGetTokenBalance', userId: this.props.accountId}));
            }
        }
    }

    formatNum = (n) => {
        if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
        return String(n);
    }

    render() {
        const {vault, tokenBalance, tab} = this.state;

        return (
            <div className="vault-panel">
                <h3>$MEMO Vault</h3>

                <div className="vault-tabs">
                    <button className={`vault-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => this.setState({tab: 'overview'})}>Overview</button>
                    <button className={`vault-tab ${tab === 'rewards' ? 'active' : ''}`} onClick={() => this.setState({tab: 'rewards'})}>Rewards</button>
                    <button className={`vault-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => this.setState({tab: 'history'})}>History</button>
                </div>

                {tab === 'overview' && vault && <div className="vault-overview">
                    <div className="vault-status">{vault.launched ? 'TOKEN LIVE' : 'PRE-LAUNCH (XP Phase)'}</div>

                    <div className="vault-supply-bar">
                        <div className="supply-segment reward" style={{width: (vault.rewardVault / vault.totalSupply * 100) + '%'}}>
                            <span>Reward Vault</span>
                        </div>
                        <div className="supply-segment circulating" style={{width: (vault.circulating / vault.totalSupply * 100) + '%'}}>
                            <span>Circulating</span>
                        </div>
                    </div>

                    <div className="vault-grid">
                        <div className="vstat"><span>{this.formatNum(vault.totalSupply)}</span><label>Total Supply</label></div>
                        <div className="vstat"><span>{this.formatNum(vault.rewardVault)}</span><label>Reward Vault</label></div>
                        <div className="vstat"><span>{this.formatNum(vault.circulating)}</span><label>Circulating</label></div>
                        <div className="vstat"><span>{this.formatNum(vault.recycled)}</span><label>Recycled</label></div>
                    </div>

                    <p className="vault-disclaimer">
                        $MEMO is an in-game point. It has no cash value, is not an
                        investment, and cannot be redeemed for money. It is earned by
                        playing and spent on cosmetic items only.
                    </p>

                    <div className="halvening-info">
                        <h4>Halvening</h4>
                        <p>Halvenings completed: <strong>{vault.halvening.count}</strong></p>
                        <p>Current earn rate: <strong>{(vault.halvening.currentRate * 100).toFixed(1)}%</strong></p>
                        <p>Next halvening at: <strong>{this.formatNum(vault.halvening.nextThreshold)}</strong> distributed</p>
                    </div>

                    <div className="vault-xp-total">
                        <span>{this.formatNum(vault.totalXPEarned)}</span>
                        <label>Total Platform XP Earned</label>
                    </div>

                    {vault.recycled > 0 && <p className="recycle-info">{this.formatNum(vault.recycled)} tokens recycled back to reward vault</p>}
                </div>}

                {tab === 'overview' && tokenBalance && <div className="vault-my-tokens">
                    <h4>Your Position</h4>
                    <div className="vault-grid">
                        <div className="vstat highlight"><span>{this.formatNum(tokenBalance.tokens)}</span><label>$MEMO Points</label></div>
                        <div className="vstat"><span>Lv.{tokenBalance.level}</span><label>Level</label></div>
                        <div className="vstat"><span>{this.formatNum(tokenBalance.xp)}</span><label>Total XP</label></div>
                    </div>
                </div>}

                {tab === 'rewards' && <div className="vault-rewards">
                    <p className="reward-phase">{vault && vault.launched ? 'Earning tokens (with halvening)' : 'Earning XP (pre-token launch)'}</p>
                    <div className="reward-table">
                        <div className="reward-row header"><span>Action</span><span>Base Reward</span><span>Current Rate</span></div>
                        <div className="reward-row"><span>Daily Login</span><span>25</span><span>{vault ? Math.floor(25 * vault.halvening.currentRate) : 25}</span></div>
                        <div className="reward-row"><span>Pass GO</span><span>50</span><span>{vault ? Math.floor(50 * vault.halvening.currentRate) : 50}</span></div>
                        <div className="reward-row"><span>Game Played</span><span>100</span><span>{vault ? Math.floor(100 * vault.halvening.currentRate) : 100}</span></div>
                        <div className="reward-row"><span>Game Won</span><span>500</span><span>{vault ? Math.floor(500 * vault.halvening.currentRate) : 500}</span></div>
                        <div className="reward-row"><span>Referral</span><span>200</span><span>{vault ? Math.floor(200 * vault.halvening.currentRate) : 200}</span></div>
                        <div className="reward-row"><span>Achievement</span><span>150</span><span>{vault ? Math.floor(150 * vault.halvening.currentRate) : 150}</span></div>
                        <div className="reward-row"><span>Property Bought</span><span>30</span><span>{vault ? Math.floor(30 * vault.halvening.currentRate) : 30}</span></div>
                        <div className="reward-row"><span>Dice Roll</span><span>5</span><span>{vault ? Math.floor(5 * vault.halvening.currentRate) : 5}</span></div>
                        <div className="reward-row"><span>Color Set</span><span>300</span><span>{vault ? Math.floor(300 * vault.halvening.currentRate) : 300}</span></div>
                    </div>
                </div>}

                {tab === 'history' && vault && <div className="vault-history">
                    {vault.recentTransactions.slice().reverse().map((tx, i) => (
                        <div key={i} className={`tx-row tx-${tx.type}`}>
                            <span className="tx-type">{tx.type.replace(/_/g, ' ')}</span>
                            {tx.amount && <span className="tx-amount">{tx.type.includes('cash') ? '-' : '+'}{this.formatNum(tx.amount)}</span>}
                            {tx.userId && <span className="tx-user">{tx.userId}</span>}
                            <span className="tx-time">{new Date(tx.timestamp).toLocaleString()}</span>
                        </div>
                    ))}
                    {vault.recentTransactions.length === 0 && <p className="lb-empty">No transactions yet</p>}
                </div>}
            </div>
        );
    }
}
