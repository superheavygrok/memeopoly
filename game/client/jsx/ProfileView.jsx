import React from 'react';

const ACHIEVEMENT_ICONS = {
    dice: 'fa-dice', trophy: 'fa-trophy', gem: 'fa-gem', fire: 'fa-fire',
    link: 'fa-link', megaphone: 'fa-bullhorn', building: 'fa-building',
    crown: 'fa-crown', star: 'fa-star'
};

export default class ProfileView extends React.Component {
    state = {achievements: []}

    componentDidMount() {
        fetch('/api/achievements').then(r => r.json()).then(a => this.setState({achievements: a})).catch(() => {});
    }

    copyShareLink = () => {
        const url = window.location.origin + '/share/profile/' + this.props.account.id;
        navigator.clipboard.writeText(url).catch(() => {});
    }

    render() {
        const {account} = this.props;
        if (!account) return null;

        const xpNeeded = account.level * 100;
        const xpPct = Math.min(100, (account.xp / xpNeeded) * 100);

        return (
            <div className="profile-view">
                <div className="profile-header">
                    <div className="profile-level">Lv. {account.level}</div>
                    <h2>{account.username}</h2>
                    <div className="xp-bar"><div className="xp-fill" style={{width: xpPct + '%'}}></div></div>
                    <p className="xp-text">{account.xp} / {xpNeeded} XP</p>
                    <button className="share-btn" onClick={this.copyShareLink}><i className="fas fa-share-alt"></i> Share Profile</button>
                </div>

                <div className="profile-stats">
                    <div className="pstat"><span>{account.cpolyBalance}</span><label>$MEMEOPOLY</label></div>
                    <div className="pstat"><span>{account.stats.gamesPlayed}</span><label>Games</label></div>
                    <div className="pstat"><span>{account.stats.gamesWon}</span><label>Wins</label></div>
                    <div className="pstat"><span>{account.stats.loginStreak}</span><label>Streak</label></div>
                    <div className="pstat"><span>{account.stats.referralCount}</span><label>Referrals</label></div>
                    <div className="pstat"><span>{account.stats.totalLogins}</span><label>Logins</label></div>
                </div>

                <h3>Achievements</h3>
                <div className="achievements-grid">
                    {this.state.achievements.map(a => {
                        const unlocked = account.achievements.indexOf(a.id) !== -1;
                        return (
                            <div key={a.id} className={`achievement ${unlocked ? 'unlocked' : 'locked'}`}>
                                <i className={`fas ${ACHIEVEMENT_ICONS[a.icon] || 'fa-star'}`}></i>
                                <div>
                                    <strong>{a.name}</strong>
                                    <p>{a.desc}</p>
                                    <span className="ach-xp">+{a.xp} XP</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
}
