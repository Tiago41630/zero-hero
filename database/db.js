const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database', 'game.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// ===== SCHEMA =====
const schema = \
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_login INTEGER,
    is_admin INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0
);

-- Player data table
CREATE TABLE IF NOT EXISTS players (
    user_id TEXT PRIMARY KEY,
    class TEXT DEFAULT 'dps',
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 10000,
    gems INTEGER DEFAULT 500,
    energy INTEGER DEFAULT 100,
    max_energy INTEGER DEFAULT 100,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    attack INTEGER DEFAULT 10,
    defense INTEGER DEFAULT 5,
    speed INTEGER DEFAULT 10,
    crit INTEGER DEFAULT 5,
    stat_points INTEGER DEFAULT 0,
    skill_points INTEGER DEFAULT 0,
    current_mission TEXT,
    mission_end INTEGER,
    training_id TEXT,
    training_end INTEGER,
    equipped_weapon TEXT DEFAULT 'fists',
    equipped_armor TEXT DEFAULT 'clothes',
    equipped_accessory TEXT DEFAULT '',
    active_buffs TEXT DEFAULT '[]',
    daily_login_day INTEGER DEFAULT 0,
    last_daily_login INTEGER,
    total_playtime INTEGER DEFAULT 0,
    pvp_rating INTEGER DEFAULT 1000,
    pvp_wins INTEGER DEFAULT 0,
    pvp_losses INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    rarity TEXT,
    enhanced_level INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 0,
    obtained_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    unlocked INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Quests/Missions progress
CREATE TABLE IF NOT EXISTS mission_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    completed_count INTEGER DEFAULT 0,
    last_completed INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Training progress
CREATE TABLE IF NOT EXISTS training_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    training_id TEXT NOT NULL,
    completed_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Shop purchases log
CREATE TABLE IF NOT EXISTS shop_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    price_gems INTEGER,
    price_coins INTEGER,
    purchased_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- PVP matches
CREATE TABLE IF NOT EXISTS pvp_matches (
    id TEXT PRIMARY KEY,
    attacker_id TEXT NOT NULL,
    defender_id TEXT NOT NULL,
    winner_id TEXT,
    attacker_rating_change INTEGER,
    defender_rating_change INTEGER,
    battle_log TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (attacker_id) REFERENCES users(id),
    FOREIGN KEY (defender_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_mission_progress_user ON mission_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_attacker ON pvp_matches(attacker_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_defender ON pvp_matches(defender_id);
\;

function init() {
    db.exec(schema);
    console.log('Database initialized');
    return db;
}

function getDb() {
    return db;
}

module.exports = { init, getDb };
