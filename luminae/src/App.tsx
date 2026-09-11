import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Crosshair,
  Info,
  Package,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Undo2,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';

type TileType = 'oxygen' | 'scavenge' | 'luminae' | 'signal' | 'blank';
type ResourceKey = 'oxygen' | 'scavenge' | 'luminae' | 'signal';
type ActionMode = 'move' | 'claim' | 'attack' | 'build';
type GameState = 'playing' | 'paused' | 'gameover' | 'victory';
type EnemyKind = 'drifter' | 'razor' | 'siege';
type BlockResources = Partial<Record<ResourceKey, number>>;

type Resources = Record<ResourceKey, number>;
type FeedItem = { id: number; label: string; text: string };
type Projectile = {
  id: number;
  from: [number, number];
  to: [number, number];
  progress: number;
  source: 'player' | 'turret';
};
type Enemy = {
  id: number;
  x: number;
  y: number;
  kind: EnemyKind;
  hp: number;
  damage: number;
  movement: number;
};
type TurretStats = {
  damage: number;
  interval: number;
};
type Upgrades = {
  movement: number;
  claim: number;
  hull: number;
  movementSpan: number;
  attackDamage: number;
  attackRange: number;
  attacks: number;
  luck: number;
  health: number;
};
type Snapshot = {
  boardSize: number;
  player: [number, number];
  claimed: string[];
  resources: Resources;
  upgrades: Upgrades;
  enemies: Enemy[];
  blockHp: Record<string, number>;
  blockResources: Record<string, BlockResources>;
  turrets: string[];
  turretStats: Record<string, TurretStats>;
  turretBlueprint: TurretStats;
  playerHp: number;
  movement: number;
  claimBudget: number;
  attackBudget: number;
  xp: number;
  xpLevel: number;
  xpBank: number;
  feed: FeedItem[];
  edgeWarning: boolean;
  lossReason: string;
  gameState: GameState;
};

const initialResources: Resources = {
  oxygen: 74,
  scavenge: 18,
  luminae: 1,
  signal: 3,
};

const initialUpgrades: Upgrades = {
  movement: 0,
  claim: 0,
  hull: 0,
  movementSpan: 0,
  attackDamage: 0,
  attackRange: 0,
  attacks: 0,
  luck: 0,
  health: 0,
};

const initialClaimed = ['4:4', '4:5', '5:4', '3:4'];
const initialBlockHp: Record<string, number> = Object.fromEntries(
  initialClaimed.map((tileKey) => [tileKey, 5]),
);
const initialBlockResources: Record<string, BlockResources> = {
  '4:4': { signal: 1 },
  '4:5': { oxygen: 1 },
  '5:4': { scavenge: 5 },
  '3:4': { oxygen: 1 },
};

const OXYGEN_SURVIVAL_MINIMUM = 1;
const MAX_WAVES = 6;
const PLAYER_MOVE_SPEED = 2.8;
const ENEMY_MOVE_SPEED = 3.7;
const PLAYER_BASE_HP = 10;
const RESOURCE_CLAIM_RADIUS = 0.48;
const WEAPON_COOLDOWN_SECONDS = 0.55;
const ENEMY_CONTACT_INTERVAL = 2;
const ENEMY_ATTACK_RANGE = 2;
const TURRET_ATTACK_RANGE = 6;
const WEAPON_RANGE_BUFFER = 0.05;
const TURRET_FIRE_INTERVAL = 7;
const SIMULATION_RENDER_INTERVAL = 1 / 30;

const tileNames: Record<TileType, string> = {
  oxygen: 'Oxygen',
  scavenge: 'Scavenged resources',
  luminae: 'Luminae',
  signal: 'Signal / intel',
  blank: 'Open water',
};

const tileGlyphs: Record<TileType, string> = {
  oxygen: 'O₂',
  scavenge: 'R',
  luminae: 'L',
  signal: 'S',
  blank: '·',
};

const resourceForTile: Partial<Record<TileType, ResourceKey>> = {
  oxygen: 'oxygen',
  scavenge: 'scavenge',
  luminae: 'luminae',
  signal: 'signal',
};

const keyFor = (x: number, y: number) => `${x}:${y}`;
const xpThresholdFor = (level: number) => 10 * 2 ** Math.max(0, level - 1);
const waveIntervalFor = (completedWave: number) =>
  completedWave < 2 ? 5 : completedWave < 4 ? 4 : 3;

function tileTypeAt(x: number, y: number, boardSize: number): TileType {
  const value = (x * 17 + y * 31 + boardSize * 13 + x * y * 7) % 19;
  if (value === 2 || value === 11) return 'oxygen';
  if (value === 4 || value === 8 || value === 16) return 'scavenge';
  if (value === 6 || value === 15) return 'luminae';
  if (value === 9 || value === 14) return 'signal';
  return 'blank';
}

function resourceYieldAt(x: number, y: number, boardSize: number): BlockResources {
  const type = tileTypeAt(x, y, boardSize);
  const resource = resourceForTile[type];
  return resource ? { [resource]: resource === 'scavenge' ? 5 : 1 } : {};
}

function addOffsetToKey(tileKey: string, offset: number) {
  const [x, y] = tileKey.split(':').map(Number);
  return keyFor(x + offset, y + offset);
}

function neighbors(x: number, y: number, boardSize: number) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ].filter(([nextX, nextY]) => nextX >= 0 && nextY >= 0 && nextX < boardSize && nextY < boardSize) as [number, number][];
}

function connectedTerritoryKeys(claimedKeys: string[], coreKey: string, boardSize: number) {
  const claimedSet = new Set(claimedKeys);
  if (!claimedSet.has(coreKey)) return [];
  const [coreX, coreY] = coreKey.split(':').map(Number);
  const connected = new Set<string>([coreKey]);
  const queue: Array<[number, number]> = [[coreX, coreY]];

  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [nextX, nextY] of neighbors(x, y, boardSize)) {
      const nextKey = keyFor(nextX, nextY);
      if (claimedSet.has(nextKey) && !connected.has(nextKey)) {
        connected.add(nextKey);
        queue.push([nextX, nextY]);
      }
    }
  }

  return claimedKeys.filter((tileKey) => connected.has(tileKey));
}

function findPathToTerritory(
  start: [number, number],
  claimedKeys: string[],
  boardSize: number,
) {
  const claimedSet = new Set(claimedKeys);
  const queue: Array<{ position: [number, number]; path: Array<[number, number]> }> = [
    { position: start, path: [] },
  ];
  const visited = new Set([keyFor(start[0], start[1])]);

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of neighbors(current.position[0], current.position[1], boardSize)) {
      const nextKey = keyFor(next[0], next[1]);
      const nextPath = [...current.path, next];
      if (claimedSet.has(nextKey)) return nextPath;
      if (!visited.has(nextKey)) {
        visited.add(nextKey);
        queue.push({ position: next, path: nextPath });
      }
    }
  }
  return [];
}

function edgeSpawnPositions(boardSize: number, count: number): Array<[number, number]> {
  const candidates: Array<[number, number]> = [];
  const seen = new Set<string>();
  const addCandidate = (x: number, y: number) => {
    const tileKey = keyFor(x, y);
    if (!seen.has(tileKey)) {
      seen.add(tileKey);
      candidates.push([x, y]);
    }
  };
  for (let index = 0; index < boardSize && candidates.length < count; index += 2) {
    addCandidate(index, 0);
    if (candidates.length < count) addCandidate(boardSize - 1, boardSize - 1 - index);
    if (candidates.length < count) addCandidate(boardSize - 1 - index, boardSize - 1);
    if (candidates.length < count) addCandidate(0, index);
  }
  return candidates.slice(0, count);
}

function enemyStats(kind: EnemyKind, wave: number) {
  const waveUpgrade = Math.max(0, wave - 1);
  if (kind === 'razor') return { hp: 1 + waveUpgrade, damage: 2 + waveUpgrade, movement: 2 + waveUpgrade };
  if (kind === 'siege') return { hp: 4 + waveUpgrade, damage: 2 + waveUpgrade, movement: 1 + waveUpgrade };
  return { hp: 2 + waveUpgrade, damage: 2 + waveUpgrade, movement: 1 + waveUpgrade };
}

function App() {
  const [boardSize, setBoardSize] = useState(8);
  const [player, setPlayer] = useState<[number, number]>([4, 4]);
  const [claimed, setClaimed] = useState<string[]>(initialClaimed);
  const [resources, setResources] = useState<Resources>(initialResources);
  const [upgrades, setUpgrades] = useState<Upgrades>(initialUpgrades);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [blockHp, setBlockHp] = useState<Record<string, number>>(initialBlockHp);
  const [blockResources, setBlockResources] = useState<Record<string, BlockResources>>(initialBlockResources);
  const [turrets, setTurrets] = useState<string[]>([]);
  const [turretStats, setTurretStats] = useState<Record<string, TurretStats>>({});
  const [turretBlueprint, setTurretBlueprint] = useState<TurretStats>({ damage: 2, interval: TURRET_FIRE_INTERVAL });
  const [selectedTurretKey, setSelectedTurretKey] = useState<string | null>(null);
  const [playerHp, setPlayerHp] = useState(PLAYER_BASE_HP);
  const [turn, setTurn] = useState(1);
  const [wave, setWave] = useState(0);
  const [intensity, setIntensity] = useState(1);
  const [turnsSinceWave, setTurnsSinceWave] = useState(0);
  const [movement, setMovement] = useState(3);
  const [claimBudget, setClaimBudget] = useState(2);
  const [attackBudget, setAttackBudget] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpLevel, setXpLevel] = useState(1);
  const [xpBank, setXpBank] = useState(0);
  const [mode, setMode] = useState<ActionMode>('move');
  const [gameState, setGameState] = useState<GameState>('playing');
  const [phase, setPhase] = useState<'play' | 'wave'>('play');
  const [edgeWarning, setEdgeWarning] = useState(false);
  const [miraUnlocked, setMiraUnlocked] = useState(false);
  const [lossReason, setLossReason] = useState('');
  const [selectedEnemyId, setSelectedEnemyId] = useState<number | null>(null);
  const [attackCooldown, setAttackCooldown] = useState(0);
  const [weaponFlash, setWeaponFlash] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: 1, label: 'T+00', text: 'Kael is online. Core territory is holding.' },
      { id: 2, label: 'LOG', text: 'Claiming covers the full 3 × 3 zone around Kael, but every block must stay connected to the core.' },
  ]);
  const historyRef = useRef<Snapshot[]>([]);
  const stateRef = useRef<Snapshot | null>(null);
  const playerRef = useRef<[number, number]>(player);
  const enemiesRef = useRef<Enemy[]>(enemies);
  const keysRef = useRef(new Set<string>());
  const attackCooldownRef = useRef(0);
  const turretTimersRef = useRef<Record<string, number>>({});
  const playerDamageTimerRef = useRef(0);
  const playerHpRef = useRef(playerHp);
  const renderAccumulatorRef = useRef(0);
  const projectileIdRef = useRef(0);
  const expansionLockRef = useRef(false);
  playerRef.current = player;
  enemiesRef.current = enemies;
  playerHpRef.current = playerHp;

  const tiles = useMemo(
    () =>
      Array.from({ length: boardSize * boardSize }, (_, index) => {
        const x = index % boardSize;
        const y = Math.floor(index / boardSize);
        return { x, y, type: tileTypeAt(x, y, boardSize) };
      }),
    [boardSize],
  );

  const boardIsExpanded = boardSize > 8;
  const movementMax = 3 + upgrades.movement;
  const movementSpeed = PLAYER_MOVE_SPEED + upgrades.movement * 0.35;
  const movementSpan = 1 + upgrades.movementSpan;
  const claimMax = 2 + upgrades.claim;
  const attackDamage = 1 + upgrades.attackDamage;
  const attackRange = 1 + upgrades.attackRange;
  const attacksPerTurn = 1 + upgrades.attacks;
  const luckDropBonus = upgrades.luck;
  const playerMaxHp = PLAYER_BASE_HP + upgrades.health * 2;
  const xpToNext = xpThresholdFor(xpLevel);
  const waveInterval = waveIntervalFor(wave);
  const nextWaveIn = Math.max(1, waveInterval - turnsSinceWave);
  const coreKey = keyFor(boardSize > 8 ? 6 : 4, boardSize > 8 ? 6 : 4);
  const playerKey = keyFor(player[0], player[1]);
  const outerBuffer = (x: number, y: number) =>
    x <= 1 || y <= 1 || x >= boardSize - 2 || y >= boardSize - 2;
  const atOuterEdge = (x: number, y: number) =>
    x === 0 || y === 0 || x === boardSize - 1 || y === boardSize - 1;
  const unclaimedResourceTiles = tiles.filter((tile) => {
    const resource = resourceForTile[tile.type];
    return resource && !claimed.includes(keyFor(tile.x, tile.y));
  });
  const unclaimedClaimTiles = tiles.filter((tile) => !claimed.includes(keyFor(tile.x, tile.y)));
  const claimTarget = unclaimedClaimTiles
    .filter((tile) => {
      const tileKey = keyFor(tile.x, tile.y);
      return connectedTerritoryKeys([...claimed, tileKey], coreKey, boardSize).includes(tileKey);
    })
    .sort(
      (a, b) =>
        Math.hypot(player[0] - a.x, player[1] - a.y) -
        Math.hypot(player[0] - b.x, player[1] - b.y),
    )[0] ?? null;
  const claimTargetDistance = claimTarget
    ? Math.hypot(player[0] - claimTarget.x, player[1] - claimTarget.y)
    : Number.POSITIVE_INFINITY;
  const canClaimTarget = claimTargetDistance <= RESOURCE_CLAIM_RADIUS;
  const allResourcesClaimed = unclaimedResourceTiles.length === 0;

  const snapshot = (): Snapshot => ({
    boardSize,
    player: [...player] as [number, number],
    claimed: [...claimed],
    resources: { ...resources },
    upgrades: { ...upgrades },
    enemies: enemies.map((enemy) => ({ ...enemy })),
    blockHp: { ...blockHp },
    blockResources: Object.fromEntries(
      Object.entries(blockResources).map(([tileKey, resourceMap]) => [tileKey, { ...resourceMap }]),
    ),
    turrets: [...turrets],
    turretStats: Object.fromEntries(Object.entries(turretStats).map(([key, stats]) => [key, { ...stats }])),
    turretBlueprint: { ...turretBlueprint },
    playerHp,
    movement,
    claimBudget,
    attackBudget,
    xp,
    xpLevel,
    xpBank,
    feed: [...feed],
    edgeWarning,
    lossReason,
    gameState,
  });
  stateRef.current = snapshot();

  const addFeed = (text: string, label = `T+${String(turn).padStart(2, '0')}`) => {
    setFeed((current) => [
      { id: Date.now() + Math.random(), label, text },
      ...current,
    ].slice(0, 8));
  };

  const captureAction = () => {
    if (gameState === 'playing' && phase === 'play' && stateRef.current) {
      historyRef.current.push(stateRef.current);
    }
  };

  const restoreSnapshot = (saved: Snapshot) => {
    setBoardSize(saved.boardSize);
    setPlayer(saved.player);
    setClaimed(saved.claimed);
    setResources(saved.resources);
    setUpgrades(saved.upgrades);
    setEnemies(saved.enemies);
    setBlockHp(saved.blockHp);
    setBlockResources(saved.blockResources);
    setTurrets(saved.turrets);
    setTurretStats(saved.turretStats);
    setTurretBlueprint(saved.turretBlueprint);
    setSelectedTurretKey(null);
    setPlayerHp(saved.playerHp);
    setMovement(saved.movement);
    setClaimBudget(saved.claimBudget);
    setAttackBudget(saved.attackBudget);
    setXp(saved.xp);
    setXpLevel(saved.xpLevel);
    setXpBank(saved.xpBank);
    setFeed(saved.feed);
    setEdgeWarning(saved.edgeWarning);
    setLossReason(saved.lossReason);
    setGameState(saved.gameState);
  };

  const undoAction = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const saved = historyRef.current.pop();
    if (!saved) return;
    restoreSnapshot(saved);
    addFeed('Last action undone. The timeline has been rewound within this turn.', 'UNDO');
  };

  const resetGame = () => {
    historyRef.current = [];
    setBoardSize(8);
    setPlayer([4, 4]);
    setClaimed(initialClaimed);
    setResources(initialResources);
    setUpgrades(initialUpgrades);
    setEnemies([]);
    setBlockHp(initialBlockHp);
    setBlockResources(initialBlockResources);
    setTurrets([]);
    setTurretStats({});
    setTurretBlueprint({ damage: 2, interval: TURRET_FIRE_INTERVAL });
    setSelectedTurretKey(null);
    setPlayerHp(PLAYER_BASE_HP);
    setTurn(1);
    setWave(0);
    setIntensity(1);
    setTurnsSinceWave(0);
    setMovement(3);
    setClaimBudget(2);
    setAttackBudget(1);
    setXp(0);
    setXpLevel(1);
    setXpBank(0);
    setMode('move');
    setPhase('play');
    setGameState('playing');
    setEdgeWarning(false);
    setMiraUnlocked(false);
    setLossReason('');
    setSelectedEnemyId(null);
    attackCooldownRef.current = 0;
    turretTimersRef.current = {};
    playerDamageTimerRef.current = 0;
    renderAccumulatorRef.current = 0;
    projectileIdRef.current = 0;
    setAttackCooldown(0);
    setWeaponFlash(null);
    setProjectiles([]);
    expansionLockRef.current = false;
    setFeed([
      { id: Date.now(), label: 'T+00', text: 'Campaign restarted. Core territory is holding.' },
      { id: Date.now() + 1, label: 'LOG', text: 'Two claim actions reach Kael’s 3 × 3 zone. Every block must stay connected to the core; Luck improves capture drops.' },
    ]);
  };

  const expandBoard = (x: number, y: number) => {
    const offset = 2;
    setBoardSize((current) => current + 4);
    setPlayer([x + offset, y + offset]);
    setClaimed((current) => current.map((tileKey) => addOffsetToKey(tileKey, offset)));
    setTurrets((current) => current.map((tileKey) => addOffsetToKey(tileKey, offset)));
    setTurretStats((current) => Object.fromEntries(Object.entries(current).map(([tileKey, stats]) => [addOffsetToKey(tileKey, offset), stats])));
    setBlockHp((current) =>
      Object.fromEntries(Object.entries(current).map(([tileKey, hp]) => [addOffsetToKey(tileKey, offset), hp])),
    );
    setBlockResources((current) =>
      Object.fromEntries(Object.entries(current).map(([tileKey, stored]) => [addOffsetToKey(tileKey, offset), stored])),
    );
    setEdgeWarning(false);
    addFeed('Chart boundary breached. New water is being rendered around the settlement.', 'AUTO');
  };

  const handleMove = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    setPlayer([x, y]);
  };

  const claimBlockUnderPlayer = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    if (!claimTarget) {
      addFeed(
        allResourcesClaimed
          ? 'Every reachable block in this chart is claimed. Reach the outer ring to expand the map.'
          : 'No connected block is close enough. Stand directly over the highlighted resource or empty block.',
        'CLAIM',
      );
      return;
    }
    if (!canClaimTarget) {
      addFeed(
        `Move onto the highlighted ${tileNames[tileTypeAt(claimTarget.x, claimTarget.y, boardSize)]} block to claim it.`,
        'CLAIM',
      );
      return;
    }
    const x = claimTarget.x;
    const y = claimTarget.y;
    const tileKey = keyFor(x, y);
    if (claimed.includes(tileKey)) {
      return;
    }
    const prospectiveTerritory = [...claimed, tileKey];
    if (!connectedTerritoryKeys(prospectiveTerritory, coreKey, boardSize).includes(tileKey)) {
      addFeed('That resource is not connected to the core. All claimed blocks must remain connected.', 'GRID');
      return;
    }
    if (claimBudget <= 0) {
      addFeed('Claim reserve exhausted. End the turn to restore claim actions.', 'CLAIM');
      return;
    }
    captureAction();
    const type = tileTypeAt(x, y, boardSize);
    const resource = resourceForTile[type];
    const baseStored = resourceYieldAt(x, y, boardSize);
    const stored = Object.fromEntries(
      Object.entries(baseStored).map(([resourceKey, amount]) => [resourceKey, (amount ?? 0) + luckDropBonus]),
    ) as BlockResources;
    setClaimed((current) => [...current, tileKey]);
    setBlockHp((current) => ({ ...current, [tileKey]: 5 }));
    setBlockResources((current) => ({ ...current, [tileKey]: stored }));
    setClaimBudget((current) => current - 1);
    if (resource) {
      const yieldAmount = stored[resource] ?? 0;
      setResources((current) => ({ ...current, [resource]: current[resource] + yieldAmount }));
      addFeed(`${tileNames[type]} secured. ${tileNames[type]} drop +${yieldAmount}${luckDropBonus ? ` · Luck +${luckDropBonus}` : ''}.`);
      if (unclaimedResourceTiles.length === 1) {
        addFeed('All resources in this chart are claimed. The outer ring is now unlocked.', 'MAP');
      }
      return;
    }
    addFeed('Empty ground secured. This block is now eligible for turret construction.', 'BUILD');
  };

  const grantExperience = (amount: number) => {
    let nextXp = xp + amount;
    let nextLevel = xpLevel;
    let levelsGained = 0;
    while (nextXp >= xpThresholdFor(nextLevel)) {
      nextXp -= xpThresholdFor(nextLevel);
      nextLevel += 1;
      levelsGained += 1;
    }
    setXp(nextXp);
    setXpLevel(nextLevel);
    if (levelsGained) setXpBank((current) => current + levelsGained);
    addFeed(
      `Combat salvage +${amount} progress${levelsGained ? ` · ${levelsGained} XP reward${levelsGained === 1 ? '' : 's'} earned · level ${nextLevel} reached` : ''}.`,
      'XP',
    );
  };

  const handleAttack = (enemyId: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const enemy = enemies.find((candidate) => candidate.id === enemyId);
    if (!enemy) {
      return;
    }
    if (selectedEnemyId !== null && selectedEnemyId !== enemyId) {
      addFeed('Kael is already locked onto one hostile. Finish that target before switching.', 'COMBAT');
      return;
    }
    setSelectedEnemyId(enemyId);
    const distance = Math.hypot(player[0] - enemy.x, player[1] - enemy.y);
    if (distance > attackRange + WEAPON_RANGE_BUFFER) {
      addFeed(`Hostile is outside Kael’s attack range of ${attackRange} tiles.`, 'COMBAT');
      return;
    }
    if (attackCooldownRef.current > 0) {
      addFeed(`Weapon cycling. Ready in ${attackCooldownRef.current.toFixed(1)}s.`, 'COMBAT');
      return;
    }
    captureAction();
    const remainingHp = enemy.hp - attackDamage;
    attackCooldownRef.current = WEAPON_COOLDOWN_SECONDS;
    setAttackCooldown(WEAPON_COOLDOWN_SECONDS);
    setWeaponFlash({
      from: [...player] as [number, number],
      to: [enemy.x, enemy.y],
    });
    setProjectiles((current) => [...current, {
      id: projectileIdRef.current++,
      from: [...player] as [number, number],
      to: [enemy.x, enemy.y],
      progress: 0,
      source: 'player',
    }]);
    window.setTimeout(() => setWeaponFlash(null), 160);
    if (remainingHp <= 0) {
      setEnemies((current) => current.filter((candidate) => candidate.id !== enemy.id));
      setSelectedEnemyId(null);
      addFeed(`Kael dealt ${attackDamage} damage to ${enemy.kind}; target neutralized.`, 'COMBAT');
      grantExperience(enemy.kind === 'razor' ? 4 : enemy.kind === 'siege' ? 10 : 6);
    } else {
      setEnemies((current) => current.map((candidate) => candidate.id === enemy.id ? { ...candidate, hp: remainingHp } : candidate));
      addFeed(`Kael damaged ${enemy.kind} for ${attackDamage}. ${remainingHp} HP remains.`, 'COMBAT');
    }
  };

  const handleBuildTurret = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const tileKey = keyFor(x, y);
    const distance = Math.abs(player[0] - x) + Math.abs(player[1] - y);
    if (distance > 1) {
      addFeed('Turrets must be built on adjacent neutral water.');
      return;
    }
    if (tileTypeAt(x, y, boardSize) !== 'blank' || !claimed.includes(tileKey) || turrets.includes(tileKey)) {
      addFeed('Turrets require an empty block that is already claimed.');
      return;
    }
    if (resources.luminae < 1) {
      addFeed('One Luminae growth unit is required to build a turret.', 'BUILD');
      return;
    }
    captureAction();
    setResources((current) => ({ ...current, luminae: current.luminae - 1 }));
    setTurrets((current) => [...current, tileKey]);
    setTurretStats((current) => ({ ...current, [tileKey]: { ...turretBlueprint } }));
    turretTimersRef.current[tileKey] = 0;
    addFeed(`Luminae turret built. It deals ${turretBlueprint.damage} damage every ${turretBlueprint.interval}s within 6 tiles.`, 'BUILD');
  };

  const fireTurrets = (enemyPool: Enemy[], firingTurretKeys = turrets) => {
    if (!firingTurretKeys.length || !enemyPool.length) return { enemies: enemyPool, kills: 0 };
    const hitIds = new Set<number>();
    let nextEnemies = enemyPool.map((enemy) => ({ ...enemy }));
    firingTurretKeys.forEach((turretKey) => {
      const nearestEnemy = nextEnemies
        .filter((enemy) => !hitIds.has(enemy.id))
        .map((enemy) => ({ enemy, distance: Math.abs(Number(turretKey.split(':')[0]) - enemy.x) + Math.abs(Number(turretKey.split(':')[1]) - enemy.y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearestEnemy || nearestEnemy.distance > TURRET_ATTACK_RANGE) return;
      const nearestTurret = turretKey.split(':').map(Number) as [number, number];
      setProjectiles((current) => [...current, {
        id: projectileIdRef.current++,
        from: nearestTurret,
        to: [nearestEnemy.enemy.x, nearestEnemy.enemy.y],
        progress: 0,
        source: 'turret',
      }]);
      const stats = turretStats[turretKey] ?? turretBlueprint;
      const nextHp = nearestEnemy.enemy.hp - stats.damage;
      if (nextHp <= 0) hitIds.add(nearestEnemy.enemy.id);
      if (nextHp > 0) {
        addFeed(`Turret damaged ${nearestEnemy.enemy.kind} ${stats.damage} HP. ${Math.max(0, nextHp)} HP remains.`, 'TURRET');
      }
      nextEnemies = nextEnemies.map((enemy) => enemy.id === nearestEnemy.enemy.id ? { ...enemy, hp: nextHp } : enemy);
    });
    nextEnemies = nextEnemies.filter((enemy) => !hitIds.has(enemy.id));
    if (hitIds.size) {
      addFeed(`${hitIds.size} hostile${hitIds.size === 1 ? '' : 's'} took turret damage and were destroyed.`, 'TURRET');
      grantExperience(hitIds.size * 5);
    } else addFeed('Turret shot registered within the 6-tile perimeter.', 'TURRET');
    return { enemies: nextEnemies, kills: hitIds.size };
  };

  const resolveWave = (enemyPool: Enemy[]) => {
    const nextWave = wave + 1;
    const newEnemyCount = Math.min(2 + intensity, 6);
    const newEnemies = edgeSpawnPositions(boardSize, newEnemyCount).map(([x, y], index) => {
      const kind: EnemyKind = nextWave >= 3 && index % 4 === 0
        ? 'siege'
        : index % 3 === 0
          ? 'razor'
          : 'drifter';
      return { id: nextWave * 100 + index, x, y, kind, ...enemyStats(kind, nextWave) };
    });
    const activeEnemies = [...enemyPool, ...newEnemies];
    // Enemies now travel continuously between turns. Resolution only applies
    // damage when an enemy is physically over a claimed block.
    const movedEnemies = activeEnemies;

    const nextBlockHp = { ...blockHp };
    const damageByTile: Record<string, number> = {};
    movedEnemies
      .map((enemy) => ({
        enemy,
        tileKey: claimed.find((claimedKey) => {
          const [tileX, tileY] = claimedKey.split(':').map(Number);
          return Math.hypot(enemy.x - tileX, enemy.y - tileY) <= 0.75;
        }),
      }))
      .filter(({ tileKey }) => Boolean(tileKey))
      .forEach((enemy) => {
        const tileKey = enemy.tileKey!;
        const effectiveDamage = Math.max(1, enemy.enemy.damage - upgrades.hull);
        damageByTile[tileKey] = (damageByTile[tileKey] ?? 0) + effectiveDamage;
        nextBlockHp[tileKey] = (nextBlockHp[tileKey] ?? 5) - effectiveDamage;
        addFeed(`Enemy damaged claimed block ${tileKey} for ${effectiveDamage}. ${Math.max(0, nextBlockHp[tileKey])} HP remains.`, 'GRID');
      });

    const destroyedTiles = Object.keys(damageByTile).filter((tileKey) => nextBlockHp[tileKey] <= 0);
    const remainingAfterDamage = claimed.filter((tileKey) => !destroyedTiles.includes(tileKey));
    const connectedAfterDamage = new Set(connectedTerritoryKeys(remainingAfterDamage, coreKey, boardSize));
    const disconnectedTiles = remainingAfterDamage.filter((tileKey) => !connectedAfterDamage.has(tileKey));
    const removedTiles = [...new Set([...destroyedTiles, ...disconnectedTiles])];
    const remainingTerritory = remainingAfterDamage.filter((tileKey) => connectedAfterDamage.has(tileKey));
    const lostResources: Partial<Resources> = {};
    removedTiles.forEach((tileKey) => {
      Object.entries(blockResources[tileKey] ?? {}).forEach(([resource, amount]) => {
        const resourceKey = resource as ResourceKey;
        lostResources[resourceKey] = (lostResources[resourceKey] ?? 0) + (amount ?? 0);
      });
    });
    const oxygenLoss = Math.max(1, 2 + intensity + (nextWave >= 4 ? 1 : 0) - upgrades.hull);
    const nextOxygen = Math.max(0, resources.oxygen - oxygenLoss);
    const nextIntensity = Math.min(5, intensity + 1);
    const remainingResources = { ...resources, oxygen: nextOxygen };
    if (oxygenLoss > 0) addFeed(`Wave pressure damaged oxygen reserves by ${oxygenLoss}. ${nextOxygen} O2 remains.`, 'LIFE');
    (Object.keys(lostResources) as ResourceKey[]).forEach((resource) => {
      remainingResources[resource] -= lostResources[resource] ?? 0;
    });

    setEnemies(movedEnemies);
    setBlockHp(Object.fromEntries(Object.entries(nextBlockHp).filter(([tileKey]) => connectedAfterDamage.has(tileKey))));
    setClaimed(remainingTerritory);
    setBlockResources((current) => {
      const next = { ...current };
      removedTiles.forEach((tileKey) => delete next[tileKey]);
      return next;
    });
    setTurrets((current) => current.filter((tileKey) => connectedAfterDamage.has(tileKey)));
    setResources(remainingResources);
    setWave(nextWave);
    setIntensity(nextIntensity);
    setPhase('wave');

    const damagedCount = Object.keys(damageByTile).length;
    addFeed(
      `Wave ${String(nextWave).padStart(2, '0')} resolved. ${newEnemies.length} entities entered; ${damagedCount} block${damagedCount === 1 ? '' : 's'} damaged, ${destroyedTiles.length} destroyed, ${disconnectedTiles.length} unlinked; oxygen -${oxygenLoss}.`,
      'WAVE',
    );
    if (removedTiles.length) {
      const lossSummary = (Object.keys(lostResources) as ResourceKey[])
        .filter((resource) => (lostResources[resource] ?? 0) > 0)
        .map((resource) => `-${lostResources[resource]} ${resource}`)
        .join(', ');
      addFeed(`Blocks no longer connected to the core were removed; stored resources were lost${lossSummary ? ` (${lossSummary})` : ''}.`, 'GRID');
    }
    if (nextWave >= 2 && !miraUnlocked) {
      setMiraUnlocked(true);
      addFeed('Mira: “The signal is not hunting us. It is asking us to listen.”', 'MIRA');
    }

    const coreSurvives = remainingTerritory.includes(coreKey);
    const reasons: string[] = [];
    if (remainingResources.oxygen < OXYGEN_SURVIVAL_MINIMUM) reasons.push(`oxygen fell below the survival minimum of ${OXYGEN_SURVIVAL_MINIMUM}`);
    if (remainingTerritory.length < 3) reasons.push('fewer than 3 claimed blocks remained');
    if (!coreSurvives) reasons.push('the core block was destroyed');
    if (reasons.length) {
      const reason = `You lost because ${reasons.join(' and ')}.`;
      setLossReason(reason);
      setGameState('gameover');
      addFeed(reason, 'FAIL');
    } else if (nextWave >= MAX_WAVES) {
      setGameState('victory');
      addFeed('The outpost is stable enough for a deep-dive. The Mourner is waiting below.', 'CLEAR');
    }
    window.setTimeout(() => setPhase('play'), 900);
  };

  const endTurn = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    historyRef.current = [];
    const nextTurn = turn + 1;
    const nextTurnsSinceWave = turnsSinceWave + 1;
    setTurn(nextTurn);
    setMovement(movementMax);
    setClaimBudget(claimMax);
    setAttackBudget(attacksPerTurn);
    setEdgeWarning(false);
    addFeed(`Turn ${String(nextTurn).padStart(2, '0')} ready. Movement, claims, and attacks restored.`);
    if (nextTurnsSinceWave >= waveInterval) {
      setTurnsSinceWave(0);
      resolveWave(enemies);
    } else {
      setTurnsSinceWave(nextTurnsSinceWave);
    }
  };

  const spendResources = (label: string, cost: Partial<Resources>, apply: () => void) => {
    const canAfford = Object.entries(cost).every(([key, amount]) => resources[key as ResourceKey] >= (amount ?? 0));
    if (!canAfford) {
      addFeed(`Insufficient reserves for ${label.toLowerCase()}. Use 1 XP instead or gather more territory.`, 'UPGRADE');
      return;
    }
    captureAction();
    setResources((current) => ({
      ...current,
      ...Object.fromEntries(
        (Object.keys(cost) as ResourceKey[]).map((key) => [key, current[key] - (cost[key] ?? 0)]),
      ),
    }));
    apply();
    addFeed(`${label} online using reserve materials.`, 'UPGRADE');
  };

  const spendExperience = (label: string, cost: number, apply: () => void) => {
    if (xpBank < cost) {
      addFeed(`Need ${cost} XP for ${label.toLowerCase()}. Eliminate more hostiles first.`, 'UPGRADE');
      return;
    }
    captureAction();
    setXpBank((current) => current - cost);
    apply();
    addFeed(`${label} online.`, 'UPGRADE');
  };

  const repairCost = 4;
  const healCost = 1;
  const healAmount = 4;
  const repairSettlement = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const damagedBlock = claimed
      .map((tileKey) => ({ tileKey, hp: blockHp[tileKey] ?? 5 }))
      .filter(({ hp }) => hp < 5)
      .sort((a, b) => a.hp - b.hp)[0];
    if (!damagedBlock) {
      addFeed('All claimed blocks are at full structural health.', 'SHOP');
      return;
    }
    if (resources.scavenge < repairCost) {
      addFeed(`Structural repair requires ${repairCost} R at wave ${wave}.`, 'SHOP');
      return;
    }
    captureAction();
    setResources((current) => ({ ...current, scavenge: current.scavenge - repairCost }));
    setBlockHp((current) => ({
      ...current,
      [damagedBlock.tileKey]: Math.min(5, (current[damagedBlock.tileKey] ?? 5) + 1),
    }));
    setResources((current) => ({ ...current, oxygen: current.oxygen + 5 }));
    addFeed(`Structural repair restored +1 HP and +5 oxygen for ${repairCost} R.`, 'SHOP');
  };

  const healPlayer = () => {
    if (gameState !== 'playing' || phase !== 'play' || playerHp >= playerMaxHp) return;
    if (resources.luminae < healCost) {
      addFeed('Healing requires 1 Luminae.', 'MED');
      return;
    }
    captureAction();
    const nextHp = Math.min(playerMaxHp, playerHp + healAmount);
    setResources((current) => ({ ...current, luminae: current.luminae - healCost }));
    playerHpRef.current = nextHp;
    setPlayerHp(nextHp);
    addFeed(`Luminae healing restored ${nextHp - playerHp} HP.`, 'MED');
  };

  const movementResourceCost = { scavenge: 8 + upgrades.movement * 4, signal: 1 };
  const claimResourceCost = { scavenge: 7 + upgrades.claim * 4, signal: 1 };
  const hullResourceCost = { scavenge: 10 + upgrades.hull * 5, luminae: 1 };

  const applyMovementRangeUpgrade = () => {
    setUpgrades((current) => ({ ...current, movement: current.movement + 1 }));
  };
  const applyClaimUpgrade = () => {
    setUpgrades((current) => ({ ...current, claim: current.claim + 1 }));
  };
  const applyHullUpgrade = () => {
    setUpgrades((current) => ({ ...current, hull: current.hull + 1 }));
  };
  const applyMovementSpanUpgrade = () => {
    setUpgrades((current) => ({ ...current, movementSpan: current.movementSpan + 1 }));
  };
  const applyDamageUpgrade = () => {
    setUpgrades((current) => ({ ...current, attackDamage: current.attackDamage + 1 }));
  };
  const applyRangeUpgrade = () => {
    setUpgrades((current) => ({ ...current, attackRange: current.attackRange + 1 }));
  };
  const applyAttacksUpgrade = () => {
    setUpgrades((current) => ({ ...current, attacks: current.attacks + 1 }));
  };
  const applyLuckUpgrade = () => {
    setUpgrades((current) => ({ ...current, luck: current.luck + 1 }));
  };
  const applyHealthUpgrade = () => {
    setUpgrades((current) => ({ ...current, health: current.health + 1 }));
    playerHpRef.current += 2;
    setPlayerHp((current) => current + 2);
  };

  const upgradeSelectedTurret = (kind: 'damage' | 'interval') => {
    if (!selectedTurretKey || !turrets.includes(selectedTurretKey)) {
      addFeed('Select a built turret on the chart first.', 'TURRET');
      return;
    }
    const current = turretStats[selectedTurretKey] ?? turretBlueprint;
    const next = kind === 'damage'
      ? { ...current, damage: current.damage + 1 }
      : { ...current, interval: Math.max(1, current.interval - 1) };
    const cost = kind === 'damage' ? 8 : 10;
    if (resources.scavenge < cost) {
      addFeed(`Selected turret upgrade requires ${cost} R.`, 'TURRET');
      return;
    }
    captureAction();
    setResources((value) => ({ ...value, scavenge: value.scavenge - cost }));
    setTurretStats((value) => ({ ...value, [selectedTurretKey]: next }));
    addFeed(`Selected turret ${kind} upgraded.`, 'TURRET');
  };

  const upgradeFutureTurret = (kind: 'damage' | 'interval') => {
    const next = kind === 'damage'
      ? { ...turretBlueprint, damage: turretBlueprint.damage + 1 }
      : { ...turretBlueprint, interval: Math.max(1, turretBlueprint.interval - 1) };
    if (resources.luminae < 1) {
      addFeed('Future turret upgrades require 1 Luminae.', 'TURRET');
      return;
    }
    captureAction();
    setResources((value) => ({ ...value, luminae: value.luminae - 1 }));
    setTurretBlueprint(next);
    addFeed(`Future turret ${kind} upgraded.`, 'TURRET');
  };

  const upgradeMovementResource = () => spendResources(`Movement speed // ${movementSpeed + 0.35}`, movementResourceCost, applyMovementRangeUpgrade);
  const upgradeClaimResource = () => spendResources(`Claim capacity // ${claimMax + 1}`, claimResourceCost, applyClaimUpgrade);
  const upgradeHullResource = () => spendResources(`Hull shielding // ${upgrades.hull + 1}`, hullResourceCost, applyHullUpgrade);
  const upgradeMovementXp = () => spendExperience(`Movement span // ${movementSpan + 1}`, 1, applyMovementSpanUpgrade);
  const upgradeDamageXp = () => spendExperience(`Attack damage // ${attackDamage + 1}`, 1, applyDamageUpgrade);
  const upgradeRangeXp = () => spendExperience(`Attack range // ${attackRange + 1}`, 1, applyRangeUpgrade);
  const upgradeAttacksXp = () => spendExperience(`Attacks per turn // ${attacksPerTurn + 1}`, 1, applyAttacksUpgrade);
  const upgradeLuckXp = () => spendExperience(`Luck // +${luckDropBonus + 1} capture drop`, 1, applyLuckUpgrade);
  const upgradeHealthXp = () => spendExperience(`Health // ${playerMaxHp + 2} HP`, 1, applyHealthUpgrade);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        undoAction();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) {
        event.preventDefault();
        keysRef.current.add(event.key.toLowerCase());
      }
      if (event.key === ' ' && !event.repeat) {
        event.preventDefault();
        if (selectedEnemyId !== null) handleAttack(selectedEnemyId);
      }
      if (event.key.toLowerCase() === 'c') {
        setMode('claim');
        if (!event.repeat) claimBlockUnderPlayer();
      }
      if (event.key.toLowerCase() === 'm') setMode('move');
      if (event.key.toLowerCase() === 'f') setMode('attack');
      if (event.key.toLowerCase() === 'b') setMode('build');
      if (event.key === 'Enter') endTurn();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  useEffect(() => {
    if (gameState !== 'playing' || phase !== 'play') return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const delta = Math.min(0.05, (time - previousTime) / 1000);
      previousTime = time;
      renderAccumulatorRef.current += delta;
      attackCooldownRef.current = Math.max(0, attackCooldownRef.current - delta);
      if (renderAccumulatorRef.current >= SIMULATION_RENDER_INTERVAL) {
        setAttackCooldown(attackCooldownRef.current);
        setProjectiles((current) => current
          .map((projectile) => ({
            ...projectile,
            progress: projectile.progress + renderAccumulatorRef.current / 0.16,
          }))
          .filter((projectile) => projectile.progress < 1));
      }

      const [currentX, currentY] = playerRef.current;
      const horizontal =
        (keysRef.current.has('d') || keysRef.current.has('arrowright') ? 1 : 0) -
        (keysRef.current.has('a') || keysRef.current.has('arrowleft') ? 1 : 0);
      const vertical =
        (keysRef.current.has('s') || keysRef.current.has('arrowdown') ? 1 : 0) -
        (keysRef.current.has('w') || keysRef.current.has('arrowup') ? 1 : 0);
      const directionLength = Math.hypot(horizontal, vertical);

      if (directionLength > 0) {
        const nextX = Math.max(0.35, Math.min(boardSize - 0.35, currentX + (horizontal / directionLength) * movementSpeed * delta));
        const nextY = Math.max(0.35, Math.min(boardSize - 0.35, currentY + (vertical / directionLength) * movementSpeed * delta));
        const touchingEdge = nextX <= 0.36 || nextY <= 0.36 || nextX >= boardSize - 0.36 || nextY >= boardSize - 0.36;

        if (touchingEdge && boardSize < 16) {
          if (allResourcesClaimed && !expansionLockRef.current) {
            expansionLockRef.current = true;
            expandBoard(Math.round(nextX), Math.round(nextY));
            window.setTimeout(() => {
              expansionLockRef.current = false;
            }, 450);
          } else if (!allResourcesClaimed) {
            setEdgeWarning(true);
          }
        } else {
          playerRef.current = [nextX, nextY];
          setPlayer([nextX, nextY]);
          if (!touchingEdge) setEdgeWarning(false);
        }
      }

      const firingTurrets = turrets.filter((turretKey) => {
        const stats = turretStats[turretKey] ?? turretBlueprint;
        turretTimersRef.current[turretKey] = (turretTimersRef.current[turretKey] ?? 0) + delta;
        if (turretTimersRef.current[turretKey] < stats.interval) return false;
        turretTimersRef.current[turretKey] -= stats.interval;
        return true;
      });
      if (firingTurrets.length && enemiesRef.current.length) {
        const turretResult = fireTurrets(enemiesRef.current, firingTurrets);
        enemiesRef.current = turretResult.enemies;
        setEnemies(turretResult.enemies);
      }

      const coreX = boardSize > 8 ? 6 : 4;
      const coreY = boardSize > 8 ? 6 : 4;
      setEnemies((current) => {
        if (!current.length) return current;
        let changed = false;
        const next = current.map((enemy) => {
            const needsHorizontalLeg = Math.abs(enemy.x - coreX) > 0.05;
            const waypointX = coreX;
            const waypointY = needsHorizontalLeg ? Math.round(enemy.y) : coreY;
            const dx = waypointX - enemy.x;
            const dy = waypointY - enemy.y;
            const distance = Math.hypot(dx, dy);
          if (distance <= 0.6) return enemy;
          const speed = ENEMY_MOVE_SPEED + Math.max(0, enemy.movement - 1) * 0.35;
          changed = true;
          return {
            ...enemy,
              x: Math.abs(dx) <= speed * delta ? waypointX : enemy.x + (dx / distance) * speed * delta,
              y: Math.abs(dy) <= speed * delta ? waypointY : enemy.y + (dy / distance) * speed * delta,
          };
        });
        return changed ? next : current;
      });

      playerDamageTimerRef.current += delta;
      while (playerDamageTimerRef.current >= ENEMY_CONTACT_INTERVAL && enemiesRef.current.length) {
        const nearbyEnemy = enemiesRef.current
          .map((enemy) => ({ enemy, distance: Math.hypot(enemy.x - playerRef.current[0], enemy.y - playerRef.current[1]) }))
          .filter(({ distance }) => distance <= ENEMY_ATTACK_RANGE)
          .sort((a, b) => a.distance - b.distance)[0];
        if (nearbyEnemy) {
          playerDamageTimerRef.current -= ENEMY_CONTACT_INTERVAL;
          const nextHp = Math.max(0, playerHpRef.current - nearbyEnemy.enemy.damage);
          playerHpRef.current = nextHp;
          setPlayerHp(nextHp);
          addFeed(`${nearbyEnemy.enemy.kind} contact damaged Kael for ${nearbyEnemy.enemy.damage}.`, 'DANGER');
          if (nextHp <= 0) {
            setLossReason('Kael was overwhelmed by hostile contact.');
            setGameState('gameover');
            addFeed('Kael is down. The settlement signal has gone silent.', 'FAIL');
            break;
          }
        } else {
          playerDamageTimerRef.current = 0;
          break;
        }
      }

      if (renderAccumulatorRef.current >= SIMULATION_RENDER_INTERVAL) renderAccumulatorRef.current = 0;

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [allResourcesClaimed, boardSize, gameState, phase, turretBlueprint, turretStats, turrets, upgrades.movement]);

  const togglePause = () => {
    if (gameState === 'playing') setGameState('paused');
    else if (gameState === 'paused') setGameState('playing');
  };

  const handleTileClick = (x: number, y: number) => {
    const clickedKey = keyFor(x, y);
    if (turrets.includes(clickedKey)) {
      setSelectedTurretKey(clickedKey);
      addFeed(`Turret ${clickedKey} selected for scrap upgrades.`, 'TURRET');
      return;
    }
    if (mode === 'move') {
      addFeed('Kael moves freely with WASD or the arrow keys. Click a resource only after standing over it.', 'MOVE');
    }
    if (mode === 'claim') claimBlockUnderPlayer();
    if (mode === 'attack') {
      const enemy = enemies.find((candidate) => Math.round(candidate.x) === x && Math.round(candidate.y) === y);
      if (enemy) handleAttack(enemy.id);
      else addFeed('No hostile contact at that coordinate.', 'COMBAT');
    }
    if (mode === 'build') handleBuildTurret(x, y);
  };

  const resourceShortNames: Record<ResourceKey, string> = {
    oxygen: 'O₂',
    scavenge: 'R',
    luminae: 'L',
    signal: 'S',
  };
  const formatResourceCost = (cost: Partial<Resources>) =>
    Object.entries(cost).map(([key, amount]) => `${amount} ${resourceShortNames[key as ResourceKey]}`).join(' + ');
  const canAffordResourceCost = (cost: Partial<Resources>) =>
    Object.entries(cost).every(([key, amount]) => resources[key as ResourceKey] >= (amount ?? 0));

  const resourceUpgradeRows = [
    { label: 'Movement speed', level: upgrades.movement, value: `SPD ${movementSpeed.toFixed(1)}`, cost: movementResourceCost, action: upgradeMovementResource },
    { label: 'Claim capacity', level: upgrades.claim, value: `CLM ${claimMax}`, cost: claimResourceCost, action: upgradeClaimResource },
    { label: 'Hull shielding', level: upgrades.hull, value: `HUL ${upgrades.hull}`, cost: hullResourceCost, action: upgradeHullResource },
  ];
  const xpUpgradeRows = [
    { label: 'Movement span', level: upgrades.movementSpan, value: `SPAN ${movementSpan}`, action: upgradeMovementXp },
    { label: 'Attack damage', level: upgrades.attackDamage, value: `DMG ${attackDamage}`, action: upgradeDamageXp },
    { label: 'Attack range', level: upgrades.attackRange, value: `RNG ${attackRange}`, action: upgradeRangeXp },
    { label: 'Attacks per turn', level: upgrades.attacks, value: `ATK ${attacksPerTurn}`, action: upgradeAttacksXp },
    { label: 'Luck', level: upgrades.luck, value: `DROP +${luckDropBonus}`, detail: '+1 resource per captured drop', action: upgradeLuckXp },
    { label: 'Kael health', level: upgrades.health, value: `HP ${playerMaxHp}`, detail: '+2 maximum HP', action: upgradeHealthXp },
  ];

  return (
    <main className="console-shell">
      <header className="console-header">
        <div className="wordmark"><span className="wordmark-mark" aria-hidden="true" /><span>LUMINAE</span></div>
        <div className="header-status"><span className="status-dot" /><span className="mono">OUTPOST // PELAGOS-03</span><span>LOCAL CAMPAIGN</span></div>
        <button className="console-button" onClick={togglePause} data-testid="button-pause" disabled={gameState === 'gameover' || gameState === 'victory'}>
          {gameState === 'paused' ? <Play size={14} /> : <Pause size={14} />}{gameState === 'paused' ? 'Resume' : 'Pause'}
        </button>
      </header>

      <div className="console-main">
        <section className="campaign-bar" aria-label="Campaign heading">
          <div><div className="eyebrow">Campaign / A01 / live chart</div><h1 className="campaign-title">The Shallows <span>/ Sector 01</span></h1></div>
          <div className="action-row">
            <button className="console-button" onClick={undoAction} disabled={!historyRef.current.length || gameState !== 'playing' || phase !== 'play'} data-testid="button-undo"><Undo2 size={14} /> Undo action</button>
            <button className="console-button danger" onClick={resetGame} data-testid="button-restart"><RotateCcw size={14} /> Restart campaign</button>
          </div>
        </section>

        <section className="hud-strip" aria-label="Campaign status">
          <div className="hud-stat"><span className="eyebrow">Wave</span><strong className="hud-stat-value" data-testid="status-wave">{String(wave).padStart(2, '0')} / 06</strong></div>
          <div className="hud-stat"><span className="eyebrow">Turn</span><strong className="hud-stat-value" data-testid="status-turn">{String(turn).padStart(2, '0')}</strong></div>
          <div className="hud-stat"><span className="eyebrow">Movement</span><strong className="hud-stat-value good" data-testid="status-movement">FREE · {movementSpeed.toFixed(1)} SPD</strong></div>
          <div className="hud-stat"><span className="eyebrow">Claim reserve</span><strong className="hud-stat-value warn" data-testid="status-claim">{claimBudget} / 02</strong></div>
          <div className="hud-stat"><span className="eyebrow">Weapon</span><strong className="hud-stat-value danger" data-testid="status-attack">{attackCooldown > 0 ? `READY ${attackCooldown.toFixed(1)}s` : `READY · ${attackRange} RNG`}</strong></div>
          <div className="hud-stat"><span className="eyebrow">Territory</span><strong className="hud-stat-value" data-testid="status-territory">{claimed.length} blocks</strong></div>
          <div className="hud-stat"><span className="eyebrow">Chart</span><strong className="hud-stat-value" data-testid="status-board">{boardSize} × {boardSize}</strong></div>
          <div className="hud-stat"><span className="eyebrow">Oxygen</span><strong className={`hud-stat-value ${resources.oxygen <= 10 ? 'danger' : 'good'}`} data-testid="status-oxygen">{resources.oxygen} / 100</strong></div>
          <div className="hud-stat"><span className="eyebrow">Kael HP</span><strong className={`hud-stat-value ${playerHp <= 3 ? 'danger' : 'good'}`} data-testid="status-player-hp">{playerHp} / {playerMaxHp}</strong></div>
        </section>

        <div className="game-layout">
          <section className={`board-frame ${phase === 'wave' ? 'wave-pulse' : ''}`} aria-label="Playable settlement chart">
            <div className="board-topline">
              <div><div className="board-title"><ScanLine size={14} /> Settlement territory</div><div className="board-coordinates">GRID {boardSize}×{boardSize} · KAEL {player[0].toString().padStart(2, '0')}:{player[1].toString().padStart(2, '0')}</div></div>
              <span className={`eyebrow ${phase === 'wave' ? 'text-destructive' : ''}`}>{phase === 'wave' ? 'WAVE RESOLVING' : mode === 'move' ? 'MOVE MODE' : mode === 'claim' ? 'CLAIM MODE' : mode === 'attack' ? 'ATTACK MODE' : 'BUILD MODE'}</span>
            </div>

            {edgeWarning && <div className="edge-banner" data-testid="status-edge-warning"><AlertTriangle size={16} /><span>Outer ring unstable. One more edge step will expand the chart by 4 × 4.</span></div>}

            <div className="grid-wrap">
              <div className="free-board">
                <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}>
                  {tiles.map((tile) => {
                    const tileKey = keyFor(tile.x, tile.y);
                    const isClaimed = claimed.includes(tileKey);
                    const isClaimTarget = claimTarget?.x === tile.x && claimTarget?.y === tile.y;
                    const isCore = tileKey === coreKey;
                    const isWarning = boardSize < 16 && outerBuffer(tile.x, tile.y);
                    const isTurret = turrets.includes(tileKey);
                    const resource = resourceForTile[tile.type];
                    return (
                      <button
                        key={tileKey}
                        className={`tile tile-type-${tile.type} ${isClaimed ? 'claimed' : 'neutral-tile'} ${isCore ? 'core' : ''} ${isClaimTarget ? 'claimable' : ''} ${isClaimTarget && canClaimTarget ? 'claim-ready' : ''} ${isWarning && edgeWarning ? 'edge-warning' : ''} ${isTurret ? 'turret-tile' : ''}`}
                        onClick={() => handleTileClick(tile.x, tile.y)}
                        data-testid={`tile-${tile.x}-${tile.y}`}
                        aria-label={`${tileNames[tile.type]} at ${tile.x}, ${tile.y}${resource ? ', resource node' : ''}${isClaimed ? `, claimed, ${blockHp[tileKey] ?? 5} HP` : ''}${isTurret ? ', turret' : ''}`}
                      >
                        <span className="tile-glyph">{isTurret ? 'T' : tileGlyphs[tile.type]}</span>
                        {isClaimed && <span className="tile-health">{blockHp[tileKey] ?? 5} HP</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="entity-layer" aria-label="Free movement layer">
                  <span
                    className="attack-range-ring player-range-ring"
                    style={{
                      left: `${((player[0] + 0.5) / boardSize) * 100}%`,
                      top: `${((player[1] + 0.5) / boardSize) * 100}%`,
                      width: `${(attackRange * 2 / boardSize) * 100}%`,
                      height: `${(attackRange * 2 / boardSize) * 100}%`,
                    }}
                    aria-hidden="true"
                  />
                  {turrets.map((turretKey) => {
                    const [turretX, turretY] = turretKey.split(':').map(Number);
                    return (
                      <span
                        key={`range-${turretKey}`}
                        className={`attack-range-ring turret-range-ring ${selectedTurretKey === turretKey ? 'selected-range' : ''}`}
                        style={{
                          left: `${((turretX + 0.5) / boardSize) * 100}%`,
                          top: `${((turretY + 0.5) / boardSize) * 100}%`,
                          width: `${(TURRET_ATTACK_RANGE * 2 / boardSize) * 100}%`,
                          height: `${(TURRET_ATTACK_RANGE * 2 / boardSize) * 100}%`,
                        }}
                        aria-hidden="true"
                      />
                    );
                  })}
                  {projectiles.map((projectile) => {
                    const currentX = projectile.from[0] + (projectile.to[0] - projectile.from[0]) * projectile.progress;
                    const currentY = projectile.from[1] + (projectile.to[1] - projectile.from[1]) * projectile.progress;
                    return (
                      <span
                        key={projectile.id}
                        className={`projectile-ray ${projectile.source}`}
                        style={{
                          left: `${((projectile.from[0] + 0.5) / boardSize) * 100}%`,
                          top: `${((projectile.from[1] + 0.5) / boardSize) * 100}%`,
                          width: `${(Math.hypot(currentX - projectile.from[0], currentY - projectile.from[1]) / boardSize) * 100}%`,
                          transform: `rotate(${Math.atan2(currentY - projectile.from[1], currentX - projectile.from[0])}rad)`,
                        }}
                      />
                    );
                  })}
                  {weaponFlash && (
                    <span
                      className="weapon-beam"
                      style={{
                        left: `${((weaponFlash.from[0] + 0.5) / boardSize) * 100}%`,
                        top: `${((weaponFlash.from[1] + 0.5) / boardSize) * 100}%`,
                        width: `${(Math.hypot(weaponFlash.to[0] - weaponFlash.from[0], weaponFlash.to[1] - weaponFlash.from[1]) / boardSize) * 100}%`,
                        transform: `rotate(${Math.atan2(weaponFlash.to[1] - weaponFlash.from[1], weaponFlash.to[0] - weaponFlash.from[0])}rad)`,
                      }}
                    />
                  )}
                  <span
                    className={`free-player ${mode === 'move' ? 'player-active' : ''}`}
                    style={{
                      left: `${((player[0] + 0.5) / boardSize) * 100}%`,
                      top: `${((player[1] + 0.5) / boardSize) * 100}%`,
                    }}
                    aria-label={`Kael at ${player[0].toFixed(1)}, ${player[1].toFixed(1)}`}
                  >
                    K
                  </span>
                  {enemies.map((enemy) => (
                    <span key={enemy.id} className="enemy-entity">
                      <span
                        className="attack-range-ring enemy-range-ring"
                        style={{
                          left: `${((enemy.x + 0.5) / boardSize) * 100}%`,
                          top: `${((enemy.y + 0.5) / boardSize) * 100}%`,
                          width: `${(ENEMY_ATTACK_RANGE * 2 / boardSize) * 100}%`,
                          height: `${(ENEMY_ATTACK_RANGE * 2 / boardSize) * 100}%`,
                        }}
                        aria-hidden="true"
                      />
                      <button
                        className={`free-enemy ${enemy.kind} ${selectedEnemyId === enemy.id ? 'selected' : ''}`}
                        style={{
                          left: `${((enemy.x + 0.5) / boardSize) * 100}%`,
                          top: `${((enemy.y + 0.5) / boardSize) * 100}%`,
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAttack(enemy.id);
                        }}
                        aria-label={`${enemy.kind} hostile at ${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)}, ${enemy.hp} HP`}
                      >
                        {enemy.kind === 'razor' ? 'RZ' : enemy.kind === 'siege' ? 'SG' : 'E'}
                        <span className="free-enemy-hp">{enemy.hp}</span>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="board-bottomline"><span><Crosshair size={13} /> {mode === 'move' ? `WASD / arrows move Kael freely · ${movementSpeed.toFixed(1)} speed` : mode === 'claim' ? `Stand over the highlighted block and press C · ${claimBudget} claim action${claimBudget === 1 ? '' : 's'} left` : mode === 'attack' ? `Click a hostile or press Space · ${attackRange} tile weapon range` : 'Build on adjacent claimed empty ground'} · {allResourcesClaimed ? 'EXPANSION UNLOCKED' : 'CLAIM ALL RESOURCES TO EXPAND'}</span><span className="mono">{boardIsExpanded ? 'EXPANSION 01' : 'INITIAL CHART'}</span></div>

            <div className="turn-controls">
              <div className="mode-toggle" aria-label="Action mode">
                <button className={mode === 'move' ? 'active' : ''} onClick={() => setMode('move')} data-testid="button-mode-move">Move <span className="mono">M</span></button>
                <button className={mode === 'claim' ? 'active' : ''} onClick={() => { setMode('claim'); claimBlockUnderPlayer(); }} data-testid="button-mode-claim">Claim nearby block <span className="mono">C</span></button>
                <button className={mode === 'attack' ? 'active attack-mode' : ''} onClick={() => setMode('attack')} data-testid="button-mode-attack">Weapon <span className="mono">F</span></button>
                <button className={mode === 'build' ? 'active build-mode' : ''} onClick={() => setMode('build')} data-testid="button-mode-build">Build <span className="mono">B</span></button>
              </div>
              <button className="console-button primary" onClick={endTurn} disabled={gameState !== 'playing' || phase !== 'play'} data-testid="button-end-turn">End turn <ArrowRight size={14} /></button>
            </div>
          </section>

          <aside className="sidebar-stack">
            <section className="panel" aria-label="Settlement resources">
              <div className="panel-heading"><h2>Life support</h2><ShieldCheck size={15} color="hsl(var(--primary))" /></div>
              <div className="resource-list">
                {([
                  ['oxygen', 'Oxygen', Wind, 100],
                  ['scavenge', 'Scavenged resources', Package, 30],
                  ['luminae', 'Luminae', Sparkles, 10],
                  ['signal', 'Signal / intel', Radio, 20],
                ] as const).map(([key, name, Icon, max]) => (
                  <div className="resource-row" key={key} data-testid={`resource-${key}`}>
                    <span className={`resource-mark tile-type-${key}`}><Icon size={11} /></span><span className="resource-name">{name}</span><strong className="resource-value">{resources[key]}</strong><div className="resource-bar"><span style={{ width: `${Math.min(100, Math.max(0, resources[key] / max * 100))}%` }} /></div>
                  </div>
                ))}
              </div>
              <button className="upgrade-row" onClick={healPlayer} disabled={gameState !== 'playing' || phase !== 'play' || resources.luminae < healCost || playerHp >= playerMaxHp}><span><strong>Heal Kael</strong><small>+{healAmount} HP · 1 Luminae</small></span><ArrowRight size={13} /></button>
              <div className="oxygen-note"><strong>Survival minimum: {OXYGEN_SURVIVAL_MINIMUM} O₂</strong><span>Oxygen loss is +1 after wave 3. Falling below the minimum ends the campaign.</span></div>
            </section>

            <section className="panel experience-panel" aria-label="Combat experience">
              <div className="panel-heading"><h2>Combat XP</h2><span className="eyebrow">LEVEL {xpLevel} · BANK {xpBank}</span></div>
              <div className="xp-copy"><span>Next progression threshold</span><strong>{xp} / {xpToNext} XP</strong></div>
              <div className="xp-bar"><span style={{ width: `${Math.min(100, xp / xpToNext * 100)}%` }} /></div>
              <div className="xp-foot"><span><Zap size={11} /> Full bar awards +1 XP</span><span>Spendable: {xpBank}</span></div>
            </section>

            <section className="panel upgrade-panel" aria-label="Workshop upgrades">
              <div className="panel-heading"><h2>Workshop</h2><span className="eyebrow">RESOURCE UPGRADES</span></div>
              <div className="upgrade-list">
                <button className="upgrade-row" onClick={repairSettlement} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < repairCost}><span><strong>Repair weakest block</strong><small>+1 HP, +5 oxygen · 4 R</small></span><ArrowRight size={13} /></button>
                {resourceUpgradeRows.map((upgrade) => (
                  <div className="upgrade-row" key={upgrade.label}>
                    <div className="upgrade-summary"><strong>{upgrade.label} <em>LV {upgrade.level} · {upgrade.value}</em></strong><small>Original resource route</small></div>
                    <button className="upgrade-option" onClick={upgrade.action} disabled={gameState !== 'playing' || phase !== 'play' || !canAffordResourceCost(upgrade.cost)}><span>RES</span>{formatResourceCost(upgrade.cost)}</button>
                  </div>
                ))}
              </div>
               <div className="xp-upgrade-divider"><span>XP-BOUGHT STATS</span><small>Every XP upgrade costs exactly 1 XP. Luck adds +1 resource to each captured drop; the XP threshold doubles after each filled bar.</small></div>
              <div className="upgrade-list xp-upgrade-list">
                {xpUpgradeRows.map((upgrade) => (
                  <div className="upgrade-row" key={upgrade.label}>
                    <div className="upgrade-summary"><strong>{upgrade.label} <em>LV {upgrade.level} · {upgrade.value}</em></strong><small>{'detail' in upgrade ? upgrade.detail : 'XP route · fixed price'}</small></div>
                    <button className="upgrade-option xp-option" onClick={upgrade.action} disabled={gameState !== 'playing' || phase !== 'play' || xpBank < 1}><span>XP</span>1 XP</button>
                  </div>
                ))}
              </div>
              <div className="xp-upgrade-divider"><span>TURRET CONTROL</span><small>{selectedTurretKey ? `Selected ${selectedTurretKey}` : 'Click a T on the chart to select it'} · Scrap upgrades affect only the selected turret; Luminae upgrades affect future builds.</small></div>
              <div className="upgrade-list xp-upgrade-list">
                <div className="upgrade-row"><div className="upgrade-summary"><strong>Selected turret damage</strong><small>+1 damage · 8 R</small></div><button className="upgrade-option" onClick={() => upgradeSelectedTurret('damage')} disabled={!selectedTurretKey || resources.scavenge < 8}><span>RES</span>8 R</button></div>
                <div className="upgrade-row"><div className="upgrade-summary"><strong>Selected turret cadence</strong><small>-1 second · 10 R</small></div><button className="upgrade-option" onClick={() => upgradeSelectedTurret('interval')} disabled={!selectedTurretKey || resources.scavenge < 10 || (turretStats[selectedTurretKey ?? '']?.interval ?? turretBlueprint.interval) <= 1}><span>RES</span>10 R</button></div>
                <div className="upgrade-row"><div className="upgrade-summary"><strong>Future turret damage</strong><small>+1 damage · 1 Luminae</small></div><button className="upgrade-option xp-option" onClick={() => upgradeFutureTurret('damage')} disabled={resources.luminae < 1}><span>L</span>1 L</button></div>
                <div className="upgrade-row"><div className="upgrade-summary"><strong>Future turret cadence</strong><small>-1 second · 1 Luminae</small></div><button className="upgrade-option xp-option" onClick={() => upgradeFutureTurret('interval')} disabled={resources.luminae < 1 || turretBlueprint.interval <= 1}><span>L</span>1 L</button></div>
              </div>
            </section>

            <section className="panel" aria-label="Crew status">
              <div className="panel-heading"><h2>Crew channel</h2><span className="eyebrow">ACTIVE</span></div>
               <div className="character-card"><div className="character-sigil">K/01</div><div><h3 className="character-name">Kael</h3><p className="character-role">Maintenance / settlement core</p><div className="character-stats"><span className="stat-chip">SPD {movementSpeed.toFixed(1)}</span><span className="stat-chip">DMG {attackDamage}</span><span className="stat-chip">RNG {attackRange}</span><span className="stat-chip">ATK CYCLE</span><span className="stat-chip">LUCK +{luckDropBonus}</span><span className="stat-chip">CLM {claimMax}</span></div></div></div>
              {miraUnlocked && <div className="mira-card" data-testid="status-mira"><strong>Mira // signal analyst</strong><p>New channel unlocked. She can hear a pattern inside the pain signal.</p></div>}
            </section>

            <section className="panel" aria-label="Wave forecast and legend">
              <div className="panel-heading"><h2>Wave forecast</h2><Waves size={15} color="hsl(var(--accent))" /></div>
              <div className="forecast"><div className="eyebrow">Next resolution in {nextWaveIn} turn{nextWaveIn === 1 ? '' : 's'} · interval {waveInterval}</div><div className="forecast-track">{Array.from({ length: waveInterval }, (_, index) => <span className={`forecast-segment ${index < turnsSinceWave ? 'active' : ''}`} key={index} />)}</div><div className="forecast-labels"><span>WAVES 1–2: 5T</span><span>3–4: 4T</span><span>5–6: 3T</span></div></div>
              <div className="legend-list">
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(194 75% 68%)' }}>O₂</span> Oxygen reserve</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(39 88% 65%)' }}>R</span> Repair material</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(168 82% 70%)' }}>L</span> Luminae growth</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(2 84% 72%)' }}>RZ</span> Razor · 1 HP · 2 tiles</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(22 92% 67%)' }}>SG</span> Siege · wave 3+</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(168 82% 70%)' }}>T</span> Turret · 2 DMG · 7s cadence · range 6</div>
              </div>
            </section>

            <section className="panel survival-guide" aria-label="How to survive">
              <div className="panel-heading"><h2>Survival protocol</h2><ShieldCheck size={15} color="hsl(var(--primary))" /></div>
              <ol>
                 <li><span>01</span><p>Move Kael freely with WASD or the arrow keys. Resources stay locked to the chart grid.</p></li>
                 <li><span>02</span><p>Stand over the highlighted resource or empty block and press C to claim it. Claiming is the turn-based action.</p></li>
                  <li><span>03</span><p>Click one hostile or press Space to fire. Kael stays locked to one target until it is neutralized.</p></li>
                 <li><span>04</span><p>Claim every resource in the current chart before the outer ring unlocks expansion. Connected territory is always required.</p></li>
              </ol>
            </section>

            <section className="panel" aria-label="Discovery feed"><div className="panel-heading"><h2>Discovery feed</h2><Info size={15} color="hsl(var(--muted-foreground))" /></div><div className="feed">{feed.map((item) => <div className="feed-item" key={item.id} data-testid={`feed-${item.id}`}><span className="feed-time">{item.label}</span><span>{item.text}</span></div>)}</div></section>
          </aside>
        </div>

        <div className="message-feed" role="status" data-testid="status-message">
          <strong>{phase === 'wave' ? 'WAVE' : mode === 'claim' ? 'CLAIM' : mode === 'attack' ? 'COMBAT' : mode === 'build' ? 'BUILD' : 'KAEL'}</strong>
          {phase === 'wave' ? 'The water shifts around the claimed blocks. Hold position while the pressure passes.' : mode === 'claim' ? `Stand over the highlighted resource or empty block and press C. ${claimBudget} claim action${claimBudget === 1 ? '' : 's'} remaining.` : mode === 'attack' ? `Kael deals ${attackDamage} damage within ${attackRange} tiles. Click a hostile or press Space to fire.` : mode === 'build' ? 'Spend 1 Luminae to place a turret on adjacent claimed empty ground. Turrets fire every 7 seconds within 6 tiles.' : 'Move freely through the chart. Claim resources and empty ground; the outer ring expands after every resource is secured.'}
        </div>
      </div>

      {(gameState === 'paused' || gameState === 'gameover' || gameState === 'victory') && (
        <div className={`overlay ${gameState === 'paused' ? '' : 'end-state-overlay'}`} role="dialog" aria-modal="true">
          <div className="overlay-card">
            <div className="eyebrow">{gameState === 'paused' ? 'SYSTEM PAUSED' : gameState === 'victory' ? 'SIGNAL STABILIZED' : 'LIFE SUPPORT OFFLINE'}</div>
            <h2>{gameState === 'paused' && 'Hold the line.'}{gameState === 'victory' && 'The sea is listening.'}{gameState === 'gameover' && 'The outpost went dark.'}</h2>
            <p>{gameState === 'paused' && 'The chart is safe. Take a breath, then return to the water when you are ready.'}{gameState === 'victory' && 'Six waves survived. The path to the Mourner is open; this settlement can now prepare a healing descent.'}{gameState === 'gameover' && <><strong>Why you lost:</strong> {lossReason || 'Settlement survival conditions were breached.'}<br /><br /><strong>Oxygen rule:</strong> keep at least {OXYGEN_SURVIVAL_MINIMUM} O₂ in reserve.</>}</p>
            <div className="action-row">{gameState === 'paused' && <button className="console-button primary" onClick={togglePause} data-testid="button-resume"><Play size={14} /> Resume chart</button>}{(gameState === 'gameover' || gameState === 'victory') && <button className="console-button primary" onClick={resetGame} data-testid="button-restart-overlay"><RotateCcw size={14} /> Restart campaign</button>}</div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;