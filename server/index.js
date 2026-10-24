const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { init: initDb, getDb } = require('../database/db');
const GAME_CONFIG = require('../shared/config/gameConfig');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = 'hero-idle-jwt-secret-2024';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// Initialize database
const db = initDb();

// ===== UTILITY FUNCTIONS =====
function generateToken(user) {
    return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

function getPlayer(userId) {
    return db.prepare('SELECT * FROM players WHERE user_id = ?').get(userId);
}

function savePlayer(player) {
    const stmt = db.prepare(\
        INSERT OR REPLACE INTO players (
            user_id, class, level, xp, coins, gems, energy, max_energy,
            hp, max_hp, attack, defense, speed, crit, stat_points, skill_points,
            current_mission, mission_end, training_id, training_end,
            equipped_weapon, equipped_armor, equipped_accessory, active_buffs,
            daily_login_day, last_daily_login, total_playtime,
            pvp_rating, pvp_wins, pvp_losses, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \);
    const now = Date.now();
    stmt.run(
        player.user_id, player.class, player.level, player.xp, player.coins, player.gems,
        player.energy, player.max_energy, player.hp, player.max_hp, player.attack,
        player.defense, player.speed, player.crit, player.stat_points, player.skill_points,
        player.current_mission, player.mission_end, player.training_id, player.training_end,
        player.equipped_weapon, player.equipped_armor, player.equipped_accessory,
        JSON.stringify(player.activeBuffs || []), player.daily_login_day, player.last_daily_login,
        player.total_playtime, player.pvp_rating, player.pvp_wins, player.pvp_losses, now
    );
}

// ===== AUTH ROUTES =====
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username must be 3-20 characters' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existing) {
            return res.status(400).json({ error: 'Username or email already taken' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const now = Date.now();

        db.prepare('INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, username, email, passwordHash, now);

        // Create player data
        const starting = GAME_CONFIG.startingResources;
        const classData = GAME_CONFIG.classes.dps;
        const baseStats = classData.baseStats;

        db.prepare(\
            INSERT INTO players (user_id, class, level, xp, coins, gems, energy, max_energy,
                hp, max_hp, attack, defense, speed, crit, stat_points, skill_points,
                equipped_weapon, equipped_armor, equipped_accessory, active_buffs,
                daily_login_day, last_daily_login, pvp_rating, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \).run(
            userId, 'dps', 1, 0,
            starting.coins, starting.gems, starting.energy, starting.maxEnergy,
            baseStats.hp, baseStats.hp, baseStats.attack, baseStats.defense,
            baseStats.speed, baseStats.crit, 0, 0,
            'fists', 'clothes', '', '[]',
            0, 0, 0, 1000, now
        );

        // Give welcome package
        const welcome = GAME_CONFIG.newPlayerBonuses.welcomePackage;
        if (welcome.coins) {
            db.prepare('UPDATE players SET coins = coins + ? WHERE user_id = ?').run(welcome.coins, userId);
        }
        if (welcome.gems) {
            db.prepare('UPDATE players SET gems = gems + ? WHERE user_id = ?').run(welcome.gems, userId);
        }
        if (welcome.legendaryWeapon) {
            db.prepare('INSERT INTO inventory (id, user_id, item_id, quantity, rarity) VALUES (?, ?, ?, ?, ?)')
                .run(uuidv4(), userId, 'legendary_blade', 1, 'legendary');
        }
        if (welcome.legendaryArmor) {
            db.prepare('INSERT INTO inventory (id, user_id, item_id, quantity, rarity) VALUES (?, ?, ?, ?, ?)')
                .run(uuidv4(), userId, 'divine_aegis', 1, 'legendary');
        }

        const token = generateToken({ id: userId, username });
        res.json({ token, user: { id: userId, username, email } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.banned) return res.status(403).json({ error: 'Account banned' });

        db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
        const token = generateToken({ id: user.id, username: user.username });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/auth/guest', (req, res) => {
    const userId = 'guest_' + uuidv4();
    const username = 'Guest_' + Math.random().toString(36).substr(2, 6);
    const now = Date.now();

    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(userId, username, 'guest', now);

    const starting = GAME_CONFIG.startingResources;
    const classData = GAME_CONFIG.classes.dps;
    const baseStats = classData.baseStats;

    db.prepare(\
        INSERT INTO players (user_id, class, level, xp, coins, gems, energy, max_energy,
            hp, max_hp, attack, defense, speed, crit, stat_points, skill_points,
            equipped_weapon, equipped_armor, equipped_accessory, active_buffs,
            daily_login_day, last_daily_login, pvp_rating, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \).run(
        userId, 'dps', 1, 0,
        starting.coins, starting.gems, starting.energy, starting.maxEnergy,
        baseStats.hp, baseStats.hp, baseStats.attack, baseStats.defense,
        baseStats.speed, baseStats.crit, 0, 0,
        'fists', 'clothes', '', '[]',
        0, 0, 0, 1000, now
    );

    const token = generateToken({ id: userId, username, guest: true });
    res.json({ token, user: { id: userId, username, guest: true } });
});

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = verifyToken(auth.slice(7));
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
}

// ===== GAME ROUTES =====
app.get('/api/game/config', (req, res) => {
    // Send client-safe config (no admin keys)
    const clientConfig = { ...GAME_CONFIG };
    delete clientConfig.admin;
    res.json(clientConfig);
});

app.get('/api/player', authMiddleware, (req, res) => {
    const player = getPlayer(req.user.userId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Parse JSON fields
    player.activeBuffs = JSON.parse(player.active_buffs || '[]');
    player.activeBuffs = player.activeBuffs.filter(b => b.end > Date.now());

    // Get inventory
    const inventory = db.prepare('SELECT * FROM inventory WHERE user_id = ?').all(player.user_id);
    // Get skills
    const skills = db.prepare('SELECT * FROM skills WHERE user_id = ?').all(player.user_id);
    // Get mission progress
    const missions = db.prepare('SELECT * FROM mission_progress WHERE user_id = ?').all(player.user_id);

    res.json({ player, inventory, skills, missions });
});

app.post('/api/player/mission/start', authMiddleware, (req, res) => {
    const { missionId } = req.body;
    const player = getPlayer(req.user.userId);
    const mission = GAME_CONFIG.missions.find(m => m.id === missionId);

    if (!mission) return res.status(400).json({ error: 'Mission not found' });
    if (player.level < mission.minLevel) return res.status(400).json({ error: 'Level too low' });
    if (player.energy < mission.energyCost) return res.status(400).json({ error: 'Not enough energy' });
    if (player.current_mission) return res.status(400).json({ error: 'Already on a mission' });

    player.energy -= mission.energyCost;
    player.current_mission = missionId;
    player.mission_end = Date.now() + mission.duration * 1000;
    savePlayer(player);

    res.json({ player, missionEnd: player.mission_end });
});

app.post('/api/player/mission/complete', authMiddleware, (req, res) => {
    const player = getPlayer(req.user.userId);
    if (!player.current_mission) return res.status(400).json({ error: 'No active mission' });
    if (Date.now() < player.mission_end) return res.status(400).json({ error: 'Mission not complete' });

    const mission = GAME_CONFIG.missions.find(m => m.id === player.current_mission);
    const multiplier = player.activeBuffs.find(b => b.type === 'xp')?.value || 1;
    const coinMultiplier = player.activeBuffs.find(b => b.type === 'coins')?.value || 1;
    const lootMultiplier = player.activeBuffs.find(b => b.type === 'loot')?.value || 1;

    // First mission bonus
    const firstMission = !db.prepare('SELECT 1 FROM mission_progress WHERE user_id = ? AND mission_id = ?').get(player.user_id, player.current_mission);
    const xpGain = Math.floor(mission.xp * GAME_CONFIG.balance.missionXPMultiplier * multiplier * (firstMission ? GAME_CONFIG.newPlayerBonuses.firstMissionBonus.xpMultiplier : 1));
    const coinGain = Math.floor(mission.coins * GAME_CONFIG.balance.missionCoinMultiplier * coinMultiplier * (firstMission ? GAME_CONFIG.newPlayerBonuses.firstMissionBonus.coinMultiplier : 1));

    player.xp += xpGain;
    player.coins += coinGain;
    player.current_mission = null;
    player.mission_end = 0;

    // Mission progress
    db.prepare('INSERT OR REPLACE INTO mission_progress (id, user_id, mission_id, completed_count, last_completed) VALUES (?, ?, ?, COALESCE((SELECT completed_count FROM mission_progress WHERE user_id = ? AND mission_id = ?), 0) + 1, ?)')
        .run(uuidv4(), player.user_id, mission.id, player.user_id, mission.id, Date.now());

    // Loot
    const loot = generateLoot(mission.lootTable, lootMultiplier);
    for (const item of loot) {
        addItemToInventory(player.user_id, item.id, 1, item.rarity);
    }

    // Check level up
    checkLevelUp(player);

    savePlayer(player);

    res.json({ player, rewards: { xp: xpGain, coins: coinGain, loot }, levelUp: player.leveledUp });
    player.leveledUp = false;
});

function generateLoot(lootTable, multiplier = 1) {
    const loot = [];
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    for (const tableRarity of lootTable) {
        const baseRate = GAME_CONFIG.balance[tableRarity + 'DropRate'] || 0;
        const rate = baseRate * multiplier;
        if (Math.random() < rate) {
            const items = getItemsByRarity(tableRarity);
            if (items.length > 0) {
                loot.push(items[Math.floor(Math.random() * items.length)]);
            }
        }
    }
    return loot;
}

function getItemsByRarity(rarity) {
    const items = [];
    for (const type of ['weapons', 'armor', 'accessories']) {
        for (const item of GAME_CONFIG.equipment[type]) {
            if (item.rarity === rarity) items.push(item);
        }
    }
    return items;
}

function addItemToInventory(userId, itemId, quantity, rarity) {
    const existing = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, itemId);
    if (existing) {
        db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
    } else {
        db.prepare('INSERT INTO inventory (id, user_id, item_id, quantity, rarity) VALUES (?, ?, ?, ?, ?)')
            .run(uuidv4(), userId, itemId, quantity, rarity);
    }
}

function checkLevelUp(player) {
    const xpNeeded = Math.floor(GAME_CONFIG.balance.levelXPBase * Math.pow(player.level, GAME_CONFIG.balance.levelXPExponent));
    if (player.xp >= xpNeeded) {
        player.level++;
        player.xp -= xpNeeded;
        player.stat_points += 5;
        player.skill_points += 1;
        player.max_hp += GAME_CONFIG.classes[player.class].statGrowth.hp;
        player.hp = player.max_hp;
        player.max_energy += GAME_CONFIG.balance.maxEnergyPerLevel;
        player.energy = player.max_energy;

        // First level up bonus
        if (player.level === 2) {
            const bonus = GAME_CONFIG.newPlayerBonuses.firstLevelUpBonus;
            player.gems += bonus.gems;
            player.coins += bonus.coins;
        }

        player.leveledUp = true;
    }
}

// ===== WS HANDLING =====
const clients = new Map();

wss.on('connection', (ws, req) => {
    let userId = null;

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'auth') {
                const decoded = verifyToken(msg.token);
                if (decoded) {
                    userId = decoded.userId;
                    clients.set(userId, ws);
                    ws.send(JSON.stringify({ type: 'auth_ok', userId }));
                }
            } else if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (e) {
            console.error('WS error:', e);
        }
    });

    ws.on('close', () => {
        if (userId) clients.delete(userId);
    });
});

function broadcast(userId, data) {
    const ws = clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// ===== ADMIN ROUTES =====
app.post('/api/admin/command', authMiddleware, (req, res) => {
    const player = getPlayer(req.user.userId);
    if (!player || player.is_admin !== 1) {
        return res.status(403).json({ error: 'Admin only' });
    }
    const { command, args } = req.body;
    // Admin commands handled client-side via console
    res.json({ ok: true });
});

// ===== STATIC FILES =====
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ===== START =====
initDb();
server.listen(PORT, () => {
    console.log(\Hero Idle Game server running on http://localhost:\\);
});
