import React from 'react';

const STEPS = [
    {
        title: 'Welcome to Memeopoly',
        content: 'A meme-powered multiplayer board game powered by $MEMEOPOLY tokens on Solana. Roll dice, buy meme properties, and build your meme empire!',
        icon: '🎲'
    },
    {
        title: 'Connect Your Wallet',
        content: 'Click "Connect Wallet" in the top-right to link your Phantom wallet. This is required to receive $MEMEOPOLY token rewards and track your on-chain earnings.',
        icon: '👛'
    },
    {
        title: 'How to Play',
        content: 'Create a player, pick a token, and roll the dice. Land on properties (blockchain protocols) to buy them. Collect rent from other players who land on your properties. Pass GO to collect $200 in $MEMEOPOLY.',
        icon: '🏠'
    },
    {
        title: 'Earn $MEMEOPOLY Tokens',
        content: 'Every game you play earns $MEMEOPOLY tokens:\n\n- Win a game: +500 $MEMEOPOLY\n- Complete a full loop: +50 $MEMEOPOLY\n- Own all properties of one color: +200 $MEMEOPOLY\n- Daily login streak: +25 $MEMEOPOLY/day',
        icon: '💰'
    },
    {
        title: 'Referral Rewards',
        content: 'Click "REFER" to get your unique referral link. Share it and earn:\n\n- 5 Referrals: +500 $MEMEOPOLY\n- 10 Referrals: +1,500 $MEMEOPOLY\n- 25 Referrals: +5,000 $MEMEOPOLY\n\nPlus 10% of every referred player\'s earnings!',
        icon: '🔗'
    },
    {
        title: 'Crypto Cards',
        content: 'Land on Chance or Community Chest to draw crypto-themed cards. You might get an airdrop, staking rewards, or get rugpulled! The blockchain is unpredictable.',
        icon: '🃏'
    },
    {
        title: 'Ready to Play!',
        content: 'Join a game, invite friends with your referral link, and start building your crypto empire. The more you play, the more $MEMEOPOLY you earn!',
        icon: '🚀'
    }
];

export default class Tutorial extends React.Component {
    state = {
        step: 0
    }

    next = () => {
        if (this.state.step < STEPS.length - 1) {
            this.setState({step: this.state.step + 1});
        } else {
            localStorage.setItem('memeopoly_tutorial_done', 'true');
            this.props.onClose();
        }
    }

    prev = () => {
        if (this.state.step > 0) {
            this.setState({step: this.state.step - 1});
        }
    }

    skip = () => {
        localStorage.setItem('memeopoly_tutorial_done', 'true');
        this.props.onClose();
    }

    render() {
        const {step} = this.state;
        const current = STEPS[step];
        const isLast = step === STEPS.length - 1;

        return (
            <div className="tutorial-overlay" onClick={this.skip}>
                <div className="tutorial-panel" onClick={e => e.stopPropagation()}>
                    <div className="tutorial-progress">
                        {STEPS.map((_, i) => (
                            <div key={i} className={`progress-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
                        ))}
                    </div>
                    <div className="tutorial-icon">{current.icon}</div>
                    <h2 className="tutorial-title">{current.title}</h2>
                    <div className="tutorial-content">
                        {current.content.split('\n').map((line, i) => (
                            <p key={i}>{line}</p>
                        ))}
                    </div>
                    <div className="tutorial-actions">
                        {step > 0 && <button className="tutorial-btn secondary" onClick={this.prev}>Back</button>}
                        <button className="tutorial-btn primary" onClick={this.next}>
                            {isLast ? 'Start Playing' : 'Next'}
                        </button>
                    </div>
                    <div className="tutorial-skip" onClick={this.skip}>Skip tutorial</div>
                </div>
            </div>
        );
    }
}
