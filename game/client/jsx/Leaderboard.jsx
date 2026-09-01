import React from 'react';
import {gameService} from './services/GameService';

export default class Leaderboard extends React.Component {
    state = {tab: 'xp', entries: []}

    componentDidMount() { this.load('xp'); }

    load = (type) => {
        this.setState({tab: type});
        gameService.ws.send(JSON.stringify({type: 'wsLeaderboard', lbType: type}));
    }

    componentDidUpdate() {
        if (gameService.leaderboardData && gameService.leaderboardData.lbType === this.state.tab) {
            if (JSON.stringify(gameService.leaderboardData.entries) !== JSON.stringify(this.state.entries)) {
                this.setState({entries: gameService.leaderboardData.entries});
            }
        }
    }

    render() {
        const {tab, entries} = this.state;
        const tabs = [{id: 'xp', label: 'XP'}, {id: 'cpoly', label: '$MEMEOPOLY'}, {id: 'wins', label: 'Wins'}, {id: 'streak', label: 'Streak'}];
        return (
            <div className="leaderboard-panel">
                <h3>Leaderboard</h3>
                <div className="lb-tabs">
                    {tabs.map(t => <button key={t.id} className={`lb-tab ${tab === t.id ? 'active' : ''}`} onClick={() => this.load(t.id)}>{t.label}</button>)}
                </div>
                <div className="lb-list">
                    {entries.length === 0 && <p className="lb-empty">No entries yet. Be the first!</p>}
                    {entries.map((e, i) => (
                        <div key={i} className={`lb-entry ${i < 3 ? 'lb-top' : ''}`}>
                            <span className="lb-rank">#{i + 1}</span>
                            <span className="lb-name">{e.username}</span>
                            <span className="lb-value">
                                {tab === 'xp' && `Lv.${e.level} (${e.xp} XP)`}
                                {tab === 'cpoly' && `${e.cpoly} $MEMEOPOLY`}
                                {tab === 'wins' && `${e.wins} wins`}
                                {tab === 'streak' && `${e.streak} days`}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
}
