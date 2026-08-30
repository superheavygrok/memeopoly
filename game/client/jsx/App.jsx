import React from 'react';
import Board from "./Board";

import {gameService} from "./services/GameService";
import {soundManager} from "./services/SoundManager";
import Logs from "./Logs";
import Video from "./Video";
import Players from './Players';
import SelectPlayerDialog from "./SelectPlayerDialog";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faTimesCircle} from "@fortawesome/free-solid-svg-icons";
import {rtcService} from "./services/webrtc";
import Settings from "./Settings";
import HelpDialog from "./HelpDialog";
import ReferralPanel from "./ReferralPanel";
import Notifications from "./Notifications";
import WalletConnect from "./WalletConnect";
import Tutorial from "./Tutorial";
import RoomLobby from "./RoomLobby";
import LandingPage from "./LandingPage";
import Leaderboard from "./Leaderboard";
import ProfileView from "./ProfileView";
import VaultPanel from "./VaultPanel";

const MAX_LOGS = 200;

export default class App extends React.Component {

    constructor(props) {
        super(props)
        this.state = {
            logs: [],
            chat: [],
            cardToShow: null,
            showHelp: false,
            lostConnection: false,
            notifications: [],
            showTutorial: !localStorage.getItem('memeopoly_tutorial_done'),
            cpolyBalances: {},
            referralData: {},
            inRoom: false,
            roomId: null,
            connected: false,
            // Skeleton: auth state
            view: 'landing', // landing | lobby | game | profile | leaderboard
            account: null,
            authToken: null,
            showProfile: false,
            showLeaderboard: false,
            showVault: false,
            // Turn system
            buyOffer: null,
            buyOfferTimer: null,
            showJailedOverlay: false,
            showNPCMenu: false,
            // Auction system
            auction: null,
            auctionTimer: null,
            sidebarTab: 'logs',
            diceSkin: localStorage.getItem('memeopoly_dice_skin') || 'neon',
            mobilePanel: null, // null | 'wins' | 'build' | 'album' | 'friends'
            showSettingsPanel: false,
            xpData: {},
            levelUpAlert: null,
            autopilot: false
        };
    }

    componentDidMount() {
        const saved = localStorage.getItem('memeopoly_account');
        if (saved) {
            try {
                const account = JSON.parse(saved);
                this.setState({account, view: 'connecting'});
            } catch(e) {}
        }
        this.connectToGame();
    }

    componentDidUpdate(prevProps, prevState) {
        const footer = document.getElementById('memeopoly-footer');
        if (footer) footer.style.display = this.state.inRoom ? 'none' : '';
    }

    connectToGame = () => {
        this.setState({game: null, connected: false}, () => {
            const location = window.location;
            let url = location.protocol.replace("http", "ws") + '//' + window.location.hostname + (location.port.length > 0 ? ':' + location.port : "") + location.pathname;
            const wsConnection = new WebSocket(url);

            wsConnection.onopen = () => {
                this.setState({connected: true, lostConnection: false}, () => {
                    if (this.state.view === 'connecting') {
                        this.setState({view: 'lobby'});
                    }
                    const urlParams = new URLSearchParams(window.location.search);
                    const roomFromUrl = urlParams.get('room');
                    if (roomFromUrl) {
                        gameService.joinRoom(roomFromUrl);
                    }
                });
            };

            wsConnection.onclose = () => {
                this.setState({lostConnection: true, connected: false, inRoom: false}, () => {
                    setTimeout(this.connectToGame, 1000);
                });
            }

            wsConnection.onmessage = this.updateGame;
            gameService.ws = wsConnection;
            rtcService.serverConnection = wsConnection;
        })
    }

    handleAuth = (account, token) => {
        localStorage.setItem('memeopoly_account', JSON.stringify(account));
        this.setState({account, authToken: token, view: 'lobby'});
        this.addNotification(`Welcome back, ${account.username}! Streak: ${account.stats.loginStreak} days`, 'reward', 'Login Bonus');
    }

    handleGuestPlay = () => {
        this.setState({view: 'lobby'});
    }

    handleLogout = () => {
        localStorage.removeItem('memeopoly_account');
        this.setState({account: null, authToken: null, view: 'landing', inRoom: false});
        gameService.leaveRoom();
    }

    updateGame = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'roomJoined') {
            gameService.currentRoom = data.roomId;
            this.setState({inRoom: true, roomId: data.roomId, view: 'game', showHelp: true});
        } else if (data.type === 'roomList') {
            if (gameService.onRoomList) gameService.onRoomList(data.rooms);
        } else if (data.type === 'authResult') {
            if (gameService.onAuthResult) gameService.onAuthResult(data);
        } else if (data.type === 'accountData') {
            if (data.account) {
                this.setState({account: data.account});
                localStorage.setItem('memeopoly_account', JSON.stringify(data.account));
            }
        } else if (data.type === 'leaderboard') {
            gameService.leaderboardData = data;
            this.forceUpdate();
        } else if (data.type === 'vaultState') {
            if (gameService.onVaultState) gameService.onVaultState(data.vault);
        } else if (data.type === 'tokenBalance') {
            if (gameService.onTokenBalance) gameService.onTokenBalance(data);
        } else if (data.type === 'game') {
            const game = data.game;
            gameService.game = game;
            this.setState({game: game});
        } else if (data.type === 'log') {
            this.setState({logs: data.message});
        } else if (data.type === 'chat') {
            this.setState({chat: data.message});
        } else if (data.type === 'cardDrawn') {
            this.setState({
                cardToShow: {
                    card: data.card,
                    player: data.player,
                    type: data.cardType,
                }
            });
            this.addNotification(`${data.player.name} drew a ${data.cardType} card`, 'info', 'Card Drawn');
        } else if (data.type === 'cpoly') {
            this.setState({cpolyBalances: data.balances || {}, referralData: data.referrals || {}});
            const myId = gameService.currentPlayer;
            if (myId && data.balances && data.balances[myId] !== undefined) {
                const prev = this.state.cpolyBalances[myId] || 0;
                const now = data.balances[myId];
                if (now > prev) {
                    this.addNotification('+' + (now - prev) + ' $MEMO earned!', 'reward', 'Token Reward');
                }
            }
        } else if (data.type === 'xpUpdate') {
            this.setState({xpData: data.players || {}});
        } else if (data.type === 'levelUp') {
            if (data.playerId === gameService.currentPlayer) {
                this.addNotification('LEVEL UP! You are now Level ' + data.level + ' - ' + data.stage.name, 'reward', 'Level Up!');
                this.setState({levelUpAlert: data});
                setTimeout(() => this.setState({levelUpAlert: null}), 4000);
            }
        } else if (data.type === 'autopilotChanged') {
            if (data.playerId === gameService.currentPlayer) {
                this.setState({autopilot: data.autopilot});
                this.addNotification(
                    data.autopilot ? 'Auto-pilot ON - AI is playing for you' : 'Auto-pilot OFF - you are back in control',
                    data.autopilot ? 'warning' : 'info',
                    'Auto-Pilot'
                );
            }
        } else if (data.type === 'yourTurn') {
            if (data.playerId === gameService.currentPlayer) {
                soundManager.init();
                soundManager.play('fanfare');
                this.addNotification('YOUR TURN! Click dice to roll', 'turn', 'Your Turn');
            }
        } else if (data.type === 'buyOffer') {
            soundManager.play('click');
            if (data.playerId === gameService.currentPlayer) {
                // Start 15s countdown
                let remaining = 15;
                const timer = setInterval(() => {
                    remaining--;
                    if (remaining <= 0) {
                        clearInterval(timer);
                        this.setState({buyOffer: null, buyOfferTimer: null});
                    } else {
                        this.setState(prev => {
                            if (!prev.buyOffer) { clearInterval(timer); return null; }
                            return {buyOffer: {...prev.buyOffer, remaining}};
                        });
                    }
                }, 1000);
                this.setState({
                    buyOffer: {property: data.property, price: data.price, remaining},
                    buyOfferTimer: timer
                });
            } else {
                const buyerPlayer = this.state.game ? this.state.game.players.find(p => p.id === data.playerId) : null;
                const buyerName = buyerPlayer ? buyerPlayer.name : 'A player';
                this.addNotification(buyerName + ' landed on ' + data.property, 'info');
            }
        } else if (data.type === 'buyOfferExpired') {
            if (this.state.buyOfferTimer) clearInterval(this.state.buyOfferTimer);
            this.setState({buyOffer: null, buyOfferTimer: null});
        } else if (data.type === 'propertyBought') {
            soundManager.play('buy');
            this.addNotification(data.playerName + ' bought ' + data.property + ' for $' + data.price, 'info', 'Property Sold');
        } else if (data.type === 'rentPaid') {
            if (data.fromPlayer === gameService.currentPlayer) {
                soundManager.play('rent');
                this.addNotification('Paid $' + data.amount + ' rent to ' + data.toName + ' for ' + data.property, 'warning', 'Rent Paid');
            } else if (data.toPlayer === gameService.currentPlayer) {
                soundManager.play('coin');
                this.addNotification('Received $' + data.amount + ' rent from ' + data.fromName + ' for ' + data.property, 'reward', 'Rent Received');
            }
        } else if (data.type === 'taxPaid') {
            if (data.playerId === gameService.currentPlayer) {
                soundManager.play('rent');
                this.addNotification('Paid $' + data.amount + ' ' + data.taxType, 'warning', 'Tax');
            }
        } else if (data.type === 'playerMoved') {
            if (data.passedGo) {
                soundManager.play('go');
            }
            if (this.boardRef) {
                this.boardRef.clearDragOverride(data.playerId);
                if (data.from != null && data.to != null) {
                    this.boardRef.animateMove(data.playerId, data.from, data.to);
                }
            }
        } else if (data.type === 'jailed') {
            soundManager.play('jail');
            if (data.playerId === gameService.currentPlayer) {
                this.setState({showJailedOverlay: true});
                setTimeout(() => this.setState({showJailedOverlay: false}), 3000);
            } else {
                this.addNotification(data.playerName + ' got sent to jail!', 'warning', 'Jailed');
            }
        } else if (data.type === 'auctionStart') {
            let remaining = 10;
            const timer = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(timer);
                    this.setState({auction: null, auctionTimer: null});
                } else {
                    this.setState(prev => {
                        if (!prev.auction) { clearInterval(timer); return null; }
                        return {auction: {...prev.auction, remaining}};
                    });
                }
            }, 1000);
            this.setState({
                auction: {
                    property: data.property,
                    price: data.price,
                    currentBid: 0,
                    currentBidder: null,
                    currentBidderName: null,
                    remaining
                },
                auctionTimer: timer
            });
            this.addNotification('AUCTION: ' + data.property + ' is up for auction!', 'warning', 'Auction');
        } else if (data.type === 'auctionBid') {
            if (this.state.auctionTimer) clearInterval(this.state.auctionTimer);
            let remaining = data.timeRemaining || 10;
            const timer = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(timer);
                    this.setState({auction: null, auctionTimer: null});
                } else {
                    this.setState(prev => {
                        if (!prev.auction) { clearInterval(timer); return null; }
                        return {auction: {...prev.auction, remaining}};
                    });
                }
            }, 1000);
            this.setState(prev => ({
                auction: prev.auction ? {
                    ...prev.auction,
                    currentBid: data.amount,
                    currentBidder: data.playerId,
                    currentBidderName: data.playerName,
                    remaining
                } : null,
                auctionTimer: timer
            }));
            this.addNotification(data.playerName + ' bid $' + data.amount, 'info', 'Auction Bid');
        } else if (data.type === 'auctionEnd') {
            if (this.state.auctionTimer) clearInterval(this.state.auctionTimer);
            this.setState({auction: null, auctionTimer: null});
            if (data.winnerId) {
                this.addNotification(data.winnerName + ' won ' + data.property + ' for $' + data.amount, 'reward', 'Auction Won');
            } else {
                this.addNotification('No bids for ' + data.property, 'info', 'Auction Over');
            }
        } else if (data.type === 'turnTimer') {
            if (this.turnTimerInterval) clearInterval(this.turnTimerInterval);
            let remaining = data.seconds;
            this.setState({turnTimer: remaining, turnTimerPlayer: data.playerId});
            this.turnTimerInterval = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(this.turnTimerInterval);
                    this.setState({turnTimer: null, turnTimerPlayer: null});
                } else {
                    this.setState({turnTimer: remaining});
                }
            }, 1000);
        } else if (data.type === 'tradeOffer') {
            if (data.toPlayerId === gameService.currentPlayer) {
                soundManager.play('click');
                this.setState({incomingTrade: data});
            } else if (data.fromId === gameService.currentPlayer) {
                this.addNotification('Trade sent to ' + data.toName, 'info', 'Trade');
            }
        } else if (data.type === 'tradeComplete') {
            soundManager.play('buy');
            this.setState({incomingTrade: null, showTradeUI: false});
            this.addNotification(data.fromName + ' and ' + data.toName + ' made a deal!', 'reward', 'Trade');
        } else if (data.type === 'tradeDeclined') {
            this.setState({incomingTrade: null});
            this.addNotification(data.playerName + ' declined the trade', 'warning', 'Trade');
        } else if (data.type === 'tradeExpired') {
            this.setState({incomingTrade: null});
            this.addNotification('Trade expired', 'info', 'Trade');
        } else if (data.type === 'bankrupt') {
            soundManager.play('jail');
            this.addNotification(data.playerName + ' went BANKRUPT!', 'warning', 'Bankrupt');
        } else if (data.type === 'gameOver') {
            soundManager.play('fanfare');
            this.setState({winner: {id: data.winnerId, name: data.winnerName}});
        } else if (data.type === 'newGame') {
            gameService.currentPlayer = null;
            this.setState({winner: null});
        } else {
            rtcService.gotMessageFromServer(message);
        }
    }

    toggleAutopilot = () => {
        const newState = !this.state.autopilot;
        gameService.sendToWs('setAutopilot', {enabled: newState});
        this.setState({autopilot: newState});
    }

    showHelp = () => this.setState({showHelp: true});
    hideHelp = () => this.setState({showHelp: false, showTutorial: !localStorage.getItem('memeopoly_tutorial_done')});
    closeTutorial = () => this.setState({showTutorial: false});

    leaveRoom = () => {
        gameService.leaveRoom();
        this.setState({inRoom: false, roomId: null, game: null, logs: [], chat: [], view: 'lobby'});
    }

    handleBuyAccept = () => {
        if (this.state.buyOfferTimer) clearInterval(this.state.buyOfferTimer);
        this.setState({buyOffer: null, buyOfferTimer: null});
        gameService.buyProperty();
    }

    handleBuyDecline = () => {
        if (this.state.buyOfferTimer) clearInterval(this.state.buyOfferTimer);
        this.setState({buyOffer: null, buyOfferTimer: null});
        gameService.declineProperty();
    }

    addNotification = (message, type = 'info', title = null) => {
        const notification = {message, type, title};
        this.setState(prev => ({notifications: [...prev.notifications, notification]}));
        setTimeout(() => {
            this.setState(prev => ({notifications: prev.notifications.filter(n => n !== notification)}));
        }, 4000);
    }

    getPlayerName = () => {
        if (!gameService.currentPlayer || !this.state.game) return null;
        const p = this.state.game.players.find(p => p.id === gameService.currentPlayer);
        return p ? p.name : null;
    }

    copyRoomLink = () => {
        const url = window.location.origin + '/share/room/' + this.state.roomId;
        navigator.clipboard.writeText(url).catch(() => {});
        this.addNotification('Room link copied!', 'info');
    }

    refreshAccount = () => {
        if (this.state.account && this.state.account.id && gameService.ws && gameService.ws.readyState === 1) {
            gameService.ws.send(JSON.stringify({type: 'wsGetAccount', userId: this.state.account.id}));
        }
    }

    renderTurnBanner = () => {
        const game = this.state.game;
        if (!game || !game.currentTurn || !gameService.currentPlayer) return null;
        const currentPlayer = game.players.find(p => p.id === game.currentTurn);
        if (!currentPlayer || currentPlayer.id === 1) return null;
        const isMyTurn = game.currentTurn === gameService.currentPlayer;
        const phase = game.turnPhase;

        let actionText = '';
        let actionClass = '';
        if (currentPlayer.bankrupt) {
            actionText = 'ELIMINATED';
            actionClass = 'bankrupt';
        } else if (phase === 'pre-roll') {
            actionText = isMyTurn ? 'YOUR TURN - BUILD OR ROLL!' : 'Deciding...';
            actionClass = isMyTurn ? 'action-needed' : '';
        } else if (phase === 'rolling') {
            // 'rolling' does NOT mean the dice are moving -- it means the server
            // is WAITING for this player to roll. Labelling it "Rolling..." made
            // the game look frozen. 'moving' is the real animation phase.
            actionText = isMyTurn ? 'CLICK THE DICE TO ROLL' : 'Waiting to roll...';
            actionClass = isMyTurn ? 'action-needed' : '';
        } else if (phase === 'moving') {
            actionText = 'Rolling...';
            actionClass = 'rolling';
        } else if (phase === 'action') {
            actionText = isMyTurn ? 'CHOOSE AN ACTION' : 'Choosing...';
            actionClass = isMyTurn ? 'action-needed' : '';
        } else if (phase === 'done') {
            actionText = 'Turn ending...';
        } else {
            actionText = phase || '';
        }

        if (this.state.buyOffer && isMyTurn) {
            actionText = 'BUY OR PASS?';
            actionClass = 'action-needed';
        }
        if (this.state.auction) {
            actionText = 'AUCTION IN PROGRESS';
            actionClass = 'auction';
        }

        return (
            <div className={"turn-banner" + (isMyTurn ? " my-turn" : "") + (actionClass ? " " + actionClass : "")}>
                <div className="turn-banner-inner">
                    <div className="turn-banner-token">
                        <span className="turn-token-dot" style={{background: currentPlayer.tokenColor || '#00e5ff'}}></span>
                    </div>
                    <div className="turn-banner-info">
                        <span className="turn-banner-name">{isMyTurn ? 'YOUR TURN' : currentPlayer.name + "'s turn"}</span>
                        <span className="turn-banner-action">{actionText}</span>
                    </div>
                    {isMyTurn && phase === 'pre-roll' && (
                        <button className="turn-banner-roll-btn" onClick={() => gameService.readyToRoll()}>
                            ROLL DICE
                        </button>
                    )}
                    {this.state.turnTimer > 0 && (
                        <span className={"turn-banner-timer" + (this.state.turnTimer <= 10 ? " urgent" : "")}>{this.state.turnTimer}s</span>
                    )}
                </div>
            </div>
        );
    }

    render() {
        const {view, account, connected, lostConnection} = this.state;

        // --- SKULL: Landing page ---
        if (view === 'landing') {
            return (<div>
                <Notifications notifications={this.state.notifications}/>
                <LandingPage onAuth={this.handleAuth} onSkip={this.handleGuestPlay} />
            </div>);
        }

        if (view === 'connecting' || !connected) {
            return (<div className="game-loading">
                {lostConnection && <span>Lost connection to server, reconnecting...</span>}
                {!lostConnection && <span>Connecting...</span>}
            </div>);
        }

        // --- SPINE: Top nav bar (always shown when logged in) ---
        const topNav = (
            <div className="top-nav">
                <span className="nav-brand" onClick={() => this.setState({view: 'lobby', inRoom: false})}>Memeopoly</span>
                {account && <div className="nav-user">
                    <span className="nav-level">Lv.{account.level}</span>
                    <span className="nav-cpoly">{account.cpolyBalance} $MEMO</span>
                    <button className="nav-btn" onClick={() => { this.refreshAccount(); this.setState({showProfile: !this.state.showProfile, showLeaderboard: false}); }}>
                        <i className="fas fa-user"></i>
                    </button>
                    <button className="nav-btn" onClick={() => this.setState({showLeaderboard: !this.state.showLeaderboard, showProfile: false, showVault: false})}>
                        <i className="fas fa-trophy"></i>
                    </button>
                    <button className="nav-btn" onClick={() => this.setState({showVault: !this.state.showVault, showProfile: false, showLeaderboard: false})}>
                        <i className="fas fa-coins"></i>
                    </button>
                    <button className="nav-btn nav-logout" onClick={this.handleLogout}>
                        <i className="fas fa-sign-out-alt"></i>
                    </button>
                </div>}
                {!account && <button className="nav-btn" onClick={() => this.setState({view: 'landing'})}>Login</button>}
            </div>
        );

        // Slide-out panels
        const panels = (
            <div>
                {this.state.showProfile && account && <div className="slide-panel">
                    <button className="slide-close" onClick={() => this.setState({showProfile: false})}><i className="fas fa-times"></i></button>
                    <ProfileView account={account} />
                </div>}
                {this.state.showLeaderboard && <div className="slide-panel">
                    <button className="slide-close" onClick={() => this.setState({showLeaderboard: false})}><i className="fas fa-times"></i></button>
                    <Leaderboard />
                </div>}
                {this.state.showVault && <div className="slide-panel">
                    <button className="slide-close" onClick={() => this.setState({showVault: false})}><i className="fas fa-times"></i></button>
                    <VaultPanel accountId={account ? account.id : null} />
                </div>}
            </div>
        );

        // --- Room lobby ---
        if (view === 'lobby' || !this.state.inRoom) {
            return (<div>
                {topNav}
                {panels}
                <Notifications notifications={this.state.notifications}/>
                <RoomLobby />
            </div>);
        }

        // --- Game view ---
        if (this.state.game) {
            const showPlayerDialog = gameService.currentPlayer === null && !this.state.showHelp;
            const card = this.state.cardToShow;
            return (<div>
                {topNav}
                {panels}
                <ReferralPanel
                    playerName={this.getPlayerName()}
                    onNotify={this.addNotification}
                    cpolyBalance={this.state.cpolyBalances[gameService.currentPlayer] || 0}
                    referralData={this.state.referralData[gameService.currentPlayer] || {count: 0, earnings: 0}}
                />
                <WalletConnect onNotify={this.addNotification}/>
                <Notifications notifications={this.state.notifications}/>
                {/* Mobile top toolbar - simplified */}
                <div className="game-toolbar">
                    <button className="gt-leave" onClick={this.leaveRoom}>Leave</button>
                    <span className="gt-room">{this.state.roomId}</span>
                    {this.state.turnTimer > 0 && <span className={"gt-timer" + (this.state.turnTimer <= 10 ? " urgent" : "")}>{this.state.turnTimer}s</span>}
                    <div className="gt-spacer"></div>
                    <button className="gt-share" onClick={this.copyRoomLink}><i className="fas fa-share-alt"></i></button>
                    <div className="npc-menu-wrapper">
                        <button className="npc-add-btn" onClick={() => this.setState({showNPCMenu: !this.state.showNPCMenu})}>+NPC</button>
                        {this.state.showNPCMenu && <div className="npc-dropdown">
                            <button onClick={() => { gameService.addNPC('easy'); this.setState({showNPCMenu: false}); }}>Easy</button>
                            <button onClick={() => { gameService.addNPC('medium'); this.setState({showNPCMenu: false}); }}>Medium</button>
                            <button onClick={() => { gameService.addNPC('hard'); this.setState({showNPCMenu: false}); }}>Hard</button>
                        </div>}
                    </div>
                    <button className="gt-settings-btn" onClick={() => this.setState({showSettingsPanel: !this.state.showSettingsPanel})}>
                        <i className="fas fa-cog"></i>
                    </button>
                </div>
                {/* Settings dropdown panel */}
                {this.state.showSettingsPanel && <div className="settings-dropdown">
                    <label className="settings-row">
                        <span>Dice Skin</span>
                        <select value={this.state.diceSkin} onChange={e => {
                            localStorage.setItem('memeopoly_dice_skin', e.target.value);
                            this.setState({diceSkin: e.target.value});
                        }}>
                            <option value="neon">Neon</option>
                            <option value="classic">Classic</option>
                            <option value="fire">Fire</option>
                            <option value="gold">Gold</option>
                            <option value="phantom">Phantom</option>
                        </select>
                    </label>
                    <button className="settings-row-btn" onClick={this.showHelp}>How to Play</button>
                </div>}
                <Settings game={this.state.game} logs={this.state.logs} chat={this.state.chat}
                          showHelp={this.showHelp}/>
                {/* Status bar */}
                {(() => {
                    const myId = gameService.currentPlayer;
                    const myPlayer = this.state.game && myId
                        ? this.state.game.players.find(p => p.id === myId)
                        : null;
                    const myXP = this.state.xpData[myId] || {xp: 0, level: 1, stage: {name: 'Meme Street'}, nextLevelXP: 100};
                    const balance = myPlayer ? this.state.cpolyBalances[myId] || 0 : 0;
                    return <div className="mobile-status-bar">
                        <div className="msb-left">
                            <span className="msb-level">Lv.{myXP.level}</span>
                            <span className="msb-xp">&#9733; {myXP.xp}</span>
                        </div>
                        <div className="msb-center">
                            <span className="msb-stage">{myXP.stage.name}</span>
                        </div>
                        <div className="msb-right">
                            <span className="msb-balance">{balance} $MEMO</span>
                        </div>
                    </div>;
                })()}
                {this.renderTurnBanner()}
                <div className="game">
                    <img src="./mascot.png" alt="" className="game-mascot mascot-left" onError={(e) => {e.target.style.display='none'}} />
                    <Board game={this.state.game} diceSkin={this.state.diceSkin} ref={ref => this.boardRef = ref}/>
                    <img src="./mascot.png" alt="" className="game-mascot mascot-right" onError={(e) => {e.target.style.display='none'}} />
                    {/* Desktop sidebar - hidden on mobile, replaced by slide-up panel */}
                    <div className="game-sidebar">
                        <Players game={this.state.game}/>
                        <div className="sidebar-section sidebar-logs">
                            <div className="sidebar-tabs">
                                <button className={"stab" + (this.state.sidebarTab === 'logs' ? " active" : "")} onClick={() => this.setState({sidebarTab: 'logs'})}>Logs</button>
                                <button className={"stab" + (this.state.sidebarTab === 'chat' ? " active" : "")} onClick={() => this.setState({sidebarTab: 'chat'})}>Chat</button>
                                <button className={"stab" + (this.state.sidebarTab === 'props' ? " active" : "")} onClick={() => this.setState({sidebarTab: 'props'})}>Props</button>
                            </div>
                            {this.state.sidebarTab === 'logs' ? (
                                <div className="sidebar-log-content" id="log-box">
                                    {this.state.logs.map((l, i) => <p key={i}>{l}</p>)}
                                </div>
                            ) : this.state.sidebarTab === 'props' ? (
                                <div className="sidebar-props-content">
                                    {this.state.game && gameService.currentPlayer && (() => {
                                        const myId = gameService.currentPlayer;
                                        const game = this.state.game;
                                        const myDeeds = game.deeds.regular.filter(d => d.owner === myId);
                                        const myRailroads = (game.deeds.trainStations || []).filter(d => d.owner === myId);
                                        const myUtilities = (game.deeds.utilities || []).filter(d => d.owner === myId);
                                        const isPreRoll = game.currentTurn === myId && game.turnPhase === 'pre-roll';
                                        if (myDeeds.length === 0 && myRailroads.length === 0 && myUtilities.length === 0) {
                                            return <div className="props-empty">No properties yet</div>;
                                        }
                                        return <div className="props-list">
                                            {myDeeds.map(d => {
                                                const canBuild = gameService.canBuyHouse(d, game);
                                                return <div key={d.title} className="prop-row" style={{borderLeft: '4px solid ' + d.color}}>
                                                    <span className="prop-name">{d.title}</span>
                                                    <span className="prop-houses">
                                                        {d.hotel > 0 ? 'H' : d.houses > 0 ? d.houses + 'h' : ''}
                                                    </span>
                                                    {canBuild && d.houses < 4 && d.hotel === 0 && (
                                                        <button className="prop-build-btn" onClick={() => gameService.addHouse(d.title)}>+H</button>
                                                    )}
                                                    {canBuild && d.houses === 4 && d.hotel === 0 && (
                                                        <button className="prop-build-btn hotel" onClick={() => gameService.addHotel(d.title)}>+Hotel</button>
                                                    )}
                                                </div>;
                                            })}
                                            {myRailroads.map(d => <div key={d.title} className="prop-row" style={{borderLeft: '4px solid #666'}}>
                                                <span className="prop-name">{d.title}</span>
                                            </div>)}
                                            {myUtilities.map(d => <div key={d.title} className="prop-row" style={{borderLeft: '4px solid #888'}}>
                                                <span className="prop-name">{d.title}</span>
                                            </div>)}
                                        </div>;
                                    })()}
                                    {this.state.game && gameService.currentPlayer && (
                                        <button className="trade-open-btn" onClick={() => this.setState({showTradeUI: true})}>
                                            Propose Trade
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="sidebar-chat-content">
                                    <div className="sidebar-chat-msgs" id="chat-box">
                                        {this.state.chat.map((l, i) => <p key={i}>{l}</p>)}
                                    </div>
                                    <div className="sidebar-chat-input">
                                        <input type="text" placeholder="Type..." onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value) { gameService.sendToWs('chat', {message: e.target.value}); e.target.value = ''; }}}/>
                                        <button onClick={(e) => { const inp = e.target.parentElement.querySelector('input'); if (inp.value) { gameService.sendToWs('chat', {message: inp.value}); inp.value = ''; }}}>Send</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Mobile slide-up panel */}
                {this.state.mobilePanel && <div className="mobile-slideup-overlay" onClick={() => this.setState({mobilePanel: null})}>
                    <div className="mobile-slideup" onClick={e => e.stopPropagation()}>
                        <div className="slideup-handle"></div>
                        <div className="slideup-header">
                            <span className="slideup-title">
                                {this.state.mobilePanel === 'wins' && 'Wins'}
                                {this.state.mobilePanel === 'build' && 'Build & Manage'}
                                {this.state.mobilePanel === 'album' && 'Game Log'}
                                {this.state.mobilePanel === 'friends' && 'Players & Chat'}
                            </span>
                            <button className="slideup-close" onClick={() => this.setState({mobilePanel: null})}>&#x2715;</button>
                        </div>
                        <div className="slideup-body">
                            {this.state.mobilePanel === 'wins' && <div className="slideup-wins">
                                <Players game={this.state.game}/>
                            </div>}
                            {this.state.mobilePanel === 'build' && <div className="slideup-build">
                                <div className="sidebar-props-content">
                                    {this.state.game && gameService.currentPlayer && (() => {
                                        const myId = gameService.currentPlayer;
                                        const game = this.state.game;
                                        const myDeeds = game.deeds.regular.filter(d => d.owner === myId);
                                        const myRailroads = (game.deeds.trainStations || []).filter(d => d.owner === myId);
                                        const myUtilities = (game.deeds.utilities || []).filter(d => d.owner === myId);
                                        if (myDeeds.length === 0 && myRailroads.length === 0 && myUtilities.length === 0) {
                                            return <div className="props-empty">No properties yet</div>;
                                        }
                                        return <div className="props-list">
                                            {myDeeds.map(d => {
                                                const canBuild = gameService.canBuyHouse(d, game);
                                                return <div key={d.title} className="prop-row" style={{borderLeft: '4px solid ' + d.color}}>
                                                    <span className="prop-name">{d.title}</span>
                                                    <span className="prop-houses">
                                                        {d.hotel > 0 ? 'H' : d.houses > 0 ? d.houses + 'h' : ''}
                                                    </span>
                                                    {canBuild && d.houses < 4 && d.hotel === 0 && (
                                                        <button className="prop-build-btn" onClick={() => gameService.addHouse(d.title)}>+H</button>
                                                    )}
                                                    {canBuild && d.houses === 4 && d.hotel === 0 && (
                                                        <button className="prop-build-btn hotel" onClick={() => gameService.addHotel(d.title)}>+Hotel</button>
                                                    )}
                                                </div>;
                                            })}
                                            {myRailroads.map(d => <div key={d.title} className="prop-row" style={{borderLeft: '4px solid #666'}}>
                                                <span className="prop-name">{d.title}</span>
                                            </div>)}
                                            {myUtilities.map(d => <div key={d.title} className="prop-row" style={{borderLeft: '4px solid #888'}}>
                                                <span className="prop-name">{d.title}</span>
                                            </div>)}
                                        </div>;
                                    })()}
                                    {this.state.game && gameService.currentPlayer && (
                                        <button className="trade-open-btn" onClick={() => this.setState({showTradeUI: true, mobilePanel: null})}>
                                            Propose Trade
                                        </button>
                                    )}
                                </div>
                            </div>}
                            {this.state.mobilePanel === 'album' && <div className="slideup-album">
                                <div className="sidebar-log-content" id="log-box-mobile">
                                    {this.state.logs.map((l, i) => <p key={i}>{l}</p>)}
                                </div>
                            </div>}
                            {this.state.mobilePanel === 'friends' && <div className="slideup-friends">
                                <div className="sidebar-chat-content">
                                    <div className="sidebar-chat-msgs" id="chat-box-mobile">
                                        {this.state.chat.map((l, i) => <p key={i}>{l}</p>)}
                                    </div>
                                    <div className="sidebar-chat-input">
                                        <input type="text" placeholder="Type..." onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value) { gameService.sendToWs('chat', {message: e.target.value}); e.target.value = ''; }}}/>
                                        <button onClick={(e) => { const inp = e.target.parentElement.querySelector('input'); if (inp.value) { gameService.sendToWs('chat', {message: inp.value}); inp.value = ''; }}}>Send</button>
                                    </div>
                                </div>
                            </div>}
                        </div>
                    </div>
                </div>}
                {/* Bottom Navigation Bar */}
                {(() => {
                    const game = this.state.game;
                    const isMyTurn = game && game.currentTurn === gameService.currentPlayer;
                    const isPreRoll = isMyTurn && game.turnPhase === 'pre-roll';
                    return <div className="mobile-bottom-nav">
                        <button className={"mbn-btn" + (this.state.mobilePanel === 'wins' ? " active" : "")}
                            onClick={() => this.setState({mobilePanel: this.state.mobilePanel === 'wins' ? null : 'wins'})}>
                            <span className="mbn-icon">&#x1F3C6;</span>
                            <span className="mbn-label">WINS</span>
                        </button>
                        <button className={"mbn-btn" + (this.state.mobilePanel === 'build' ? " active" : "")}
                            onClick={() => this.setState({mobilePanel: this.state.mobilePanel === 'build' ? null : 'build'})}>
                            <span className="mbn-icon">&#x1F527;</span>
                            <span className="mbn-label">BUILD</span>
                        </button>
                        <div className="mbn-go-wrapper">
                            <button className={"mbn-go-btn" + (isPreRoll ? " can-roll" : "") + (isMyTurn && game.turnPhase === 'rolling' ? " rolling" : "")}
                                disabled={!isPreRoll}
                                onClick={() => { if (isPreRoll) gameService.readyToRoll(); }}>
                                <span className="mbn-go-text">GO</span>
                                <span className="mbn-go-multi">x5</span>
                            </button>
                            {(() => {
                                const myId = gameService.currentPlayer;
                                const myXP = this.state.xpData[myId] || {xp: 0, level: 1, nextLevelXP: 100};
                                const pct = myXP.nextLevelXP > 0 ? Math.min(100, Math.floor((myXP.xp / myXP.nextLevelXP) * 100)) : 0;
                                return <div className="mbn-roll-info">
                                    <div className="mbn-roll-bar">
                                        <div className="mbn-roll-fill" style={{width: pct + '%'}}></div>
                                    </div>
                                    <span className="mbn-roll-text">Lv.{myXP.level} -- {myXP.xp}/{myXP.nextLevelXP} XP</span>
                                </div>;
                            })()}
                            <button className={"mbn-autopilot-btn" + (this.state.autopilot ? " active" : "")}
                                onClick={this.toggleAutopilot}
                                title={this.state.autopilot ? "Auto-pilot ON (click to disable)" : "Enable auto-pilot (AI plays for you)"}>
                                <span className="mbn-autopilot-icon">{this.state.autopilot ? '\u{1F916}' : '\u{1F3AE}'}</span>
                                <span className="mbn-autopilot-label">{this.state.autopilot ? 'AUTO' : 'AFK'}</span>
                            </button>
                        </div>
                        <button className={"mbn-btn" + (this.state.mobilePanel === 'album' ? " active" : "")}
                            onClick={() => this.setState({mobilePanel: this.state.mobilePanel === 'album' ? null : 'album'})}>
                            <span className="mbn-icon">&#x1F4D6;</span>
                            <span className="mbn-label">ALBUM</span>
                        </button>
                        <button className={"mbn-btn" + (this.state.mobilePanel === 'friends' ? " active" : "")}
                            onClick={() => this.setState({mobilePanel: this.state.mobilePanel === 'friends' ? null : 'friends'})}>
                            <span className="mbn-icon">&#x1F465;</span>
                            <span className="mbn-label">FRIENDS</span>
                        </button>
                    </div>;
                })()}
                {this.state.showHelp && <HelpDialog dismiss={this.hideHelp}/>}
                {!this.state.showHelp && this.state.showTutorial && <Tutorial onClose={this.closeTutorial}/>}
                {showPlayerDialog && !this.state.showTutorial && <SelectPlayerDialog game={this.state.game}/>}
                {card && <div className="card-overlay">
                    <div className={"card-picked " + card.type}>
                        {<a className="close" onClick={(e) => {
                            this.setState({cardToShow: null});
                        }}><FontAwesomeIcon icon={faTimesCircle}/></a>}
                        <span className="card-type">{card.type}</span>
                        <span className="card-text">{card.card}</span>
                        <span className="card-player">TO: {card.player.name}</span>
                    </div>
                </div>}
                {this.state.buyOffer && <div className="card-overlay">
                    <div className="buy-offer-modal">
                        <h3>Property Available!</h3>
                        <p className="buy-offer-property">{this.state.buyOffer.property}</p>
                        <p className="buy-offer-price">${this.state.buyOffer.price}</p>
                        <p className="buy-offer-timer">{this.state.buyOffer.remaining}s remaining</p>
                        <div className="buy-offer-buttons">
                            <button className="buy-btn" onClick={this.handleBuyAccept}>Buy</button>
                            <button className="decline-btn" onClick={this.handleBuyDecline}>Decline</button>
                        </div>
                    </div>
                </div>}
                {this.state.auction && <div className="card-overlay">
                    <div className="auction-modal">
                        <h3>AUCTION</h3>
                        <p className="auction-property">{this.state.auction.property}</p>
                        <p className="auction-list-price">List price: ${this.state.auction.price}</p>
                        {this.state.auction.currentBid > 0 ? (
                            <p className="auction-current-bid">
                                Current bid: ${this.state.auction.currentBid} by {this.state.auction.currentBidderName}
                            </p>
                        ) : (
                            <p className="auction-current-bid">No bids yet</p>
                        )}
                        <p className="auction-timer">{this.state.auction.remaining}s remaining</p>
                        <div className="auction-bid-buttons">
                            <button className="bid-btn" onClick={() => gameService.placeBid((this.state.auction.currentBid || 0) + 10)}>
                                +$10
                            </button>
                            <button className="bid-btn" onClick={() => gameService.placeBid((this.state.auction.currentBid || 0) + 50)}>
                                +$50
                            </button>
                            <button className="bid-btn" onClick={() => gameService.placeBid((this.state.auction.currentBid || 0) + 100)}>
                                +$100
                            </button>
                        </div>
                    </div>
                </div>}
                {this.state.showJailedOverlay && <div className="card-overlay">
                    <div className="jailed-overlay">
                        <h2>RUGGED!</h2>
                        <p>Go to Jail!</p>
                    </div>
                </div>}
                {this.state.levelUpAlert && <div className="card-overlay level-up-overlay">
                    <div className="level-up-modal">
                        <div className="level-up-star">&#9733;</div>
                        <h2>LEVEL UP!</h2>
                        <p className="level-up-num">Level {this.state.levelUpAlert.level}</p>
                        <p className="level-up-stage">{this.state.levelUpAlert.stage.name}</p>
                        <p className="level-up-desc">{this.state.levelUpAlert.stage.desc}</p>
                    </div>
                </div>}
                {this.state.winner && <div className="card-overlay winner-overlay">
                    <div className="winner-modal">
                        <div className="winner-crown">&#x1F451;</div>
                        <h2>GAME OVER</h2>
                        <p className="winner-name">{this.state.winner.name}</p>
                        <p className="winner-subtitle">MEME LORD SUPREME</p>
                        <button className="winner-btn" onClick={() => this.setState({winner: null})}>GG</button>
                    </div>
                </div>}
                {this.state.showTradeUI && this.state.game && <TradeModal
                    game={this.state.game}
                    onClose={() => this.setState({showTradeUI: false})}
                    onSubmit={(trade) => {
                        gameService.proposeTrade(trade.toPlayerId, trade.offerProperties, trade.wantProperties, trade.offerMoney, trade.wantMoney);
                        this.setState({showTradeUI: false});
                    }}
                />}
                {this.state.incomingTrade && <div className="card-overlay">
                    <div className="trade-incoming-modal">
                        <h3>TRADE OFFER</h3>
                        <p className="trade-from">{this.state.incomingTrade.fromName} wants to trade:</p>
                        <div className="trade-columns">
                            <div className="trade-col">
                                <h4>They offer:</h4>
                                {this.state.incomingTrade.offerProperties.map(p => <div key={p} className="trade-item">{p}</div>)}
                                {this.state.incomingTrade.offerMoney > 0 && <div className="trade-item money">${this.state.incomingTrade.offerMoney}</div>}
                                {this.state.incomingTrade.offerProperties.length === 0 && !this.state.incomingTrade.offerMoney && <div className="trade-item empty">Nothing</div>}
                            </div>
                            <div className="trade-arrow">&#x21C4;</div>
                            <div className="trade-col">
                                <h4>They want:</h4>
                                {this.state.incomingTrade.wantProperties.map(p => <div key={p} className="trade-item">{p}</div>)}
                                {this.state.incomingTrade.wantMoney > 0 && <div className="trade-item money">${this.state.incomingTrade.wantMoney}</div>}
                                {this.state.incomingTrade.wantProperties.length === 0 && !this.state.incomingTrade.wantMoney && <div className="trade-item empty">Nothing</div>}
                            </div>
                        </div>
                        <div className="trade-buttons">
                            <button className="buy-btn" onClick={() => { gameService.acceptTrade(); this.setState({incomingTrade: null}); }}>Accept</button>
                            <button className="decline-btn" onClick={() => { gameService.declineTrade(); this.setState({incomingTrade: null}); }}>Decline</button>
                        </div>
                    </div>
                </div>}
            </div>);
        } else {
            return (<div className="game-loading">
                {topNav}
                <span>Loading game...</span>
            </div>);
        }
    }

}

class TradeModal extends React.Component {
    constructor(props) {
        super(props);
        const myId = gameService.currentPlayer;
        const game = props.game;
        const otherPlayers = game.players.filter(p => p.id !== myId && p.id !== 1 && !p.bankrupt);
        this.state = {
            toPlayerId: otherPlayers.length > 0 ? otherPlayers[0].id : null,
            offerSelected: {},
            wantSelected: {},
            offerMoney: 0,
            wantMoney: 0
        };
    }

    getAllDeeds = (ownerId) => {
        const game = this.props.game;
        // Server sends deeds as {regular, trainStations, utilities}.
        // These were previously read as `railroad` / `utility`, which are
        // undefined -- calling .filter() on them threw and unmounted the app.
        const deeds = (game && game.deeds) || {};
        const owned = (list) => (list || []).filter(d => d.owner === ownerId);
        return [
            ...owned(deeds.regular),
            ...owned(deeds.trainStations),
            ...owned(deeds.utilities)
        ];
    }

    toggleOffer = (title) => {
        this.setState(prev => ({offerSelected: {...prev.offerSelected, [title]: !prev.offerSelected[title]}}));
    }

    toggleWant = (title) => {
        this.setState(prev => ({wantSelected: {...prev.wantSelected, [title]: !prev.wantSelected[title]}}));
    }

    submit = () => {
        const offerProperties = Object.keys(this.state.offerSelected).filter(k => this.state.offerSelected[k]);
        const wantProperties = Object.keys(this.state.wantSelected).filter(k => this.state.wantSelected[k]);
        this.props.onSubmit({
            toPlayerId: this.state.toPlayerId,
            offerProperties, wantProperties,
            offerMoney: parseInt(this.state.offerMoney) || 0,
            wantMoney: parseInt(this.state.wantMoney) || 0
        });
    }

    render() {
        const myId = gameService.currentPlayer;
        const game = this.props.game;
        const otherPlayers = game.players.filter(p => p.id !== myId && p.id !== 1 && !p.bankrupt);
        const myDeeds = this.getAllDeeds(myId);
        const theirDeeds = this.state.toPlayerId ? this.getAllDeeds(this.state.toPlayerId) : [];

        return <div className="card-overlay">
            <div className="trade-modal">
                <h3>PROPOSE TRADE</h3>
                <div className="trade-target">
                    <label>Trade with:</label>
                    <select value={this.state.toPlayerId || ''} onChange={e => this.setState({toPlayerId: e.target.value, wantSelected: {}})}>
                        {otherPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div className="trade-columns">
                    <div className="trade-col">
                        <h4>You offer:</h4>
                        <div className="trade-deed-list">
                            {myDeeds.map(d => <div key={d.title}
                                className={"trade-deed-item" + (this.state.offerSelected[d.title] ? " selected" : "")}
                                style={{borderLeft: '3px solid ' + (d.color || '#666')}}
                                onClick={() => this.toggleOffer(d.title)}>
                                {d.title}
                            </div>)}
                            {myDeeds.length === 0 && <div className="trade-empty">No properties</div>}
                        </div>
                        <div className="trade-money-row">
                            <label>$</label>
                            <input type="number" min="0" step="10" value={this.state.offerMoney}
                                onChange={e => this.setState({offerMoney: e.target.value})}/>
                        </div>
                    </div>
                    <div className="trade-arrow">&#x21C4;</div>
                    <div className="trade-col">
                        <h4>You want:</h4>
                        <div className="trade-deed-list">
                            {theirDeeds.map(d => <div key={d.title}
                                className={"trade-deed-item" + (this.state.wantSelected[d.title] ? " selected" : "")}
                                style={{borderLeft: '3px solid ' + (d.color || '#666')}}
                                onClick={() => this.toggleWant(d.title)}>
                                {d.title}
                            </div>)}
                            {theirDeeds.length === 0 && <div className="trade-empty">No properties</div>}
                        </div>
                        <div className="trade-money-row">
                            <label>$</label>
                            <input type="number" min="0" step="10" value={this.state.wantMoney}
                                onChange={e => this.setState({wantMoney: e.target.value})}/>
                        </div>
                    </div>
                </div>
                <div className="trade-buttons">
                    <button className="buy-btn" onClick={this.submit}>Send Offer</button>
                    <button className="decline-btn" onClick={this.props.onClose}>Cancel</button>
                </div>
            </div>
        </div>;
    }
}
