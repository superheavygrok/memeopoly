const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});

function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { return fallback; }
}

function saveVault() {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), 'utf8');
}

const DEFAULT_VAULT = {
    // Total supply — fixed at creation
    totalSupply: 1_000_000_000,

    // Reward vault — tokens waiting to be earned through participation
    rewardVault: 1_000_000_000,

    // Circulating — tokens distributed to users
    circulating: 0,

    // Cash-out vault: REMOVED — $MEMO is not redeemable for money.
    // Kept as a permanent zero so existing vault.json files still load.
    cashOutVault: 0,

    // Halvening tracker
    halvening: {
        count: 0,
        // Halvening triggers when half of remaining rewardVault is distributed
        nextThreshold: 500_000_000,
        currentRate: 1.0
    },

    // Platform-wide XP ledger
    totalXPEarned: 0,

    // Token launch state
    launched: false,
    launchDate: null,

    // Conversion rate: how many tokens per XP point
    // Set at launch: totalSupply * airdropPercent / totalXPEarned
    conversionRate: 1,

    // Airdrop config
    airdrop: {
        completed: false,
        percent: 10, // 10% of supply goes to initial airdrop
        snapshot: null // frozen XP balances at launch time
    },

    // Cash-out recycling ledger
    recycled: 0,

    // Revenue tracking
    revenue: {
        ads: 0,
        subscriptions: 0,
        cosmetics: 0,
        marketplace: 0,
        sponsorships: 0,
        total: 0
    },

    // Transaction history (last 1000)
    transactions: []
};

let vault = loadJSON(VAULT_FILE, {...DEFAULT_VAULT});

// --- XP PARTICIPATION LAYER ---
// XP is earned through ALL participation. It serves as:
// 1. Reward signal (users see progress)
// 2. Participation proof (years of data)
// 3. Abuse detection (anomalous XP patterns)
// 4. Token distribution basis (XP -> tokens at launch)

function recordXP(userId, amount, action) {
    vault.totalXPEarned += amount;

    const tx = {
        type: 'xp_earned',
        userId,
        amount,
        action,
        timestamp: new Date().toISOString()
    };
    vault.transactions.push(tx);
    if (vault.transactions.length > 1000) vault.transactions = vault.transactions.slice(-500);

    saveVault();
    return amount;
}

// --- TOKEN VAULT WITH HALVENING ---

function distributeFromVault(userId, amount, reason) {
    if (vault.rewardVault < amount) amount = vault.rewardVault;
    if (amount <= 0) return 0;

    vault.rewardVault -= amount;
    vault.circulating += amount;

    vault.transactions.push({
        type: 'vault_distribute',
        userId,
        amount,
        reason,
        vaultRemaining: vault.rewardVault,
        rate: vault.halvening.currentRate,
        timestamp: new Date().toISOString()
    });

    // Check halvening
    checkHalvening();
    saveVault();
    return amount;
}

function checkHalvening() {
    const distributed = vault.totalSupply - vault.rewardVault;
    if (distributed >= vault.halvening.nextThreshold) {
        vault.halvening.count++;
        vault.halvening.currentRate /= 2;
        // Next halvening when half of REMAINING vault is distributed
        vault.halvening.nextThreshold = distributed + (vault.rewardVault / 2);

        vault.transactions.push({
            type: 'halvening',
            count: vault.halvening.count,
            newRate: vault.halvening.currentRate,
            nextThreshold: vault.halvening.nextThreshold,
            timestamp: new Date().toISOString()
        });
    }
}

// --- AIRDROP: Convert XP to Tokens ---

function launchToken(accountsModule) {
    if (vault.launched) return {error: 'Token already launched'};

    // Snapshot all XP
    const allAccounts = {};
    const accountIds = getAllAccountIds(accountsModule);
    let totalXP = 0;

    for (const id of accountIds) {
        const acc = accountsModule.getAccount(id);
        if (acc) {
            const xp = (acc.level - 1) * 100 + acc.xp + (acc.stats.totalCpoly || 0);
            allAccounts[id] = xp;
            totalXP += xp;
        }
    }

    if (totalXP === 0) return {error: 'No XP earned yet — need participation first'};

    // Airdrop pool: 10% of total supply
    const airdropPool = Math.floor(vault.totalSupply * (vault.airdrop.percent / 100));

    // Conversion: 1 XP = (airdropPool / totalXP) tokens
    vault.conversionRate = airdropPool / totalXP;

    // Distribute airdrop
    vault.airdrop.snapshot = {};
    for (const [id, xp] of Object.entries(allAccounts)) {
        const tokens = Math.floor(xp * vault.conversionRate);
        if (tokens > 0) {
            vault.airdrop.snapshot[id] = {xp, tokens};
            vault.rewardVault -= tokens;
            vault.circulating += tokens;
        }
    }

    vault.launched = true;
    vault.launchDate = new Date().toISOString();

    // Recalculate halvening threshold from current state
    const distributed = vault.totalSupply - vault.rewardVault;
    vault.halvening.nextThreshold = distributed + (vault.rewardVault / 2);

    vault.transactions.push({
        type: 'token_launch',
        totalXP,
        conversionRate: vault.conversionRate,
        airdropPool,
        accounts: Object.keys(allAccounts).length,
        timestamp: vault.launchDate
    });

    saveVault();
    return {
        success: true,
        totalXP,
        conversionRate: vault.conversionRate,
        airdropPool,
        distributed: Object.keys(vault.airdrop.snapshot).length
    };
}

function getAllAccountIds(accountsModule) {
    // Read accounts file directly since module doesn't expose list
    const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
    try {
        const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        return Object.keys(data);
    } catch(e) { return []; }
}

// --- REVENUE TRACKING (internal accounting only) ---
//
// IMPORTANT: revenue is recorded for internal analytics ONLY. It is deliberately
// NOT linked to $MEMO in any way.
//
// A previous version routed 10% of all platform revenue into a "cash-out vault"
// and let users redeem $MEMO against it for real money. That made a user's
// $MEMO balance a pro-rata claim on business revenue, realizable for cash and
// appreciating via an operator-controlled halvening schedule -- i.e. an
// investment contract under the Howey test. That mechanic has been removed.
//
// Do NOT reintroduce any function that converts $MEMO into money, or that
// derives a $MEMO price from revenue, treasury, or supply. $MEMO is a
// non-redeemable in-game point used for cosmetics only.

function recordRevenue(source, amount) {
    if (!vault.revenue[source]) vault.revenue[source] = 0;
    vault.revenue[source] += amount;
    vault.revenue.total += amount;

    vault.transactions.push({
        type: 'revenue',
        source,
        amount,
        timestamp: new Date().toISOString()
    });

    saveVault();
    return {recorded: amount, total: vault.revenue.total};
}

// --- SPEND $MEMO (cosmetics only) ---
//
// Replaces the removed cashOut(). $MEMO leaves a user's balance ONLY by being
// spent on in-game cosmetic items. It never converts to money, and spent
// $MEMO is returned to the reward vault so it can be re-earned by players.

function spendOnCosmetic(userId, tokenAmount, itemId, accountsModule) {
    const acc = accountsModule.getAccount(userId);
    if (!acc) return {error: 'Account not found'};
    if (!itemId) return {error: 'No item specified'};

    const amount = Math.floor(Number(tokenAmount));
    if (!Number.isFinite(amount) || amount <= 0) return {error: 'Invalid amount'};
    if ((acc.cpolyBalance || 0) < amount) return {error: 'Insufficient $MEMO balance'};

    // Deduct from the user, return the points to the reward vault
    accountsModule.addCpoly(userId, -amount, 'cosmetic_purchase');
    vault.rewardVault += amount;
    vault.circulating -= amount;
    vault.recycled += amount;

    vault.transactions.push({
        type: 'cosmetic_purchase',
        userId,
        itemId,
        amount,
        timestamp: new Date().toISOString()
    });

    const distributed = vault.totalSupply - vault.rewardVault;
    vault.halvening.nextThreshold = distributed + (vault.rewardVault / 2);

    saveVault();
    return {
        success: true,
        itemId,
        spent: amount,
        remainingBalance: (acc.cpolyBalance || 0) - amount
    };
}

// --- PARTICIPATION REWARDS (post-launch, replaces raw XP) ---

const BASE_REWARDS = {
    daily_login: 25,
    pass_go: 50,
    game_played: 100,
    game_won: 500,
    referral: 200,
    achievement: 150,
    property_bought: 30,
    dice_roll: 5,
    color_set: 300
};

function getRewardAmount(action) {
    const base = BASE_REWARDS[action] || 10;
    if (!vault.launched) return base; // Pre-launch: raw XP
    return Math.floor(base * vault.halvening.currentRate);
}

// --- PUBLIC API ---

function getVaultState() {
    // NOTE: cashOutVault and raw revenue are deliberately NOT exposed to clients.
    // Publishing a treasury balance next to a token balance implies a redemption
    // value that does not exist. Revenue stays server-side for analytics only.
    return {
        totalSupply: vault.totalSupply,
        rewardVault: vault.rewardVault,
        circulating: vault.circulating,
        halvening: {...vault.halvening},
        totalXPEarned: vault.totalXPEarned,
        launched: vault.launched,
        launchDate: vault.launchDate,
        conversionRate: vault.conversionRate,
        recycled: vault.recycled,
        redeemable: false,
        disclaimer: '$MEMO is an in-game point with no cash value and cannot be redeemed for money.',
        recentTransactions: vault.transactions.slice(-20)
    };
}

function getUserTokenBalance(userId, accountsModule) {
    const acc = accountsModule.getAccount(userId);
    if (!acc) return {tokens: 0, xp: 0};

    const totalXP = (acc.level - 1) * 100 + acc.xp;
    let tokens = acc.cpolyBalance || 0;

    // If airdrop happened, include airdrop amount
    if (vault.airdrop.snapshot && vault.airdrop.snapshot[userId]) {
        tokens += vault.airdrop.snapshot[userId].tokens;
    }

    // No estimatedValue. $MEMO has no monetary value and quoting one in the UI
    // is the representation that turns a game point into an investment product.
    return {
        tokens,
        xp: totalXP,
        level: acc.level,
        redeemable: false
    };
}

module.exports = {
    recordXP,
    distributeFromVault,
    launchToken,
    recordRevenue,
    spendOnCosmetic,
    getRewardAmount,
    getVaultState,
    getUserTokenBalance,
    checkHalvening,
    BASE_REWARDS
};
