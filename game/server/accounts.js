const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});

function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { return fallback; }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// --- SPINE: Account System ---
let accounts = loadJSON(ACCOUNTS_FILE, {});

function hashPassword(pass, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pass, salt, 1000, 64, 'sha512').toString('hex');
    return {salt, hash};
}

function createAccount(username, password, email, referredBy) {
    const id = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id || id.length < 3 || id.length > 20) return {error: 'Username must be 3-20 alphanumeric characters'};
    if (accounts[id]) return {error: 'Username already taken'};
    if (password.length < 4) return {error: 'Password must be at least 4 characters'};

    const {salt, hash} = hashPassword(password);
    const now = new Date().toISOString();

    accounts[id] = {
        id,
        username,
        email: email || null,
        passwordHash: hash,
        salt,
        createdAt: now,
        lastLogin: now,
        referredBy: referredBy || null,

        // XP & Level
        xp: 0,
        level: 1,

        // Stats
        stats: {
            gamesPlayed: 0,
            gamesWon: 0,
            totalCpoly: 0,
            propertiesBought: 0,
            diceRolled: 0,
            moneyEarned: 0,
            referralCount: 0,
            loginStreak: 0,
            bestStreak: 0,
            lastLoginDate: now.slice(0, 10),
            totalLogins: 1
        },

        // Achievements
        achievements: [],

        // Inventory / cosmetics
        unlockedSkins: ['hat-cowboy-side', 'dog', 'cat', 'car', 'ship', 'frog'],
        equippedSkin: null,
        equippedColor: '#38bdf8',
        customImage: null,

        // Economy
        cpolyBalance: 0,

        // Anti-abuse
        flags: 0,
        banned: false,
        lastActionTimestamps: []
    };

    saveJSON(ACCOUNTS_FILE, accounts);
    trackEvent('account_created', {userId: id, referredBy});
    return {success: true, account: sanitizeAccount(accounts[id])};
}

function login(username, password) {
    const id = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const acc = accounts[id];
    if (!acc) return {error: 'Account not found'};
    if (acc.banned) return {error: 'Account is banned'};

    const {hash} = hashPassword(password, acc.salt);
    if (hash !== acc.passwordHash) return {error: 'Wrong password'};

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Daily login streak
    if (acc.stats.lastLoginDate !== today) {
        acc.stats.totalLogins++;
        if (acc.stats.lastLoginDate === yesterday) {
            acc.stats.loginStreak++;
        } else {
            acc.stats.loginStreak = 1;
        }
        if (acc.stats.loginStreak > acc.stats.bestStreak) {
            acc.stats.bestStreak = acc.stats.loginStreak;
        }
        acc.stats.lastLoginDate = today;

        // Habit loop: daily XP + CPOLY
        const streakBonus = Math.min(acc.stats.loginStreak, 7);
        addXP(id, 25 * streakBonus, 'daily_login');
        acc.cpolyBalance += 25 * streakBonus;
        acc.stats.totalCpoly += 25 * streakBonus;

        checkAchievements(id);
    }

    acc.lastLogin = now;
    saveJSON(ACCOUNTS_FILE, accounts);
    trackEvent('login', {userId: id, streak: acc.stats.loginStreak});

    const token = crypto.randomBytes(32).toString('hex');
    return {success: true, account: sanitizeAccount(acc), token};
}

function addXP(userId, amount, reason) {
    const acc = accounts[userId];
    if (!acc) return;
    acc.xp += amount;

    // Level up: 100 XP per level, scaling
    const xpNeeded = acc.level * 100;
    while (acc.xp >= xpNeeded) {
        acc.xp -= acc.level * 100;
        acc.level++;
        // Level up rewards
        acc.cpolyBalance += acc.level * 50;
        acc.stats.totalCpoly += acc.level * 50;
        trackEvent('level_up', {userId, level: acc.level});
    }
}

function addCpoly(userId, amount, reason) {
    const acc = accounts[userId];
    if (!acc) return;
    acc.cpolyBalance += amount;
    acc.stats.totalCpoly += amount;
    saveJSON(ACCOUNTS_FILE, accounts);
}

function updateStat(userId, stat, increment) {
    const acc = accounts[userId];
    if (!acc || !acc.stats.hasOwnProperty(stat)) return;
    acc.stats[stat] += increment;
    checkAchievements(userId);
    saveJSON(ACCOUNTS_FILE, accounts);
}

// --- ACHIEVEMENTS ---
const ACHIEVEMENT_DEFS = [
    {id: 'first_game', name: 'First Roll', desc: 'Play your first game', icon: 'dice', check: a => a.stats.gamesPlayed >= 1, xp: 50},
    {id: 'veteran', name: 'Veteran', desc: 'Play 10 games', icon: 'trophy', check: a => a.stats.gamesPlayed >= 10, xp: 200},
    {id: 'whale', name: 'Whale', desc: 'Accumulate 1000 $MEMEOPOLY', icon: 'gem', check: a => a.stats.totalCpoly >= 1000, xp: 300},
    {id: 'streak_3', name: 'Consistent', desc: '3-day login streak', icon: 'fire', check: a => a.stats.bestStreak >= 3, xp: 100},
    {id: 'streak_7', name: 'Dedicated', desc: '7-day login streak', icon: 'fire', check: a => a.stats.bestStreak >= 7, xp: 500},
    {id: 'streak_30', name: 'Obsessed', desc: '30-day login streak', icon: 'fire', check: a => a.stats.bestStreak >= 30, xp: 2000},
    {id: 'referrer', name: 'Networker', desc: 'Refer 1 player', icon: 'link', check: a => a.stats.referralCount >= 1, xp: 100},
    {id: 'influencer', name: 'Influencer', desc: 'Refer 10 players', icon: 'megaphone', check: a => a.stats.referralCount >= 10, xp: 1000},
    {id: 'property_mogul', name: 'Property Mogul', desc: 'Buy 50 properties total', icon: 'building', check: a => a.stats.propertiesBought >= 50, xp: 500},
    {id: 'dice_master', name: 'Dice Master', desc: 'Roll dice 100 times', icon: 'dice', check: a => a.stats.diceRolled >= 100, xp: 200},
    {id: 'winner', name: 'Champion', desc: 'Win your first game', icon: 'crown', check: a => a.stats.gamesWon >= 1, xp: 300},
    {id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', icon: 'star', check: a => a.level >= 5, xp: 250},
    {id: 'level_10', name: 'Crypto Lord', desc: 'Reach level 10', icon: 'crown', check: a => a.level >= 10, xp: 1000},
];

function checkAchievements(userId) {
    const acc = accounts[userId];
    if (!acc) return [];
    const newAchievements = [];

    for (const def of ACHIEVEMENT_DEFS) {
        if (acc.achievements.indexOf(def.id) === -1 && def.check(acc)) {
            acc.achievements.push(def.id);
            addXP(userId, def.xp, 'achievement_' + def.id);
            newAchievements.push(def);
            trackEvent('achievement_unlocked', {userId, achievement: def.id});
        }
    }

    if (newAchievements.length > 0) saveJSON(ACCOUNTS_FILE, accounts);
    return newAchievements;
}

function getLeaderboard(type, limit) {
    limit = limit || 10;
    const accs = Object.values(accounts).filter(a => !a.banned);

    switch(type) {
        case 'xp':
            return accs.sort((a, b) => (b.level * 10000 + b.xp) - (a.level * 10000 + a.xp)).slice(0, limit).map(a => ({
                username: a.username, level: a.level, xp: a.xp
            }));
        case 'cpoly':
            return accs.sort((a, b) => b.stats.totalCpoly - a.stats.totalCpoly).slice(0, limit).map(a => ({
                username: a.username, cpoly: a.stats.totalCpoly
            }));
        case 'wins':
            return accs.sort((a, b) => b.stats.gamesWon - a.stats.gamesWon).slice(0, limit).map(a => ({
                username: a.username, wins: a.stats.gamesWon
            }));
        case 'streak':
            return accs.sort((a, b) => b.stats.bestStreak - a.stats.bestStreak).slice(0, limit).map(a => ({
                username: a.username, streak: a.stats.bestStreak
            }));
        default:
            return [];
    }
}

// --- IMMUNE SYSTEM: Anti-Abuse ---
function rateLimit(userId, action, maxPerMinute) {
    const acc = accounts[userId];
    if (!acc) return false;
    const now = Date.now();
    acc.lastActionTimestamps = (acc.lastActionTimestamps || []).filter(t => now - t < 60000);
    if (acc.lastActionTimestamps.length >= maxPerMinute) {
        acc.flags++;
        if (acc.flags > 50) acc.banned = true;
        saveJSON(ACCOUNTS_FILE, accounts);
        trackEvent('rate_limited', {userId, action, flags: acc.flags});
        return false;
    }
    acc.lastActionTimestamps.push(now);
    return true;
}

// --- NERVOUS SYSTEM: Analytics ---
let analytics = loadJSON(ANALYTICS_FILE, {events: [], dailyStats: {}});

function trackEvent(type, data) {
    const event = {
        type,
        data: data || {},
        timestamp: new Date().toISOString()
    };
    analytics.events.push(event);

    // Keep last 10000 events
    if (analytics.events.length > 10000) {
        analytics.events = analytics.events.slice(-5000);
    }

    // Daily aggregates
    const today = event.timestamp.slice(0, 10);
    if (!analytics.dailyStats[today]) {
        analytics.dailyStats[today] = {logins: 0, signups: 0, games: 0, referrals: 0, pageViews: 0};
    }
    if (type === 'login') analytics.dailyStats[today].logins++;
    if (type === 'account_created') analytics.dailyStats[today].signups++;
    if (type === 'game_started') analytics.dailyStats[today].games++;
    if (type === 'referral') analytics.dailyStats[today].referrals++;
    if (type === 'page_view') analytics.dailyStats[today].pageViews++;

    // Save every 10 events
    if (analytics.events.length % 10 === 0) {
        saveJSON(ANALYTICS_FILE, analytics);
    }
}

function getAnalyticsSummary() {
    const today = new Date().toISOString().slice(0, 10);
    return {
        totalAccounts: Object.keys(accounts).length,
        todayStats: analytics.dailyStats[today] || {logins: 0, signups: 0, games: 0, referrals: 0, pageViews: 0},
        recentEvents: analytics.events.slice(-20)
    };
}

// --- MEMORY: Email collection ---
function updateEmail(userId, email) {
    const acc = accounts[userId];
    if (!acc) return {error: 'Account not found'};
    acc.email = email;
    saveJSON(ACCOUNTS_FILE, accounts);
    trackEvent('email_updated', {userId});
    return {success: true};
}

// --- Helper ---
function sanitizeAccount(acc) {
    const {passwordHash, salt, lastActionTimestamps, ...safe} = acc;
    return safe;
}

function getAccount(userId) {
    return accounts[userId] ? sanitizeAccount(accounts[userId]) : null;
}

function getPublicProfile(userId) {
    const acc = accounts[userId];
    if (!acc) return null;
    return {
        username: acc.username,
        level: acc.level,
        xp: acc.xp,
        stats: {
            gamesPlayed: acc.stats.gamesPlayed,
            gamesWon: acc.stats.gamesWon,
            bestStreak: acc.stats.bestStreak,
            referralCount: acc.stats.referralCount
        },
        achievements: acc.achievements,
        createdAt: acc.createdAt
    };
}

// --- EMAIL SUBSCRIBE ---
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
let emailList = loadJSON(EMAILS_FILE, []);

function emailSubscribe(email, source, ip) {
    if (!email || typeof email !== 'string') return {success: false, error: 'Email is required'};
    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {success: false, error: 'Invalid email format'};
    const validSources = ['landing', 'ingame', 'newsletter'];
    source = validSources.includes(source) ? source : 'landing';
    if (emailList.some(e => e.email === email)) return {success: true};
    emailList.push({email, source, subscribedAt: new Date().toISOString(), ip: ip || null});
    saveJSON(EMAILS_FILE, emailList);
    return {success: true};
}

module.exports = {
    createAccount,
    login,
    getAccount,
    getPublicProfile,
    addXP,
    addCpoly,
    updateStat,
    checkAchievements,
    getLeaderboard,
    rateLimit,
    trackEvent,
    getAnalyticsSummary,
    updateEmail,
    ACHIEVEMENT_DEFS,
    sanitizeAccount,
    emailSubscribe
};
