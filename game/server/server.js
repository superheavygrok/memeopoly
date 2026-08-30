process.on('uncaughtException', (err) => {
    if (err.code === 'ECONNRESET') return;
    console.error('Uncaught:', err);
});

const HTTPS_PORT = process.env.PORT || 8443;

const key = process.env.HTTP_TLS_KEY || 'key.pem';
const cert = process.env.HTTP_TLS_CERTIFICATE || 'cert.pem';
const https = process.env.HTTP !== "true";

const fs = require('fs');
const http = https ? require('https') : require('http');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const static_ = require('node-static');
const path = require('path');
const file = new (static_.Server)(path.join(__dirname, '..', 'static'), {cache: 0});
const {GameService} = require('./game');
const accounts = require('./accounts');
const vault = require('./vault');
const walletgate = require('./walletgate');

let lastActivity = Date.now();

const rooms = {};

function getOrCreateRoom(roomId) {
    if (!rooms[roomId]) {
        const gs = new GameService();
        rooms[roomId] = {
            gameService: gs,
            clients: new Set()
        };
        gs.ws = {
            broadcast: function(data) {
                rooms[roomId].clients.forEach(function(client) {
                    if (client.readyState === WebSocket.OPEN) {
                        try { client.send(data); } catch(e) {}
                    }
                });
            }
        };
        gs.game = gs.newGame();
        console.log('Room created:', roomId);
    }
    return rooms[roomId];
}

function getRoomList() {
    const list = [];
    for (const id of Object.keys(rooms)) {
        const r = rooms[id];
        const playerCount = r.gameService.game.players.filter(p => p.id !== 1).length;
        const clientCount = r.clients.size;
        list.push({id, players: playerCount, online: clientCount, started: r.gameService.game.started || false});
    }
    return list;
}

const serverConfig = https ? {
    key: fs.readFileSync(key),
    cert: fs.readFileSync(cert),
} : {};

function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
    });
}

function jsonResponse(res, data, status) {
    res.writeHead(status || 200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
    res.end(JSON.stringify(data));
}

const handleRequest = async function (request, response) {
    const url = request.url.split('?')[0];
    const params = new URLSearchParams((request.url.split('?')[1]) || '');

    if (request.method === 'OPTIONS') {
        response.writeHead(200, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type'});
        return response.end();
    }

    // --- SPINE: Account API ---
    if (url === '/api/signup' && request.method === 'POST') {
        const body = await parseBody(request);
        const result = accounts.createAccount(body.username, body.password, body.email, body.referredBy);
        return jsonResponse(response, result, result.error ? 400 : 200);
    }
    if (url === '/api/login' && request.method === 'POST') {
        const body = await parseBody(request);
        const result = accounts.login(body.username, body.password);
        return jsonResponse(response, result, result.error ? 401 : 200);
    }
    if (url === '/api/profile' && request.method === 'GET') {
        const userId = params.get('id');
        const profile = accounts.getPublicProfile(userId);
        return jsonResponse(response, profile || {error: 'Not found'}, profile ? 200 : 404);
    }
    if (url === '/api/account' && request.method === 'GET') {
        const userId = params.get('id');
        const acc = accounts.getAccount(userId);
        return jsonResponse(response, acc || {error: 'Not found'}, acc ? 200 : 404);
    }

    // --- EMAIL SUBSCRIBE ---
    if (url === '/api/email-subscribe' && request.method === 'POST') {
        const body = await parseBody(request);
        const result = accounts.emailSubscribe(body.email, body.source, request.headers['x-forwarded-for'] || request.socket.remoteAddress);
        return jsonResponse(response, result, result.error ? 400 : 200);
    }

    // --- LEGS: Share pages ---
    if (url.startsWith('/share/profile/')) {
        const userId = url.split('/share/profile/')[1];
        const profile = accounts.getPublicProfile(userId);
        if (profile) {
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${profile.username} - Memeopoly</title>
<meta property="og:title" content="${profile.username} | Level ${profile.level} on Memeopoly">
<meta property="og:description" content="${profile.stats.gamesWon} wins, ${profile.stats.gamesPlayed} games played. ${profile.achievements.length} achievements unlocked.">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary">
<script>window.location='/?view=profile&id=${userId}'</script></head><body>Redirecting...</body></html>`;
            response.writeHead(200, {'Content-Type': 'text/html'});
            return response.end(html);
        }
    }
    if (url.startsWith('/share/room/')) {
        const roomId = url.split('/share/room/')[1];
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Join ${roomId} - Memeopoly</title>
<meta property="og:title" content="Join room '${roomId}' on Memeopoly!">
<meta property="og:description" content="Crypto-themed multiplayer board game. Join now and earn $MEMO tokens!">
<meta name="twitter:card" content="summary">
<script>window.location='/?room=${roomId}'</script></head><body>Redirecting...</body></html>`;
        response.writeHead(200, {'Content-Type': 'text/html'});
        return response.end(html);
    }

    // --- NERVOUS SYSTEM: Analytics + Leaderboard ---
    if (url === '/api/leaderboard') {
        const type = params.get('type') || 'xp';
        return jsonResponse(response, accounts.getLeaderboard(type, 20));
    }
    if (url === '/api/analytics') {
        return jsonResponse(response, accounts.getAnalyticsSummary());
    }

    // --- Existing ---
    if (url === '/stats') {
        return response.end(JSON.stringify({lastActivity: lastActivity}));
    }
    if (url === '/api/rooms') {
        return jsonResponse(response, getRoomList());
    }
    if (url === '/api/achievements') {
        return jsonResponse(response, accounts.ACHIEVEMENT_DEFS.map(a => ({id: a.id, name: a.name, desc: a.desc, icon: a.icon, xp: a.xp})));
    }

    // --- WALLET GATE ---
    // The balance check happens on this side of the wire. A client-reported
    // balance is meaningless, and hiding a button is not access control.
    if (url === '/api/wallet/config') {
        return jsonResponse(response, walletgate.getConfig());
    }
    if (url === '/api/wallet/challenge' && request.method === 'POST') {
        const body = await parseBody(request);
        const ip = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
        const result = walletgate.createChallenge(body.publicKey, ip);
        return jsonResponse(response, result, result.error ? 400 : 200);
    }
    if (url === '/api/wallet/verify' && request.method === 'POST') {
        const body = await parseBody(request);
        const ip = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
        const result = await walletgate.verifyChallenge(body.publicKey, body.signature, body.nonce, ip);
        return jsonResponse(response, result, result.error ? 403 : 200);
    }
    if (url === '/api/wallet/session') {
        const s = walletgate.getSession(params.get('token'));
        return jsonResponse(response, s
            ? {valid: true, publicKey: s.publicKey, balance: s.balance}
            : {valid: false}, s ? 200 : 401);
    }

    // --- VAULT API ---
    if (url === '/api/vault') {
        return jsonResponse(response, vault.getVaultState());
    }
    if (url === '/api/vault/rewards') {
        return jsonResponse(response, vault.BASE_REWARDS);
    }
    if (url === '/api/vault/user' && request.method === 'GET') {
        const userId = params.get('id');
        return jsonResponse(response, vault.getUserTokenBalance(userId, accounts));
    }

    // Track page view
    accounts.trackEvent('page_view', {url: request.url});

    // Note: node-static is constructed with {cache: 0}, so it already sends
    // Cache-Control: max-age=0 and overrides any header set here. Setting
    // cache headers at this point has no effect.
    file.serve(request, response);
};

const httpsServer = http.createServer(serverConfig, handleRequest);
httpsServer.listen(HTTPS_PORT, '0.0.0.0');

const wss = new WebSocketServer({server: httpsServer});

wss.on('connection', function (ws) {
    console.log('new connection');
    ws.roomId = null;

    ws.on('error', function () {});

    ws.on('message', function (message) {
        try {
            const messageObject = JSON.parse(message);

            if (messageObject.type === 'joinRoom') {
                // The real gate. Hiding the Play button in the client is
                // cosmetic - anyone can open a socket and send joinRoom, so the
                // check has to live here.
                if (!walletgate.isAllowed(messageObject.gateToken)) {
                    try {
                        ws.send(JSON.stringify({
                            type: 'gateRequired',
                            message: 'Connect your wallet and hold ' + walletgate.getConfig().minBalance + ' tokens to join a game.'
                        }));
                    } catch (e) {}
                    return;
                }

                const roomId = (messageObject.roomId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'default';
                if (ws.roomId && rooms[ws.roomId]) {
                    rooms[ws.roomId].clients.delete(ws);
                }
                const room = getOrCreateRoom(roomId);
                if (messageObject.turnTimer && !room.gameService.game.turnTimeLimit) {
                    room.gameService.game.turnTimeLimit = Math.min(300, Math.max(0, parseInt(messageObject.turnTimer) || 0));
                }
                ws.roomId = roomId;
                room.clients.add(ws);
                try {
                    ws.send(JSON.stringify({type: 'roomJoined', roomId: roomId}));
                    ws.send(JSON.stringify({type: 'game', game: room.gameService.game}));
                    ws.send(JSON.stringify({type: 'log', message: room.gameService.logs}));
                    ws.send(JSON.stringify({type: 'chat', message: room.gameService.chat}));
                    room.gameService.broadcastCpoly();
                } catch(e) {}
                console.log('Client joined room:', roomId, '- clients:', room.clients.size);

            } else if (messageObject.type === 'listRooms') {
                try { ws.send(JSON.stringify({type: 'roomList', rooms: getRoomList()})); } catch(e) {}

            } else if (messageObject.type === 'wsSignup') {
                const result = accounts.createAccount(messageObject.username, messageObject.password, messageObject.email, messageObject.referredBy);
                if (result.success) {
                    ws.accountId = result.account.id;
                    vault.recordXP(result.account.id, 100, 'account_created');
                    if (messageObject.referredBy) vault.recordXP(result.account.id, 200, 'referral');
                }
                try { ws.send(JSON.stringify({type: 'authResult', action: 'signup', ...result})); } catch(e) {}

            } else if (messageObject.type === 'wsLogin') {
                const result = accounts.login(messageObject.username, messageObject.password);
                if (result.success) ws.accountId = result.account.id;
                try { ws.send(JSON.stringify({type: 'authResult', action: 'login', ...result})); } catch(e) {}

            } else if (messageObject.type === 'wsGetAccount') {
                const acc = accounts.getAccount(messageObject.userId || ws.accountId);
                try { ws.send(JSON.stringify({type: 'accountData', account: acc})); } catch(e) {}

            } else if (messageObject.type === 'wsLeaderboard') {
                const lb = accounts.getLeaderboard(messageObject.lbType || 'xp', 20);
                try { ws.send(JSON.stringify({type: 'leaderboard', lbType: messageObject.lbType, entries: lb})); } catch(e) {}

            } else if (messageObject.type === 'wsShareRoom') {
                const roomId = ws.roomId || messageObject.roomId;
                if (roomId) {
                    try { ws.send(JSON.stringify({type: 'shareLink', url: '/share/room/' + roomId})); } catch(e) {}
                }

            } else if (messageObject.type === 'wsGetVault') {
                try { ws.send(JSON.stringify({type: 'vaultState', vault: vault.getVaultState()})); } catch(e) {}

            } else if (messageObject.type === 'wsGetTokenBalance') {
                const userId = messageObject.userId || ws.accountId;
                if (userId) {
                    try { ws.send(JSON.stringify({type: 'tokenBalance', ...vault.getUserTokenBalance(userId, accounts)})); } catch(e) {}
                }

            } else if (messageObject.type === 'game') {
                if (!ws.roomId) return;
                const room = rooms[ws.roomId];
                if (!room) return;

                // Track XP-generating actions in the vault
                const cmd = messageObject.command;
                const from = messageObject.from;
                const acctId = ws.accountId;
                if (acctId) {
                    if (cmd === 'rollDice') { vault.recordXP(acctId, 5, 'dice_roll'); accounts.updateStat(acctId, 'diceRolled', 1); }
                    if (cmd === 'passedGo') { vault.recordXP(acctId, 50, 'pass_go'); }
                    if (cmd === 'sendDeed') { vault.recordXP(acctId, 30, 'property_bought'); accounts.updateStat(acctId, 'propertiesBought', 1); }
                }

                room.gameService.ws.broadcast(JSON.stringify(
                    room.gameService.processCommand(messageObject.command, messageObject.params, messageObject.from)
                ));
                lastActivity = Date.now();

            } else {
                if (ws.roomId && rooms[ws.roomId]) {
                    rooms[ws.roomId].gameService.ws.broadcast(message);
                }
            }
        } catch(e) {
            console.log('message error:', e.message);
        }
    });

    ws.on('close', function() {
        if (ws.roomId && rooms[ws.roomId]) {
            rooms[ws.roomId].clients.delete(ws);
            console.log('Client left room:', ws.roomId, '- clients:', rooms[ws.roomId].clients.size);
            if (rooms[ws.roomId].clients.size === 0) {
                setTimeout(() => {
                    if (rooms[ws.roomId] && rooms[ws.roomId].clients.size === 0) {
                        delete rooms[ws.roomId];
                        console.log('Room cleaned up:', ws.roomId);
                    }
                }, 300000);
            }
        }
    });
});

console.log('Server running. Visit http' + (https ? "s" : "") + '://localhost:' + HTTPS_PORT + ' in Firefox/Chrome.\n\n\
Some important notes:\n\
  * Some browsers or OSs may not allow the webcam to be used by multiple pages at once. You may need to use two different browsers or machines.\n'
);
