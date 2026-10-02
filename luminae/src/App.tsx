import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Package,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Undo2,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';

type TileType = 'oxygen' | 'scavenge' | 'luminae' | 'signal' | 'blank';
type ResourceKey = 'oxygen' | 'scavenge' | 'luminae' | 'signal';
type ActionMode = 'move' | 'claim' | 'attack' | 'build' | 'wall';
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
type SupplyDrop = {
  id: number;
  x: number;
  y: number;
  resource: ResourceKey;
  amount: number;
  scavengedAmount: number;
  luminaeAmount: number;
  createdTurn: number;
  landTurn: number;
  landed: boolean;
  delivered: boolean;
};
type Enemy = {
  id: number;
  x: number;
  y: number;
  waypoint?: [number, number];
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
  attackDamage: number;
  attackRange: number;
  attacks: number;
  luck: number;
  health: number;
};

type Stats = {
  maxHp: number;
  speed: number;
  claimCapacity: number;
  hullShielding: number;
  attackDamage: number;
  attackRange: number;
  targetsPerVolley: number;
  luck: number;
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
  walls: Record<string, number>;
  turretHealth: Record<string, number>;
  supplyDrops: SupplyDrop[];
  turrets: string[];
  turretStats: Record<string, TurretStats>;
  turretBlueprint: TurretStats;
  playerHp: number;
  claimBudget: number;
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
const INITIAL_GRID_SIZE = 8;
const WALL_HP = 6;
const TURRET_HP = 6;
const TURRET_MIN_RANGE = 0;
const PLAYER_MOVE_SPEED = 2.8;
const ENEMY_MOVE_SPEED = 3.7;
const PLAYER_BASE_HP = 10;
const RESOURCE_CLAIM_RADIUS = 0.48;
const WEAPON_COOLDOWN_SECONDS = 0.55;
const EXPAND_STEP = 4;
const MAX_GRID_SIZE = 40;
const MIN_TILE_SIZE = 18;
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
function shiftTileKey(tileKey: string, offset: number) {
  const [x, y] = tileKey.split(':').map(Number);
  return keyFor(x + offset, y + offset);
}

function shiftTileKeys<Value>(values: Record<string, Value>, offset: number): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(values).map(([tileKey, value]) => [shiftTileKey(tileKey, offset), value]),
  );
}

const roundResourceValue = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
const formatOneDecimal = (value: number) => roundResourceValue(value).toFixed(1);
const xpThresholdFor = (level: number) => CONFIG.xpThresholdBase ** Math.max(0, level - 1);
const waveIntervalFor = (completedWave: number) => CONFIG.waveIntervalFor(completedWave);

export const CONFIG = {
  playerBaseHp: PLAYER_BASE_HP,
  playerMoveSpeed: PLAYER_MOVE_SPEED,
  movementSpeedPerLevel: 0.35,
  claimCapacityBase: 2,
  attackDamageBase: 1,
  attackRangeBase: 1,
  healthPerUpgrade: 2,
  resourceUpgradeCosts: {
    movement: (level: number) => ({ scavenge: 8 + level * 4, signal: 1 }),
    claim: (level: number) => ({ scavenge: 7 + level * 4, signal: 1 }),
    hull: (level: number) => ({ scavenge: 10 + level * 5, luminae: 1 }),
  },
  xpPerKill: 1,
  xpThresholdBase: 2,
  maxWaves: MAX_WAVES,
  initialGridSize: INITIAL_GRID_SIZE,
  oxygenSurvivalMinimum: OXYGEN_SURVIVAL_MINIMUM,
  waveIntervalFor: (completedWave: number) => completedWave < 2 ? 5 : completedWave < 4 ? 4 : 3,
  wallHp: WALL_HP,
  turretHp: TURRET_HP,
  wallBuildCostScavenged: 0.2,
  turretRefundLuminae: 0.5,
  turretBuildCostLuminae: 1,
  turretRange: TURRET_ATTACK_RANGE,
  turretMinRange: TURRET_MIN_RANGE,
  turretFireInterval: TURRET_FIRE_INTERVAL,
  turretDamageUpgradeCost: 8,
  turretCadenceUpgradeCost: 10,
  futureTurretUpgradeCostLuminae: 1,
  wallTurretRangeBonus: 4,
  wallTurretMinRange: 2,
  turretRangeBuffer: WEAPON_RANGE_BUFFER,
  weaponCooldownSeconds: WEAPON_COOLDOWN_SECONDS,
  enemyMoveSpeed: ENEMY_MOVE_SPEED,
  enemyMovementSpeedPerStat: 0.35,
  enemyContactInterval: ENEMY_CONTACT_INTERVAL,
  enemyAttackRange: ENEMY_ATTACK_RANGE,
  maxGridSize: MAX_GRID_SIZE,
  minTileSize: MIN_TILE_SIZE,
  expandStep: EXPAND_STEP,
  claimRadius: RESOURCE_CLAIM_RADIUS,
  xpUpgradeCostFormula: (_level: number) => 1,
  wallPathCost: 10,
  territoryPathCost: 8,
  territoryEngagementDistance: 0.7,
  supplyDropDelayTurns: 2,
  supplyDropBaseCost: 1,
  supplyDropPayloadScavenged: (callNumber: number) => 20 * 2 ** (callNumber - 1),
  supplyDropPayloadLuminae: (callNumber: number) => 3 + 2 * (callNumber - 1),
} as const;

const startScreenSummary = [
  'Claim territory and protect the core at all costs.',
  'Move with WASD or the arrow keys; press C to claim when close enough.',
  'A turn restores claim actions; wave pressure resolves on the current turn interval.',
  `Walls cost ${CONFIG.wallBuildCostScavenged} Scavenged, block movement, and can only go on non-resource blocks; Wall mode also dismantles them.`,
  `Turrets cost ${CONFIG.turretBuildCostLuminae} Luminae and can be placed on claimed empty blocks or wall blocks; wall mounts gain ${CONFIG.wallTurretRangeBonus} range.`,
  `Supply drops cost Signal, land after ${CONFIG.supplyDropDelayTurns} turns, and pay out when their tile is claimed.`,
];

export function getStats(state: Partial<Upgrades> = {}): Stats {
  const movement = state.movement ?? 0;
  const claim = state.claim ?? 0;
  const hull = state.hull ?? 0;
  const attackDamage = (state.attackDamage ?? 0) + CONFIG.attackDamageBase;
  const attackRange = (state.attackRange ?? 0) + CONFIG.attackRangeBase;
  const targetsPerVolley = 1 + (state.attacks ?? 0);
  const luck = state.luck ?? 0;
  const health = state.health ?? 0;

  return {
    maxHp: CONFIG.playerBaseHp + health * CONFIG.healthPerUpgrade,
    speed: CONFIG.playerMoveSpeed + movement * CONFIG.movementSpeedPerLevel,
    claimCapacity: CONFIG.claimCapacityBase + claim,
    hullShielding: hull,
    attackDamage,
    attackRange,
    targetsPerVolley,
    luck,
  };
}

function tileTypeAt(x: number, y: number, boardSize: number): TileType {
  const expansionOffset = Math.floor((boardSize - INITIAL_GRID_SIZE) / 2);
  const logicalX = x - expansionOffset;
  const logicalY = y - expansionOffset;
  const rawValue = logicalX * 17 + logicalY * 31 + logicalX * logicalY * 7;
  const value = ((rawValue % 19) + 19) % 19;
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

function clampPosition(value: number, boardSize: number) {
  const margin = 0.35;
  return Math.min(boardSize - margin, Math.max(margin, value));
}

function collidesWithWall(x: number, y: number, walls: Record<string, number>) {
  return Object.entries(walls).some(([tileKey, hp]) => {
    if (hp <= 0) return false;
    const [wallX, wallY] = tileKey.split(':').map(Number);
    return Math.abs(x - wallX) < 0.42 && Math.abs(y - wallY) < 0.42;
  });
}

function enemyStats(kind: EnemyKind, wave: number) {
  const waveUpgrade = Math.max(0, wave - 1);
  if (kind === 'razor') return { hp: 1 + waveUpgrade, damage: 2 + waveUpgrade, movement: 2 + waveUpgrade };
  if (kind === 'siege') return { hp: 4 + waveUpgrade, damage: 2 + waveUpgrade, movement: 1 + waveUpgrade };
  return { hp: 2 + waveUpgrade, damage: 2 + waveUpgrade, movement: 1 + waveUpgrade };
}

function enemySpeedFor(movementStat: number) {
  return CONFIG.enemyMoveSpeed + Math.max(0, movementStat - 1) * CONFIG.enemyMovementSpeedPerStat;
}

function findPathToTarget(
  start: [number, number],
  target: [number, number],
  boardSize: number,
  walls: Record<string, number>,
  claimedKeys: string[] = [],
): Array<[number, number]> {
  const startKey = keyFor(start[0], start[1]);
  const targetKey = keyFor(target[0], target[1]);
  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const positions = new Map<string, [number, number]>([[startKey, start]]);
  const claimedSet = new Set(claimedKeys);
  const frontier = [startKey];

  while (frontier.length) {
    frontier.sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity));
    const currentKey = frontier.shift()!;
    if (currentKey === targetKey) break;
    const [x, y] = positions.get(currentKey)!;
    for (const [nextX, nextY] of neighbors(x, y, boardSize)) {
      const nextKey = keyFor(nextX, nextY);
      const tileCost = (walls[nextKey] ?? 0) > 0
        ? CONFIG.wallPathCost
        : claimedSet.has(nextKey)
          ? CONFIG.territoryPathCost
          : 1;
      const nextDistance = (distances.get(currentKey) ?? Infinity) + tileCost;
      if (nextDistance >= (distances.get(nextKey) ?? Infinity)) continue;
      distances.set(nextKey, nextDistance);
      previous.set(nextKey, currentKey);
      positions.set(nextKey, [nextX, nextY]);
      if (!frontier.includes(nextKey)) frontier.push(nextKey);
    }
  }

  if (!distances.has(targetKey)) return [start];
  const path: Array<[number, number]> = [];
  let currentKey: string | undefined = targetKey;
  while (currentKey) {
    const position = positions.get(currentKey);
    if (position) path.unshift(position);
    if (currentKey === startKey) break;
    currentKey = previous.get(currentKey);
  }
  return path;
}

function findPathToCoreBreach(
  start: [number, number],
  core: [number, number],
  boardSize: number,
  walls: Record<string, number>,
  claimedKeys: string[],
): Array<[number, number]> {
  const coreKey = keyFor(core[0], core[1]);
  const claimedSet = new Set(claimedKeys);
  const breachCandidates = claimedKeys
    .filter((tileKey) => tileKey !== coreKey)
    .map((tileKey) => {
      const [x, y] = tileKey.split(':').map(Number);
      const path = findPathToTarget(start, [x, y], boardSize, walls, claimedKeys);
      const pathCost = path.slice(1).reduce((cost, [pathX, pathY]) => {
        const pathKey = keyFor(pathX, pathY);
        return cost + ((walls[pathKey] ?? 0) > 0
          ? CONFIG.wallPathCost
          : claimedSet.has(pathKey)
            ? CONFIG.territoryPathCost
            : 1);
      }, 0);
      return { path, pathCost, distanceToCore: Math.abs(core[0] - x) + Math.abs(core[1] - y) };
    })
    .filter(({ path }) => path.length > 0)
    .sort((a, b) => a.pathCost - b.pathCost || a.distanceToCore - b.distanceToCore);

  return breachCandidates[0]?.path ?? findPathToTarget(start, core, boardSize, walls, claimedKeys);
}

function createWavePlan(wave: number, intensity: number, boardSize: number): Enemy[] {
  const enemyCount = Math.min(2 + intensity, 6);
  return edgeSpawnPositions(boardSize, enemyCount).map(([x, y], index) => {
    const kind: EnemyKind = wave >= 3 && index % 4 === 0
      ? 'siege'
      : index % 3 === 0
        ? 'razor'
        : 'drifter';
    return { id: wave * 100 + index, x, y, kind, ...enemyStats(kind, wave) };
  });
}

function App() {
  const [boardSize, setBoardSize] = useState(INITIAL_GRID_SIZE);
  const [player, setPlayer] = useState<[number, number]>([Math.floor(INITIAL_GRID_SIZE / 2), Math.floor(INITIAL_GRID_SIZE / 2)]);
  const [claimed, setClaimed] = useState<string[]>(initialClaimed);
  const [resources, setResources] = useState<Resources>(initialResources);
  const [upgrades, setUpgrades] = useState<Upgrades>(initialUpgrades);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [wavePlan, setWavePlan] = useState<Enemy[]>([]);
  const [blockHp, setBlockHp] = useState<Record<string, number>>(initialBlockHp);
  const [blockResources, setBlockResources] = useState<Record<string, BlockResources>>(initialBlockResources);
  const [walls, setWalls] = useState<Record<string, number>>({});
  const [turrets, setTurrets] = useState<string[]>([]);
  const [turretHealth, setTurretHealth] = useState<Record<string, number>>({});
  const [turretStats, setTurretStats] = useState<Record<string, TurretStats>>({});
  const [turretBlueprint, setTurretBlueprint] = useState<TurretStats>({ damage: 2, interval: TURRET_FIRE_INTERVAL });
  const [selectedTurretKey, setSelectedTurretKey] = useState<string | null>(null);
  const [supplyDrops, setSupplyDrops] = useState<SupplyDrop[]>([]);
  const [timesCalled, setTimesCalled] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showEnemyPaths, setShowEnemyPaths] = useState(true);
  const [showUpgradePopover, setShowUpgradePopover] = useState(false);
    const [wallPreviewKey, setWallPreviewKey] = useState<string | null>(null);
  const [tilePixelSize, setTilePixelSize] = useState(18);
  const [playerHp, setPlayerHp] = useState(PLAYER_BASE_HP);
  const [turn, setTurn] = useState(1);
  const [wave, setWave] = useState(0);
  const [intensity, setIntensity] = useState(1);
  const [turnsSinceWave, setTurnsSinceWave] = useState(0);
  const [claimBudget, setClaimBudget] = useState(2);
  const [xp, setXp] = useState(0);
  const [xpLevel, setXpLevel] = useState(0);
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
      { id: 2, label: 'LOG', text: 'Stand within the claim radius of a tile connected to the core. Territory must remain connected.' },
  ]);
  const historyRef = useRef<Snapshot[]>([]);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const gridMeasureReadyRef = useRef(false);
  const debugExpansionUsedRef = useRef(false);
  const stateRef = useRef<Snapshot | null>(null);
  const playerRef = useRef<[number, number]>(player);
  const enemiesRef = useRef<Enemy[]>(enemies);
  const keysRef = useRef(new Set<string>());
  const attackCooldownRef = useRef(0);
  const handleAttackRef = useRef<(enemyId?: number) => void>(() => undefined);
  const removeTurretRef = useRef<() => void>(() => undefined);
  const claimActionRef = useRef<() => void>(() => undefined);
  const undoActionRef = useRef<() => void>(() => undefined);
  const endTurnActionRef = useRef<() => void>(() => undefined);
  const selectedEnemyIdRef = useRef<number | null>(selectedEnemyId);
  const turretTimersRef = useRef<Record<string, number>>({});
  const playerDamageTimerRef = useRef(0);
  const playerHpRef = useRef(playerHp);
  const xpProgressRef = useRef(xp);
  const xpLevelRef = useRef(xpLevel);
  const renderAccumulatorRef = useRef(0);
  const projectileIdRef = useRef(0);
  const expansionLockRef = useRef(false);
  const resourceExpansionHandledRef = useRef(false);
  playerRef.current = player;
  enemiesRef.current = enemies;
  playerHpRef.current = playerHp;
  selectedEnemyIdRef.current = selectedEnemyId;
  xpProgressRef.current = xp;
  xpLevelRef.current = xpLevel;

  const tiles = useMemo(
    () =>
      Array.from({ length: boardSize * boardSize }, (_, index) => {
        const x = index % boardSize;
        const y = Math.floor(index / boardSize);
        return { x, y, type: tileTypeAt(x, y, boardSize) };
      }),
    [boardSize],
  );

  const boardIsExpanded = boardSize > CONFIG.initialGridSize;
  const stats = useMemo(() => getStats(upgrades), [upgrades]);
  const movementSpeed = stats.speed;
  const claimMax = stats.claimCapacity;
  const attackDamage = stats.attackDamage;
  const attackRange = stats.attackRange;
  const attacksPerTurn = stats.targetsPerVolley;
  const luckDropBonus = stats.luck;
  const playerMaxHp = stats.maxHp;
  const xpToNext = xpThresholdFor(xpLevel + 1);
  const waveInterval = waveIntervalFor(wave);
  const nextWaveIn = Math.max(1, waveInterval - turnsSinceWave);
  const coreKey = keyFor(Math.floor(boardSize / 2), Math.floor(boardSize / 2));
  const playerKey = keyFor(player[0], player[1]);
  const outerBuffer = (x: number, y: number) =>
    x <= 1 || y <= 1 || x >= boardSize - 2 || y >= boardSize - 2;
  const atOuterEdge = (x: number, y: number) =>
    x === 0 || y === 0 || x === boardSize - 1 || y === boardSize - 1;
  const unclaimedResourceTiles = tiles.filter((tile) => resourceForTile[tile.type] && !claimed.includes(keyFor(tile.x, tile.y)));
  if (unclaimedResourceTiles.length > 0) resourceExpansionHandledRef.current = false;
  const allResourcesClaimed = unclaimedResourceTiles.length === 0;
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
  const routePreview = useMemo(() => {
    if (!claimTarget) return [] as Array<[number, number]>;
    const path = findPathToTerritory([Math.round(player[0]), Math.round(player[1])], claimed, boardSize);
    const fallback = path.length ? path.slice(0, 6) : [[Math.round(claimTarget.x), Math.round(claimTarget.y)]];
    return fallback.map(([x, y]) => [x, y] as [number, number]);
  }, [boardSize, claimTarget, claimed, player]);
  const routePreviewSet = useMemo(() => new Set(routePreview.map(([x, y]) => keyFor(x, y))), [routePreview]);
  const plannedRoutes = useMemo(
    () => wavePlan.map((enemy) => ({ enemy, path: findPathToCoreBreach(
      [enemy.x, enemy.y], [Math.floor(boardSize / 2), Math.floor(boardSize / 2)], boardSize, walls, claimed,
    ) })),
    [boardSize, claimed, walls, wavePlan],
  );
  const nextWavePlan = useMemo(() => ({
    drifters: wavePlan.filter((enemy) => enemy.kind === 'drifter').length,
    razor: wavePlan.filter((enemy) => enemy.kind === 'razor').length,
    siege: wavePlan.filter((enemy) => enemy.kind === 'siege').length,
    total: wavePlan.length,
  }), [wavePlan]);
  const claimTargetDistance = claimTarget
    ? Math.max(0, Math.hypot(player[0] - claimTarget.x, player[1] - claimTarget.y) - ((walls[keyFor(claimTarget.x, claimTarget.y)] ?? 0) > 0 ? 0.58 : 0))
    : Number.POSITIVE_INFINITY;
  const canClaimTarget = claimTargetDistance <= CONFIG.claimRadius;
  const currentSupplyDropCost = CONFIG.supplyDropBaseCost + timesCalled;
  const getSupplyDropPayload = (callNumber: number) => ({
    scavenged: CONFIG.supplyDropPayloadScavenged(callNumber),
    luminae: CONFIG.supplyDropPayloadLuminae(callNumber),
  });

  const handlePlay = () => {
    setIsStarted(true);
    setShowHelp(false);
    if (gameState === 'paused') {
      setGameState('playing');
    }
  };

  const openHelp = () => {
    setShowHelp(true);
    if (gameState === 'playing') {
      setGameState('paused');
    }
  };

  const closeHelp = () => {
    setShowHelp(false);
    if (gameState === 'paused' && isStarted) {
      setGameState('playing');
    }
  };

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
    walls: { ...walls },
    turretHealth: { ...turretHealth },
    supplyDrops: supplyDrops.map((drop) => ({ ...drop })),
    turrets: [...turrets],
    turretStats: Object.fromEntries(Object.entries(turretStats).map(([key, stats]) => [key, { ...stats }])),
    turretBlueprint: { ...turretBlueprint },
    playerHp,
    claimBudget,
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

  const expandBoard = (territoryToShift: string[] = claimed) => {
    if (expansionLockRef.current) return boardSize;
    expansionLockRef.current = true;
    const nextBoardSize = Math.min(CONFIG.maxGridSize, boardSize + CONFIG.expandStep);
    if (nextBoardSize === boardSize) {
      addFeed('Territory expansion is capped at the current limit.', 'MAP');
      window.setTimeout(() => { expansionLockRef.current = false; }, 450);
      return boardSize;
    }
    if (gridMeasureReadyRef.current && Math.floor(tilePixelSize * boardSize / nextBoardSize) < CONFIG.minTileSize) {
      addFeed(`Territory cannot expand further without shrinking tiles below ${CONFIG.minTileSize}px.`, 'MAP');
      window.setTimeout(() => { expansionLockRef.current = false; }, 450);
      return boardSize;
    }
    const coordinateShift = Math.floor(nextBoardSize / 2) - Math.floor(boardSize / 2);
    setClaimed(territoryToShift.map((tileKey) => shiftTileKey(tileKey, coordinateShift)));
    setBlockHp((current) => shiftTileKeys(current, coordinateShift));
    setBlockResources((current) => shiftTileKeys(current, coordinateShift));
    setWalls((current) => shiftTileKeys(current, coordinateShift));
    setTurrets((current) => current.map((tileKey) => shiftTileKey(tileKey, coordinateShift)));
    setTurretStats((current) => shiftTileKeys(current, coordinateShift));
    setTurretHealth((current) => shiftTileKeys(current, coordinateShift));
    setSupplyDrops((current) => current.map((drop) => ({ ...drop, x: drop.x + coordinateShift, y: drop.y + coordinateShift })));
    setEnemies((current) => current.map((enemy) => ({
      ...enemy,
      x: enemy.x + coordinateShift,
      y: enemy.y + coordinateShift,
      waypoint: enemy.waypoint ? [enemy.waypoint[0] + coordinateShift, enemy.waypoint[1] + coordinateShift] : undefined,
    })));
    setSelectedTurretKey((current) => current ? shiftTileKey(current, coordinateShift) : null);
    turretTimersRef.current = shiftTileKeys(turretTimersRef.current, coordinateShift);
    setBoardSize(nextBoardSize);
    setPlayer((current) => [current[0] + coordinateShift, current[1] + coordinateShift]);
    setEdgeWarning(false);
    addFeed('Territory expanded', 'MAP');
    window.setTimeout(() => { expansionLockRef.current = false; }, 450);
    return nextBoardSize;
  };

  const debugClaimAllTiles = () => {
    if (!import.meta.env.DEV || typeof window === 'undefined' || !window.location.search.includes('debug=1') || debugExpansionUsedRef.current) {
      return;
    }
    debugExpansionUsedRef.current = true;
    const allTiles = Array.from({ length: boardSize * boardSize }, (_, index) => {
      const x = index % boardSize;
      const y = Math.floor(index / boardSize);
      return keyFor(x, y);
    });
    const claimedForExpansion = Array.from(new Set([...claimed, ...allTiles]));
    setClaimed(claimedForExpansion);
    resourceExpansionHandledRef.current = true;
    expandBoard(claimedForExpansion);
    addFeed('Debug claim-all applied for expansion testing.', 'DEBUG');
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
    setWalls(saved.walls);
    setTurretHealth(saved.turretHealth ?? {});
    setSupplyDrops(saved.supplyDrops ?? []);
    setTurrets(saved.turrets);
    setTurretStats(saved.turretStats);
    setTurretBlueprint(saved.turretBlueprint);
    setSelectedTurretKey(null);
    setPlayerHp(saved.playerHp);
    setClaimBudget(saved.claimBudget);
    setXp(saved.xp);
    setXpLevel(saved.xpLevel);
    xpProgressRef.current = saved.xp;
    xpLevelRef.current = saved.xpLevel;
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
    setBoardSize(CONFIG.initialGridSize);
    setPlayer([Math.floor(INITIAL_GRID_SIZE / 2), Math.floor(INITIAL_GRID_SIZE / 2)]);
    setClaimed(initialClaimed);
    setResources(initialResources);
    setUpgrades(initialUpgrades);
    setEnemies([]);
    setBlockHp(initialBlockHp);
    setBlockResources(initialBlockResources);
    setWalls({});
    setTurretHealth({});
    setSupplyDrops([]);
    setTimesCalled(0);
    setTurrets([]);
    setTurretStats({});
    setTurretBlueprint({ damage: 2, interval: TURRET_FIRE_INTERVAL });
    setSelectedTurretKey(null);
    setPlayerHp(PLAYER_BASE_HP);
    setTurn(1);
    setWave(0);
    setIntensity(1);
    setTurnsSinceWave(0);
    setClaimBudget(2);
    setXp(0);
    setXpLevel(0);
    xpProgressRef.current = 0;
    xpLevelRef.current = 0;
    setXpBank(0);
    setMode('move');
    setShowUpgradePopover(false);
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
    resourceExpansionHandledRef.current = false;
    debugExpansionUsedRef.current = false;
    setFeed([
      { id: Date.now(), label: 'T+00', text: 'Campaign restarted. Core territory is holding.' },
      { id: Date.now() + 1, label: 'LOG', text: 'Stand within the claim radius of a connected unclaimed tile. Luck improves captured resource yields.' },
    ]);
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
          ? 'Every resource block is claimed. The chart will expand at the next resource-completion check.'
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
    const nextClaimed = [...claimed, tileKey];
    setClaimed(nextClaimed);
    setBlockHp((current) => ({ ...current, [tileKey]: 5 }));
    setBlockResources((current) => ({ ...current, [tileKey]: stored }));
    setClaimBudget((current) => current - 1);
    const landedDrop = supplyDrops.find((drop) => drop.x === x && drop.y === y && drop.landed && !drop.delivered);
    if (landedDrop) {
      setResources((current) => ({
        ...current,
        scavenge: roundResourceValue(current.scavenge + landedDrop.scavengedAmount),
        luminae: roundResourceValue(current.luminae + landedDrop.luminaeAmount),
      }));
      setSupplyDrops((current) => current.filter((drop) => drop.id !== landedDrop.id));
      addFeed(`Supply drop collected: +${landedDrop.scavengedAmount} Scavenged and +${landedDrop.luminaeAmount} Luminae.`, 'SUPPLY');
    }
    const hasUnclaimedResources = tiles.some((tile) =>
      resourceForTile[tile.type] && !nextClaimed.includes(keyFor(tile.x, tile.y)),
    );
    if (resource && !hasUnclaimedResources && !resourceExpansionHandledRef.current) {
      resourceExpansionHandledRef.current = true;
      expandBoard(nextClaimed);
    }
    if (resource) {
      const yieldAmount = stored[resource] ?? 0;
      setResources((current) => ({ ...current, [resource]: current[resource] + yieldAmount }));
      addFeed(`${tileNames[type]} secured. ${tileNames[type]} drop +${yieldAmount}${luckDropBonus ? ` · Luck +${luckDropBonus}` : ''}.`);
      return;
    }
    addFeed('Empty ground secured. This block is now eligible for turret construction.', 'BUILD');
  };

  const registerKill = (enemy: Enemy, source: 'kael' | 'turret') => {
    const amount = CONFIG.xpPerKill;
    let nextXp = xpProgressRef.current + amount;
    let nextLevel = xpLevelRef.current;
    let levelsGained = 0;
    while (nextXp >= xpThresholdFor(nextLevel + 1)) {
      nextXp -= xpThresholdFor(nextLevel + 1);
      nextLevel += 1;
      levelsGained += nextLevel;
    }
    setXp(nextXp);
    setXpLevel(nextLevel);
    xpProgressRef.current = nextXp;
    xpLevelRef.current = nextLevel;
    if (levelsGained > 0) {
      setXpBank((current) => current + levelsGained);
    }
    addFeed(
      `${source === 'kael' ? 'Kael' : 'Turret'} confirmed target ${enemy.kind}. +${amount} progress${levelsGained > 0 ? ` · Level up! Level ${nextLevel} reached · +${levelsGained} XP` : ''}.`,
      'XP',
    );
  };

  const handleAttack = (enemyId?: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const liveEnemies = enemiesRef.current;
    const candidateTarget = typeof enemyId === 'number'
      ? liveEnemies.find((candidate) => candidate.id === enemyId)
      : liveEnemies
          .map((enemy) => ({ enemy, distance: Math.hypot(playerRef.current[0] - enemy.x, playerRef.current[1] - enemy.y) }))
          .filter(({ distance }) => distance <= attackRange + WEAPON_RANGE_BUFFER)
          .sort((a, b) => a.distance - b.distance)[0]?.enemy;

    if (!candidateTarget) {
      addFeed('No hostile is within Kael’s current weapon range.', 'COMBAT');
      return;
    }
    if (attackCooldownRef.current > 0) {
      addFeed(`Weapon cycling. Ready in ${attackCooldownRef.current.toFixed(1)}s.`, 'COMBAT');
      return;
    }

    const targets = liveEnemies
      .map((enemy) => ({ enemy, distance: Math.hypot(playerRef.current[0] - enemy.x, playerRef.current[1] - enemy.y) }))
      .filter(({ distance }) => distance <= attackRange + WEAPON_RANGE_BUFFER)
      .sort((a, b) => a.distance - b.distance)
      .map(({ enemy }) => enemy)
      .slice(0, Math.max(1, stats.targetsPerVolley));

    if (!targets.length) {
      addFeed('No hostile is within Kael’s current weapon range.', 'COMBAT');
      return;
    }

    captureAction();
    attackCooldownRef.current = CONFIG.weaponCooldownSeconds;
    setAttackCooldown(CONFIG.weaponCooldownSeconds);
    const updatedEnemies = liveEnemies.map((enemy) => ({ ...enemy }));
    const kills: Enemy[] = [];

    targets.forEach((target) => {
      const index = updatedEnemies.findIndex((enemy) => enemy.id === target.id);
      if (index === -1) return;
      const afterHit = updatedEnemies[index].hp - attackDamage;
      setWeaponFlash({
        from: [...playerRef.current] as [number, number],
        to: [target.x, target.y],
      });
      setProjectiles((current) => [...current, {
        id: projectileIdRef.current++,
        from: [...playerRef.current] as [number, number],
        to: [target.x, target.y],
        progress: 0,
        source: 'player',
      }]);
      if (afterHit <= 0) {
        kills.push(updatedEnemies[index]);
        updatedEnemies.splice(index, 1);
      } else {
        updatedEnemies[index] = { ...updatedEnemies[index], hp: afterHit };
      }
    });

    if (kills.length) {
      kills.forEach((enemy) => registerKill(enemy, 'kael'));
      addFeed(`Kael eliminated ${kills.length} hostile${kills.length === 1 ? '' : 's'} with a volley.`, 'COMBAT');
    } else {
      addFeed(`Kael fired a ${targets.length}-target volley for ${attackDamage} damage each.`, 'COMBAT');
    }
    setSelectedEnemyId(updatedEnemies[0]?.id ?? null);
    setEnemies(updatedEnemies);
    enemiesRef.current = updatedEnemies;
    window.setTimeout(() => setWeaponFlash(null), 160);
  };
  handleAttackRef.current = handleAttack;

  const handleBuildWall = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const tileKey = keyFor(x, y);
    if (tileTypeAt(x, y, boardSize) !== 'blank') {
      addFeed('Walls can only be built on empty blocks, not resource blocks.', 'BUILD');
      return;
    }
    const occupiedByEnemy = enemies.some((enemy) => Math.abs(enemy.x - x) < 0.5 && Math.abs(enemy.y - y) < 0.5);
    const isCurrentTile = keyFor(Math.round(player[0]), Math.round(player[1])) === tileKey;
    if (isCurrentTile) {
      addFeed('Kael cannot wall in the tile he is standing on.', 'BUILD');
      return;
    }
    if (occupiedByEnemy) {
      addFeed('A wall cannot be erected on a tile occupied by an enemy.', 'BUILD');
      return;
    }
    if (turrets.includes(tileKey) || (walls[tileKey] ?? 0) > 0) {
      addFeed('That tile already contains a turret or wall and cannot be fortified again.', 'BUILD');
      return;
    }
    if (resources.scavenge + Number.EPSILON < CONFIG.wallBuildCostScavenged) {
      addFeed(`Wall construction costs ${CONFIG.wallBuildCostScavenged} scavenged material.`, 'BUILD');
      return;
    }
    captureAction();
    setResources((current) => ({
      ...current,
      scavenge: roundResourceValue(current.scavenge - CONFIG.wallBuildCostScavenged),
    }));
    setWalls((current) => ({ ...current, [tileKey]: CONFIG.wallHp }));
    addFeed(`Wall erected at ${tileKey}. Structural integrity ${CONFIG.wallHp} HP.`, 'BUILD');
  };

  const handleRemoveWall = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const tileKey = keyFor(x, y);
    if (!(walls[tileKey] > 0)) return;
    captureAction();
    if (turrets.includes(tileKey)) {
      const refund = roundResourceValue(CONFIG.turretBuildCostLuminae * CONFIG.turretRefundLuminae);
      setTurrets((current) => current.filter((key) => key !== tileKey));
      setTurretHealth((current) => {
        const next = { ...current };
        delete next[tileKey];
        return next;
      });
      setTurretStats((current) => {
        const next = { ...current };
        delete next[tileKey];
        return next;
      });
      setResources((current) => ({ ...current, luminae: roundResourceValue(current.luminae + refund) }));
      if (selectedTurretKey === tileKey) setSelectedTurretKey(null);
      addFeed(`Wall dismantled; mounted turret removed for +${refund.toFixed(1)} Luminae.`, 'BUILD');
    } else {
      addFeed(`Wall at ${tileKey} dismantled.`, 'BUILD');
    }
    setWalls((current) => {
      const next = { ...current };
      delete next[tileKey];
      return next;
    });
  };

  const handleBuildTurret = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const tileKey = keyFor(x, y);
    const distance = Math.abs(player[0] - x) + Math.abs(player[1] - y);
    if (distance > 1) {
      addFeed('Turrets must be built on an adjacent claimed empty block or a wall block.', 'BUILD');
      return;
    }
    const wallHealth = walls[tileKey] ?? 0;
    const isEmptyBlock = tileTypeAt(x, y, boardSize) === 'blank';
    if (turrets.includes(tileKey)) {
      addFeed('That block already contains a turret.', 'BUILD');
      return;
    }
    if (!wallHealth && (!claimed.includes(tileKey) || !isEmptyBlock)) {
      addFeed(!claimed.includes(tileKey) ? 'Claim an empty block before building a turret, or place it on a wall.' : 'Turrets can only be built on empty blocks or walls.', 'BUILD');
      return;
    }
    if (resources.luminae < CONFIG.turretBuildCostLuminae) {
      addFeed('One Luminae growth unit is required to build a turret.', 'BUILD');
      return;
    }
    captureAction();
    setResources((current) => ({ ...current, luminae: roundResourceValue(current.luminae - CONFIG.turretBuildCostLuminae) }));
    setTurrets((current) => [...current, tileKey]);
    setTurretHealth((current) => ({ ...current, [tileKey]: CONFIG.turretHp }));
    setTurretStats((current) => ({ ...current, [tileKey]: { ...turretBlueprint } }));
    turretTimersRef.current[tileKey] = 0;
    const wallBonusText = wallHealth > 0 ? ` Wall mount adds ${CONFIG.wallTurretRangeBonus} extra range and a ${CONFIG.wallTurretMinRange}-tile minimum engagement window.` : '';
    addFeed(`Luminae turret built. It deals ${turretBlueprint.damage} damage every ${turretBlueprint.interval}s within ${CONFIG.turretRange}${wallBonusText ? ` (+${CONFIG.wallTurretRangeBonus})` : ''} tiles.`, 'BUILD');
  };

  const fireTurrets = (enemyPool: Enemy[], firingTurretKeys = turrets) => {
    if (!firingTurretKeys.length || !enemyPool.length) return { enemies: enemyPool, kills: 0 };
    const hitIds = new Set<number>();
    let nextEnemies = enemyPool.map((enemy) => ({ ...enemy }));
    firingTurretKeys.forEach((turretKey) => {
      const [turretX, turretY] = turretKey.split(':').map(Number);
      const wallBonus = (walls[turretKey] ?? 0) > 0 ? CONFIG.wallTurretRangeBonus : 0;
      const minRange = (walls[turretKey] ?? 0) > 0 ? CONFIG.wallTurretMinRange : CONFIG.turretMinRange;
      const nearestEnemy = nextEnemies
        .filter((enemy) => !hitIds.has(enemy.id))
        .map((enemy) => ({
          enemy,
          distance: Math.hypot(turretX - enemy.x, turretY - enemy.y),
        }))
        .filter(({ distance }) => distance >= minRange && distance <= TURRET_ATTACK_RANGE + wallBonus)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearestEnemy) return;
      const nearestTurret = [turretX, turretY] as [number, number];
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
    const defeatedEnemies = nextEnemies.filter((enemy) => hitIds.has(enemy.id));
    nextEnemies = nextEnemies.filter((enemy) => !hitIds.has(enemy.id));
    if (hitIds.size) {
      defeatedEnemies.forEach((enemy) => registerKill(enemy, 'turret'));
      addFeed(`${hitIds.size} hostile${hitIds.size === 1 ? '' : 's'} took turret damage and were destroyed.`, 'TURRET');
    } else if (firingTurretKeys.some((turretKey) => (walls[turretKey] ?? 0) > 0 || (turretStats[turretKey] ?? turretBlueprint).damage > 0)) {
      addFeed('Turret shot registered within the defensive perimeter.', 'TURRET');
    }
    return { enemies: nextEnemies, kills: hitIds.size };
  };

  const resolveWave = (enemyPool: Enemy[]) => {
    const nextWave = wave + 1;
    const waveBoardSize = boardSize;
    const plannedWave = waveBoardSize === boardSize && wavePlan.length
      ? wavePlan
      : createWavePlan(nextWave, intensity, waveBoardSize);
    const newEnemies = plannedWave.map((enemy) => ({ ...enemy }));
    setWavePlan([]);
    const activeEnemies = [...enemyPool, ...newEnemies];
    // Enemies now travel continuously between turns. Resolution only applies
    // damage when an enemy is physically over a claimed block.
    const movedEnemies = activeEnemies;

    const nextBlockHp = { ...blockHp };
    const nextWallHp = { ...walls };
    const nextTurretHealth = { ...turretHealth };
    const destroyedTurrets: string[] = [];
    const damageByTile: Record<string, number> = {};
    movedEnemies.forEach((enemy) => {
      const effectiveDamage = Math.max(1, enemy.damage - upgrades.hull);
      const wallKey = Object.keys(nextWallHp).find((tileKey) => {
        const [tileX, tileY] = tileKey.split(':').map(Number);
        return nextWallHp[tileKey] > 0 && Math.hypot(enemy.x - tileX, enemy.y - tileY) <= 0.75;
      });
      if (wallKey) {
        const wallDamage = Math.min(nextWallHp[wallKey], effectiveDamage);
        nextWallHp[wallKey] -= wallDamage;
        addFeed(`Enemy struck the wall at ${wallKey} for ${wallDamage}. ${Math.max(0, nextWallHp[wallKey])} HP remains.`, 'GRID');
        if (nextWallHp[wallKey] <= 0) delete nextWallHp[wallKey];
        return;
      }
      const turretKey = turrets.find((key) => {
        if ((nextWallHp[key] ?? 0) > 0) return false;
        const [turretX, turretY] = key.split(':').map(Number);
        return Math.hypot(enemy.x - turretX, enemy.y - turretY) <= 0.75;
      });
      if (turretKey) {
        nextTurretHealth[turretKey] = (nextTurretHealth[turretKey] ?? CONFIG.turretHp) - effectiveDamage;
        if (nextTurretHealth[turretKey] <= 0) {
          delete nextTurretHealth[turretKey];
          destroyedTurrets.push(turretKey);
          addFeed(`Enemy destroyed turret at ${turretKey}. No refund issued.`, 'TURRET');
        } else {
          addFeed(`Enemy struck turret at ${turretKey} for ${effectiveDamage}. ${nextTurretHealth[turretKey]} HP remains.`, 'TURRET');
        }
        return;
      }
      const tileKey = claimed.find((claimedKey) => {
        const [tileX, tileY] = claimedKey.split(':').map(Number);
        return Math.hypot(enemy.x - tileX, enemy.y - tileY) <= 0.75;
      });
      if (!tileKey) return;
      damageByTile[tileKey] = (damageByTile[tileKey] ?? 0) + effectiveDamage;
      nextBlockHp[tileKey] = Math.max(0, (nextBlockHp[tileKey] ?? 5) - effectiveDamage);
      addFeed(`Enemy damaged claimed block ${tileKey} for ${effectiveDamage}. ${Math.max(0, nextBlockHp[tileKey])} HP remains.`, 'GRID');
    });

    const destroyedTiles = Object.keys(damageByTile).filter((tileKey) => nextBlockHp[tileKey] <= 0);
    const remainingAfterDamage = claimed.filter((tileKey) => !destroyedTiles.includes(tileKey));
    const connectedAfterDamage = new Set(connectedTerritoryKeys(remainingAfterDamage, coreKey, waveBoardSize));
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
    setWalls(nextWallHp);
    setClaimed(remainingTerritory);
    setTurretHealth(nextTurretHealth);
    if (destroyedTurrets.length) {
      setTurrets((current) => current.filter((key) => !destroyedTurrets.includes(key)));
      setTurretStats((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !destroyedTurrets.includes(key))));
      if (selectedTurretKey && destroyedTurrets.includes(selectedTurretKey)) setSelectedTurretKey(null);
    }
    setBlockResources((current) => {
      const next = { ...current };
      removedTiles.forEach((tileKey) => delete next[tileKey]);
      return next;
    });
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
    if (remainingResources.oxygen < CONFIG.oxygenSurvivalMinimum) reasons.push(`oxygen fell below the survival minimum of ${CONFIG.oxygenSurvivalMinimum}`);
    if (remainingTerritory.length < 3) reasons.push('fewer than 3 claimed blocks remained');
    if (!coreSurvives) reasons.push('the core block was destroyed');
    if (reasons.length) {
      const reason = `You lost because ${reasons.join(' and ')}.`;
      setLossReason(reason);
      setGameState('gameover');
      addFeed(reason, 'FAIL');
    } else if (nextWave >= CONFIG.maxWaves) {
      setGameState('victory');
      addFeed('The outpost is stable enough for a deep-dive. The Mourner is waiting below.', 'CLEAR');
    }
    window.setTimeout(() => setPhase('play'), 900);
  };

  const callSupplyDrop = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    if (resources.signal < currentSupplyDropCost) {
      addFeed(`Need ${currentSupplyDropCost} Signal to call a supply drop.`, 'SUPPLY');
      return;
    }
    const availableTiles = Array.from({ length: boardSize * boardSize }, (_, index) => {
      const x = index % boardSize;
      const y = Math.floor(index / boardSize);
      const key = keyFor(x, y);
      return { x, y, key };
    }).filter(({ key }) => !claimed.includes(key) && !turrets.includes(key) && !(walls[key] ?? 0) && !supplyDrops.some((drop) => drop.x === Number(key.split(':')[0]) && drop.y === Number(key.split(':')[1])));
    if (!availableTiles.length) {
      addFeed('No unclaimed tile is available for a supply drop right now.', 'SUPPLY');
      return;
    }
    const candidate = availableTiles[Math.floor(Math.random() * availableTiles.length)];
    const callNumber = timesCalled + 1;
    const payload = getSupplyDropPayload(callNumber);
    captureAction();
    setResources((current) => ({
      ...current,
      signal: roundResourceValue(current.signal - currentSupplyDropCost),
    }));
    const drop: SupplyDrop = {
      id: Date.now() + Math.random(),
      x: candidate.x,
      y: candidate.y,
      resource: 'scavenge',
      amount: payload.scavenged,
      scavengedAmount: payload.scavenged,
      luminaeAmount: payload.luminae,
      createdTurn: turn,
      landTurn: turn + CONFIG.supplyDropDelayTurns,
      landed: false,
      delivered: false,
    };
    setSupplyDrops((current) => [...current, drop]);
    setTimesCalled(callNumber);
    addFeed(`Signal call-${callNumber} launched. Drop arrives after ${CONFIG.supplyDropDelayTurns} turns at ${candidate.x}, ${candidate.y}.`, 'SUPPLY');
  };

  const endTurn = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    historyRef.current = [];
    const nextTurn = turn + 1;
    const nextTurnsSinceWave = turnsSinceWave + 1;
    setTurn(nextTurn);
    setClaimBudget(claimMax);
    setEdgeWarning(false);
    addFeed(`Turn ${String(nextTurn).padStart(2, '0')} ready. Claim actions restored; movement and weapon cooldown continue in real time.`);
    if (nextTurnsSinceWave >= waveInterval) {
      setTurnsSinceWave(0);
      resolveWave(enemies);
    } else {
      setTurnsSinceWave(nextTurnsSinceWave);
    }

    const claimedKeys = new Set(claimed);
    const landingOnClaimed = supplyDrops.filter((drop) => !drop.landed && nextTurn >= drop.landTurn && claimedKeys.has(keyFor(drop.x, drop.y)));
    landingOnClaimed.forEach((drop) => {
      setResources((current) => ({
        ...current,
        scavenge: roundResourceValue(current.scavenge + drop.scavengedAmount),
        luminae: roundResourceValue(current.luminae + drop.luminaeAmount),
      }));
      addFeed(`Supply drop landed: +${drop.scavengedAmount} Scavenged and +${drop.luminaeAmount} Luminae.`, 'SUPPLY');
    });
    setSupplyDrops((current) => current
      .filter((drop) => !landingOnClaimed.some((landed) => landed.id === drop.id))
      .map((drop) => ({ ...drop, landed: drop.landed || nextTurn >= drop.landTurn })));
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

  const movementResourceCost = CONFIG.resourceUpgradeCosts.movement(upgrades.movement);
  const claimResourceCost = CONFIG.resourceUpgradeCosts.claim(upgrades.claim);
  const hullResourceCost = CONFIG.resourceUpgradeCosts.hull(upgrades.hull);

  const applyMovementRangeUpgrade = () => {
    setUpgrades((current) => ({ ...current, movement: current.movement + 1 }));
  };
  const applyClaimUpgrade = () => {
    setUpgrades((current) => ({ ...current, claim: current.claim + 1 }));
  };
  const applyHullUpgrade = () => {
    setUpgrades((current) => ({ ...current, hull: current.hull + 1 }));
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
    playerHpRef.current += CONFIG.healthPerUpgrade;
    setPlayerHp((current) => current + CONFIG.healthPerUpgrade);
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
    const cost = kind === 'damage' ? CONFIG.turretDamageUpgradeCost : CONFIG.turretCadenceUpgradeCost;
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
    if (resources.luminae < CONFIG.futureTurretUpgradeCostLuminae) {
      addFeed(`Future turret upgrades require ${CONFIG.futureTurretUpgradeCostLuminae} Luminae.`, 'TURRET');
      return;
    }
    captureAction();
    setResources((value) => ({ ...value, luminae: roundResourceValue(value.luminae - CONFIG.futureTurretUpgradeCostLuminae) }));
    setTurretBlueprint(next);
    addFeed(`Future turret ${kind} upgraded.`, 'TURRET');
  };

  const removeSelectedTurret = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    if (!selectedTurretKey || !turrets.includes(selectedTurretKey)) {
      addFeed('Select a built turret to remove it.', 'TURRET');
      return;
    }
    captureAction();
    const refund = roundResourceValue(CONFIG.turretBuildCostLuminae * CONFIG.turretRefundLuminae);
    setTurrets((current) => current.filter((key) => key !== selectedTurretKey));
    setTurretHealth((current) => {
      const next = { ...current };
      delete next[selectedTurretKey];
      return next;
    });
    setTurretStats((current) => {
      const next = { ...current };
      delete next[selectedTurretKey];
      return next;
    });
    setSelectedTurretKey(null);
    setResources((current) => ({ ...current, luminae: roundResourceValue(current.luminae + refund) }));
    addFeed(`Turret removed. +${refund.toFixed(1)} Luminae refunded.`, 'TURRET');
  };
  removeTurretRef.current = removeSelectedTurret;

  const xpUpgradeCost = CONFIG.xpUpgradeCostFormula(1);
  const upgradeMovementResource = () => spendResources(`Movement speed // ${formatOneDecimal(movementSpeed + CONFIG.movementSpeedPerLevel)}`, movementResourceCost, applyMovementRangeUpgrade);
  const upgradeClaimResource = () => spendResources(`Claim capacity // ${claimMax + 1}`, claimResourceCost, applyClaimUpgrade);
  const upgradeHullResource = () => spendResources(`Hull shielding // ${upgrades.hull + 1}`, hullResourceCost, applyHullUpgrade);
  const upgradeDamageXp = () => spendExperience(`Attack damage // ${attackDamage + CONFIG.attackDamageBase}`, xpUpgradeCost, applyDamageUpgrade);
  const upgradeRangeXp = () => spendExperience(`Attack range // ${attackRange + CONFIG.attackRangeBase}`, xpUpgradeCost, applyRangeUpgrade);
  const upgradeAttacksXp = () => spendExperience(`Targets per volley // ${attacksPerTurn + 1}`, xpUpgradeCost, applyAttacksUpgrade);
  const upgradeLuckXp = () => spendExperience(`Luck // +${luckDropBonus + 1} capture drop`, xpUpgradeCost, applyLuckUpgrade);
  const upgradeHealthXp = () => spendExperience(`Health // ${playerMaxHp + CONFIG.healthPerUpgrade} HP`, xpUpgradeCost, applyHealthUpgrade);

  claimActionRef.current = claimBlockUnderPlayer;
  undoActionRef.current = undoAction;
  endTurnActionRef.current = endTurn;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showUpgradePopover) {
        setShowUpgradePopover(false);
        return;
      }
      if (!isStarted || showHelp || gameState !== 'playing') return;
      if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        undoActionRef.current();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) {
        event.preventDefault();
        keysRef.current.add(event.key.toLowerCase());
      }
      if (event.key === ' ' && !event.repeat) {
        event.preventDefault();
        if (selectedEnemyIdRef.current !== null) handleAttackRef.current(selectedEnemyIdRef.current);
      }
      if (event.key.toLowerCase() === 'c') {
        setMode('claim');
        if (!event.repeat) claimActionRef.current();
      }
      if (event.key.toLowerCase() === 'm') setMode('move');
      if (event.key.toLowerCase() === 'f') setMode('attack');
      if (event.key.toLowerCase() === 'b') setMode('build');
      if (event.key.toLowerCase() === 'v') setMode('wall');
      if (event.key.toLowerCase() === 'x' && !event.repeat) removeTurretRef.current();
      if (event.key === 'Enter') endTurnActionRef.current();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const onBlur = () => keysRef.current.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gameState, isStarted, showHelp, showUpgradePopover]);

  useEffect(() => {
    const debugAll = () => {
      if (import.meta.env.DEV && isStarted && window.location.search.includes('debug=1')) {
        debugClaimAllTiles();
      }
    };
    debugAll();
  }, [isStarted]);

  useEffect(() => {
    if (phase === 'play') setWavePlan(createWavePlan(wave + 1, intensity, boardSize));
  }, [boardSize, intensity, phase, wave]);

  useEffect(() => {
    const gridWrap = gridWrapRef.current;
    if (!gridWrap) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextSize = Math.floor(Math.min(entry.contentRect.width / boardSize, entry.contentRect.height / boardSize));
      if (nextSize > 0) {
        gridMeasureReadyRef.current = true;
        setTilePixelSize(Math.max(CONFIG.minTileSize, nextSize));
      }
    });
    observer.observe(gridWrap);
    return () => observer.disconnect();
  }, [boardSize, isStarted]);

  useEffect(() => {
    if (!isStarted || gameState !== 'playing' || phase !== 'play') return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const delta = Math.min(0.05, (time - previousTime) / 1000);
      previousTime = time;
      renderAccumulatorRef.current += delta;
      attackCooldownRef.current = Math.max(0, attackCooldownRef.current - delta);
      const autoTarget = enemiesRef.current
        .map((enemy) => ({ enemy, distance: Math.hypot(playerRef.current[0] - enemy.x, playerRef.current[1] - enemy.y) }))
        .filter(({ distance }) => distance <= attackRange + WEAPON_RANGE_BUFFER)
        .sort((a, b) => a.distance - b.distance)[0];
      if (autoTarget && attackCooldownRef.current <= 0) handleAttackRef.current();
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
        const moveX = horizontal / directionLength;
        const moveY = vertical / directionLength;
        const travelDistance = movementSpeed * delta;
        const steps = Math.max(1, Math.ceil(travelDistance / 0.15));
        let nextX = currentX;
        let nextY = currentY;

        for (let step = 0; step < steps; step += 1) {
          const stepDistance = travelDistance / steps;
          const candidateX = clampPosition(nextX + moveX * stepDistance, boardSize);
          const candidateY = clampPosition(nextY + moveY * stepDistance, boardSize);
          if (!collidesWithWall(candidateX, candidateY, walls)) {
            nextX = candidateX;
            nextY = candidateY;
          } else {
            if (!collidesWithWall(candidateX, nextY, walls)) nextX = candidateX;
            if (!collidesWithWall(nextX, candidateY, walls)) nextY = candidateY;
          }
        }

        const touchingEdge = nextX <= 0.36 || nextY <= 0.36 || nextX >= boardSize - 0.36 || nextY >= boardSize - 0.36;
        playerRef.current = [nextX, nextY];
        setPlayer([nextX, nextY]);
        setEdgeWarning(touchingEdge && !allResourcesClaimed);
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

      const coreX = 4;
      const coreY = 4;
      setEnemies((current) => {
        if (!current.length) return current;
        let changed = false;
        const next = current.map((enemy) => {
          const currentCell: [number, number] = [Math.round(enemy.x), Math.round(enemy.y)];
          const currentKey = keyFor(currentCell[0], currentCell[1]);
          const isCentered = Math.abs(enemy.x - currentCell[0]) < 0.001 && Math.abs(enemy.y - currentCell[1]) < 0.001;
          if (isCentered && ((walls[currentKey] ?? 0) > 0 || claimed.includes(currentKey))) return enemy;
          let waypoint = enemy.waypoint;
          if (!waypoint && isCentered) {
            const path = findPathToCoreBreach(currentCell, [coreX, coreY], boardSize, walls, claimed);
            waypoint = path[1];
          }
          if (!waypoint) return enemy;
          const [waypointX, waypointY] = waypoint;
          const waypointKey = keyFor(waypointX, waypointY);
          const pathDistance = Math.abs(waypointX - enemy.x) + Math.abs(waypointY - enemy.y);
          const isBlockedTile = (walls[waypointKey] ?? 0) > 0 || claimed.includes(waypointKey);
          if (isBlockedTile && pathDistance <= CONFIG.territoryEngagementDistance) return enemy;
          const stepDistance = enemySpeedFor(enemy.movement) * delta;
          if (!isBlockedTile && pathDistance <= stepDistance) {
            changed = true;
            return { ...enemy, x: waypointX, y: waypointY, waypoint: undefined };
          }

          changed = true;
          const travelDistance = Math.min(
            stepDistance,
            Math.max(0, pathDistance - (isBlockedTile ? CONFIG.territoryEngagementDistance : 0)),
          );
          return {
            ...enemy,
            x: Math.abs(waypointY - enemy.y) < 0.001 ? enemy.x + Math.sign(waypointX - enemy.x) * travelDistance : enemy.x,
            y: Math.abs(waypointX - enemy.x) < 0.001 ? enemy.y + Math.sign(waypointY - enemy.y) * travelDistance : enemy.y,
            waypoint,
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
  }, [allResourcesClaimed, attackDamage, attackRange, boardSize, claimed, gameState, isStarted, phase, stats.targetsPerVolley, turretBlueprint, turretStats, turrets, upgrades.movement, walls]);

  const togglePause = () => {
    if (gameState === 'playing') setGameState('paused');
    else if (gameState === 'paused') setGameState('playing');
  };

  const handleTileClick = (x: number, y: number) => {
    const clickedKey = keyFor(x, y);
    if (mode === 'wall') {
      if ((walls[clickedKey] ?? 0) > 0) handleRemoveWall(x, y);
      else handleBuildWall(x, y);
      return;
    }
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
    if (mode === 'build') {
      handleBuildTurret(x, y);
    }
  };

  const resourceShortNames: Record<ResourceKey, string> = {
    oxygen: 'O₂',
    scavenge: 'R',
    luminae: 'L',
    signal: 'S',
  };
  const formatResourceCost = (cost: Partial<Resources>) =>
    Object.entries(cost).map(([key, amount]) => `${amount} ${resourceShortNames[key as ResourceKey]}`).join(' + ');
  const formatResourceAmount = (amount: number) => amount.toFixed(1).replace(/\.0$/, '');
  const canAffordResourceCost = (cost: Partial<Resources>) =>
    Object.entries(cost).every(([key, amount]) => resources[key as ResourceKey] >= (amount ?? 0));

  const resourceUpgradeRows = [
    { label: 'Movement speed', level: upgrades.movement, value: `SPD ${formatOneDecimal(movementSpeed)}`, next: `SPD ${formatOneDecimal(movementSpeed + CONFIG.movementSpeedPerLevel)}`, cost: movementResourceCost, action: upgradeMovementResource },
    { label: 'Claim capacity', level: upgrades.claim, value: `CLM ${claimMax}`, next: `CLM ${claimMax + 1}`, cost: claimResourceCost, action: upgradeClaimResource },
    { label: 'Hull shielding', level: upgrades.hull, value: `HUL ${stats.hullShielding}`, next: `HUL ${stats.hullShielding + 1}`, cost: hullResourceCost, action: upgradeHullResource },
  ];
  const xpUpgradeRows = [
    { label: 'Attack damage', level: upgrades.attackDamage, value: `DMG ${attackDamage}`, next: `DMG ${attackDamage + 1}`, action: upgradeDamageXp },
    { label: 'Attack range', level: upgrades.attackRange, value: `RNG ${attackRange}`, next: `RNG ${attackRange + 1}`, action: upgradeRangeXp },
    { label: 'Targets per volley', level: upgrades.attacks, value: `ATK ${attacksPerTurn}`, next: `ATK ${attacksPerTurn + 1}`, action: upgradeAttacksXp },
    { label: 'Luck', level: upgrades.luck, value: `DROP +${luckDropBonus}`, next: `DROP +${luckDropBonus + 1}`, detail: '+1 resource per captured drop', action: upgradeLuckXp },
    { label: 'Kael health', level: upgrades.health, value: `HP ${playerMaxHp}`, next: `HP ${playerMaxHp + 2}`, detail: '+2 maximum HP', action: upgradeHealthXp },
  ];
  const supplyDropTargetTiles = Array.from({ length: boardSize * boardSize }, (_, index) => {
    const x = index % boardSize;
    const y = Math.floor(index / boardSize);
    const key = keyFor(x, y);
    return { x, y, key };
  }).filter(({ key }) => !claimed.includes(key) && !turrets.includes(key) && !(walls[key] ?? 0) && !supplyDrops.some((drop) => drop.x === Number(key.split(':')[0]) && drop.y === Number(key.split(':')[1])));
  const selectedTurretStats = selectedTurretKey ? turretStats[selectedTurretKey] ?? turretBlueprint : null;

  if (!isStarted) {
    return (
      <main className="console-shell">
        <div className="start-screen" role="dialog" aria-modal="true">
          <div className="start-panel">
            <div className="eyebrow">Luminae // deep-water settlement</div>
            <h1 className="start-title">The Shallows</h1>
            <p className="start-subtitle">Claim a living frontier, hold the core, and survive the signal’s waves.</p>
            <div className="start-rule-grid">
              {startScreenSummary.map((item) => (
                <div key={item} className="start-rule-item">{item}</div>
              ))}
            </div>
            <div className="start-meta-grid">
              <div><span>Resources</span><strong>Scavenged, Luminae, Signal / Intel, XP</strong></div>
              <div><span>Goal</span><strong>Claim territory and keep Kael alive.</strong></div>
              <div><span>Turns</span><strong>Wave resolution every {waveIntervalFor(wave)} turns.</strong></div>
              <div><span>Rules</span><strong>Walls cost {CONFIG.wallBuildCostScavenged} Scavenged and turrets refund {CONFIG.turretRefundLuminae} Luminae when removed.</strong></div>
            </div>
            <div className="start-actions">
              <button className="console-button primary" onClick={handlePlay}>Play</button>
              <button className="console-button" onClick={() => { setIsStarted(true); setShowHelp(true); setGameState('paused'); }}>How to play</button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="console-shell">
      <header className="console-header">
        <div className="wordmark"><span className="wordmark-mark" aria-hidden="true" /><span>LUMINAE</span></div>
        <div className="header-status"><span className="status-dot" /><span className="mono">OUTPOST // PELAGOS-03</span><span>LOCAL CAMPAIGN</span></div>
        <div className="header-actions">
          <button className="console-button" onClick={openHelp} aria-label="Open help">? Help</button>
          <button className="console-button" onClick={togglePause} data-testid="button-pause" disabled={gameState === 'gameover' || gameState === 'victory'}>
            {gameState === 'paused' ? <Play size={14} /> : <Pause size={14} />}{gameState === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      <div className="console-main">
        <section className="campaign-bar" aria-label="Campaign heading">
          <div><div className="eyebrow">Campaign / A01 / live chart</div><h1 className="campaign-title">The Shallows <span>/ Sector 01</span></h1></div>
          <div className="action-row">
            <button className="console-button" onClick={undoAction} disabled={!historyRef.current.length || gameState !== 'playing' || phase !== 'play'} data-testid="button-undo"><Undo2 size={14} /> Undo action</button>
            <div className="upgrade-popover-anchor">
              <button className="console-button" onClick={() => setShowUpgradePopover((current) => !current)} aria-expanded={showUpgradePopover} aria-controls="upgrade-popover" data-testid="button-upgrades"><Zap size={14} /> Upgrades</button>
              {showUpgradePopover && (
                <div className="upgrade-popover" id="upgrade-popover" role="dialog" aria-label="All upgrades" onClick={(event) => event.stopPropagation()}>
                  <div className="upgrade-popover-heading"><div><span className="eyebrow">Workshop</span><h2>Upgrades</h2></div><button className="console-button" onClick={() => setShowUpgradePopover(false)}>Close</button></div>
                  <div className="upgrade-popover-scroll">
                    <section className="upgrade-popover-section" aria-label="Resource upgrades">
                      <h3>Resource upgrades</h3>
                      <div className="upgrade-list">
                        <button className="upgrade-row" onClick={repairSettlement} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < repairCost} title={resources.scavenge < repairCost ? `Need ${repairCost} Scavenged to repair.` : undefined}><span><strong>Repair weakest block</strong><small>+1 HP, +5 oxygen · {repairCost} R</small></span><ArrowRight size={13} /></button>
                      </div>
                      <div className="upgrade-list">
                        {resourceUpgradeRows.map((upgrade) => (
                          <div className="upgrade-row" key={upgrade.label}>
                            <div className="upgrade-summary"><strong>{upgrade.label} <em>LV {upgrade.level} · {upgrade.value} → {upgrade.next}</em></strong><small>Next level cost: {formatResourceCost(upgrade.cost)}</small></div>
                            <button className="upgrade-option" onClick={upgrade.action} disabled={gameState !== 'playing' || phase !== 'play' || !canAffordResourceCost(upgrade.cost)} title={!canAffordResourceCost(upgrade.cost) ? 'Insufficient resources for this upgrade.' : undefined}><span>RES</span>{formatResourceCost(upgrade.cost)}</button>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="upgrade-popover-section" aria-label="XP upgrades">
                      <div className="upgrade-popover-xp">
                        <div className="panel-heading"><h3>Combat XP</h3><span className="eyebrow">LEVEL {xpLevel} · BANK {xpBank}</span></div>
                        <div className="xp-copy"><span>Next progression threshold</span><strong>{xp} / {xpToNext} XP</strong></div>
                        <div className="xp-bar"><span style={{ width: `${Math.min(100, xp / xpToNext * 100)}%` }} /></div>
                      </div>
                      <h3>XP upgrades</h3>
                      <div className="upgrade-list xp-upgrade-list">
                        {xpUpgradeRows.map((upgrade) => (
                          <div className="upgrade-row" key={upgrade.label}>
                            <div className="upgrade-summary"><strong>{upgrade.label} <em>LV {upgrade.level} · {upgrade.value} → {upgrade.next}</em></strong><small>{'detail' in upgrade ? upgrade.detail : `Next level cost: ${xpUpgradeCost} XP`}</small></div>
                            <button className="upgrade-option xp-option" onClick={upgrade.action} disabled={gameState !== 'playing' || phase !== 'play' || xpBank < xpUpgradeCost} title={xpBank < xpUpgradeCost ? `Need ${xpUpgradeCost} spendable XP point${xpUpgradeCost === 1 ? '' : 's'}.` : undefined}><span>XP</span>{xpUpgradeCost} XP</button>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="upgrade-popover-section" aria-label="Turret upgrades">
                      <h3>Turret upgrades</h3>
                      <p className="upgrade-popover-note">{selectedTurretKey ? `Selected ${selectedTurretKey} · ${turretHealth[selectedTurretKey] ?? CONFIG.turretHp} HP · range ${CONFIG.turretRange + ((walls[selectedTurretKey] ?? 0) > 0 ? CONFIG.wallTurretRangeBonus : 0)} · min ${((walls[selectedTurretKey] ?? 0) > 0 ? CONFIG.wallTurretMinRange : CONFIG.turretMinRange)}` : 'Select a turret on the chart.'}</p>
                      <div className="upgrade-list xp-upgrade-list">
                        <div className="upgrade-row"><div className="upgrade-summary"><strong>Selected turret damage</strong><small>{selectedTurretStats ? `${selectedTurretStats.damage} → ${selectedTurretStats.damage + 1} damage` : 'Select a turret'} · {CONFIG.turretDamageUpgradeCost} R</small></div><button className="upgrade-option" onClick={() => upgradeSelectedTurret('damage')} disabled={!selectedTurretKey || resources.scavenge < CONFIG.turretDamageUpgradeCost}><span>RES</span>{CONFIG.turretDamageUpgradeCost} R</button></div>
                        <div className="upgrade-row"><div className="upgrade-summary"><strong>Selected turret cadence</strong><small>{selectedTurretStats ? `${selectedTurretStats.interval} → ${Math.max(1, selectedTurretStats.interval - 1)} seconds` : 'Select a turret'} · {CONFIG.turretCadenceUpgradeCost} R</small></div><button className="upgrade-option" onClick={() => upgradeSelectedTurret('interval')} disabled={!selectedTurretKey || resources.scavenge < CONFIG.turretCadenceUpgradeCost || (selectedTurretStats?.interval ?? turretBlueprint.interval) <= 1}><span>RES</span>{CONFIG.turretCadenceUpgradeCost} R</button></div>
                        <div className="upgrade-row"><div className="upgrade-summary"><strong>Remove turret</strong><small>Refund +{CONFIG.turretBuildCostLuminae * CONFIG.turretRefundLuminae} Luminae · X</small></div><button className="upgrade-option xp-option" onClick={removeSelectedTurret} disabled={!selectedTurretKey || gameState !== 'playing' || phase !== 'play'}><span>L</span>+{CONFIG.turretBuildCostLuminae * CONFIG.turretRefundLuminae}</button></div>
                        <div className="upgrade-row"><div className="upgrade-summary"><strong>Future turret damage</strong><small>{turretBlueprint.damage} → {turretBlueprint.damage + 1} damage · {CONFIG.futureTurretUpgradeCostLuminae} Luminae</small></div><button className="upgrade-option xp-option" onClick={() => upgradeFutureTurret('damage')} disabled={resources.luminae < CONFIG.futureTurretUpgradeCostLuminae}><span>L</span>{CONFIG.futureTurretUpgradeCostLuminae} L</button></div>
                        <div className="upgrade-row"><div className="upgrade-summary"><strong>Future turret cadence</strong><small>{turretBlueprint.interval} → {Math.max(1, turretBlueprint.interval - 1)} seconds · {CONFIG.futureTurretUpgradeCostLuminae} Luminae</small></div><button className="upgrade-option xp-option" onClick={() => upgradeFutureTurret('interval')} disabled={resources.luminae < CONFIG.futureTurretUpgradeCostLuminae || turretBlueprint.interval <= 1}><span>L</span>{CONFIG.futureTurretUpgradeCostLuminae} L</button></div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </div>
            <button className="console-button danger" onClick={resetGame} data-testid="button-restart"><RotateCcw size={14} /> Restart campaign</button>
          </div>
        </section>

        <div className="game-layout">
          <section className={`board-frame ${phase === 'wave' ? 'wave-pulse' : ''}`} aria-label="Playable settlement chart">
            {edgeWarning && <div className="edge-banner" data-testid="status-edge-warning"><AlertTriangle size={16} /><span>Outer ring reached. Claim all resource blocks to expand by one row and one column.</span></div>}

            <div className="grid-wrap" ref={gridWrapRef}>
              <div className="free-board" style={{ width: `${tilePixelSize * boardSize}px`, height: `${tilePixelSize * boardSize}px` }}>
                <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}>
                  {tiles.map((tile) => {
                    const tileKey = keyFor(tile.x, tile.y);
                    const isClaimed = claimed.includes(tileKey);
                    const isClaimTarget = claimTarget?.x === tile.x && claimTarget?.y === tile.y;
                    const isCore = tileKey === coreKey;
                    const isWarning = outerBuffer(tile.x, tile.y);
                    const wallHealth = walls[tileKey] ?? 0;
                    const isTurret = turrets.includes(tileKey);
                    const resource = resourceForTile[tile.type];
                    const supplyDrop = supplyDrops.find((drop) => drop.x === tile.x && drop.y === tile.y);
                    const isRoutePreview = routePreviewSet.has(tileKey);
                    return (
                      <button
                        key={tileKey}
                        className={`tile tile-type-${tile.type} ${isClaimed ? 'claimed' : 'neutral-tile'} ${isCore ? 'core' : ''} ${isClaimTarget ? 'claimable' : ''} ${isClaimTarget && canClaimTarget ? 'claim-ready' : ''} ${isWarning && edgeWarning ? 'edge-warning' : ''} ${isTurret ? 'turret-tile' : ''} ${wallHealth > 0 ? 'wall-tile' : ''} ${isRoutePreview ? 'claim-ready' : ''} ${mode === 'wall' && wallPreviewKey === tileKey ? 'wall-preview' : ''}`}
                        onClick={() => handleTileClick(tile.x, tile.y)}
                        onMouseEnter={() => mode === 'wall' && setWallPreviewKey(tileKey)}
                        onMouseLeave={() => setWallPreviewKey(null)}
                        data-testid={`tile-${tile.x}-${tile.y}`}
                        aria-label={`${tileNames[tile.type]} at ${tile.x}, ${tile.y}${resource ? ', resource node' : ''}${isClaimed ? `, claimed, ${blockHp[tileKey] ?? 5} HP` : ''}${wallHealth > 0 ? `, wall, ${wallHealth} HP` : ''}${isTurret ? ', turret' : ''}${supplyDrop ? `, supply drop ${supplyDrop.resource}` : ''}`}
                        style={isRoutePreview ? { boxShadow: 'inset 0 0 0 2px rgba(110, 231, 183, 0.9)' } : undefined}
                      >
                        <span className="tile-glyph">{supplyDrop ? 'D' : isTurret ? 'T' : wallHealth > 0 ? 'W' : tileGlyphs[tile.type]}</span>
                        {(isClaimed || isTurret || wallHealth > 0) && <span className="tile-health">{wallHealth > 0 ? `${wallHealth} HP` : isTurret ? `${turretHealth[tileKey] ?? CONFIG.turretHp} HP` : `${blockHp[tileKey] ?? 5} HP`}</span>}
                        {supplyDrop && <span className="tile-health">{supplyDrop.landed ? 'LANDED' : `${Math.max(0, supplyDrop.landTurn - turn)}T`}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="entity-layer" aria-label="Free movement layer">
                  {phase === 'play' && nextWaveIn === 1 && showEnemyPaths && (
                    <svg className="enemy-path-overlay" viewBox={`0 0 ${boardSize} ${boardSize}`} preserveAspectRatio="none" aria-label="Planned enemy routes">
                      {plannedRoutes.map(({ enemy, path }) => (
                        <g key={`route-${enemy.id}`} className={`enemy-route ${enemy.kind}`}>
                          <polyline points={path.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(' ')} />
                          {path[0] && <circle cx={path[0][0] + 0.5} cy={path[0][1] + 0.5} r="0.14" />}
                        </g>
                      ))}
                    </svg>
                  )}
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
                    const wallMounted = (walls[turretKey] ?? 0) > 0;
                    const turretRange = TURRET_ATTACK_RANGE + (wallMounted ? CONFIG.wallTurretRangeBonus : 0);
                    return (
                      <Fragment key={`range-${turretKey}`}>
                        <span
                          className={`attack-range-ring turret-range-ring ${selectedTurretKey === turretKey ? 'selected-range' : ''}`}
                          style={{
                            left: `${((turretX + 0.5) / boardSize) * 100}%`,
                            top: `${((turretY + 0.5) / boardSize) * 100}%`,
                            width: `${(turretRange * 2 / boardSize) * 100}%`,
                            height: `${(turretRange * 2 / boardSize) * 100}%`,
                          }}
                          aria-hidden="true"
                        />
                        {wallMounted && <span
                          className="attack-range-ring turret-min-range-ring"
                          style={{
                            left: `${((turretX + 0.5) / boardSize) * 100}%`,
                            top: `${((turretY + 0.5) / boardSize) * 100}%`,
                            width: `${(CONFIG.wallTurretMinRange * 2 / boardSize) * 100}%`,
                            height: `${(CONFIG.wallTurretMinRange * 2 / boardSize) * 100}%`,
                          }}
                          aria-hidden="true"
                        />}
                      </Fragment>
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

            <div className="turn-controls">
              <div className="mode-toggle" aria-label="Action mode">
                <button className={mode === 'move' ? 'active' : ''} onClick={() => setMode('move')} data-testid="button-mode-move">Move <span className="mono">M</span></button>
                <button className={mode === 'claim' ? 'active' : ''} onClick={() => { setMode('claim'); claimBlockUnderPlayer(); }} data-testid="button-mode-claim">Claim nearby block <span className="mono">C</span></button>
                <button className={mode === 'attack' ? 'active attack-mode' : ''} onClick={() => setMode('attack')} data-testid="button-mode-attack">Weapon <span className="mono">F</span></button>
                <button className={mode === 'build' ? 'active build-mode' : ''} onClick={() => setMode('build')} data-testid="button-mode-build">Turret <span className="mono">B</span></button>
                <button className={mode === 'wall' ? 'active build-mode' : ''} onClick={() => setMode('wall')} data-testid="button-mode-wall" disabled={resources.scavenge + Number.EPSILON < CONFIG.wallBuildCostScavenged && Object.keys(walls).length === 0} title={resources.scavenge + Number.EPSILON < CONFIG.wallBuildCostScavenged && Object.keys(walls).length === 0 ? `Need ${CONFIG.wallBuildCostScavenged} Scavenged to build a wall.` : `Build a wall for ${CONFIG.wallBuildCostScavenged} Scavenged or dismantle an existing wall.`}>
                  Wall · {CONFIG.wallBuildCostScavenged} R <span className="mono">V</span>
                </button>
              </div>
              <button className="console-button primary" onClick={endTurn} disabled={gameState !== 'playing' || phase !== 'play'} data-testid="button-end-turn">End turn <ArrowRight size={14} /></button>
            </div>
          </section>

          <aside className="sidebar-stack">
            <section className="hud-strip sidebar-hud" aria-label="Campaign status">
              <div className="hud-stat"><span className="eyebrow">Claim</span><strong className="hud-stat-value warn" data-testid="status-claim">{claimBudget} / {claimMax}</strong></div>
              <div className="hud-stat"><span className="eyebrow">Weapon</span><strong className="hud-stat-value danger" data-testid="status-attack">{attackCooldown > 0 ? `READY ${attackCooldown.toFixed(1)}s` : `READY · ${attackRange} RNG`}</strong></div>
              <div className="hud-stat"><span className="eyebrow">Kael HP</span><strong className={`hud-stat-value ${playerHp <= 3 ? 'danger' : 'good'}`} data-testid="status-player-hp">{playerHp} / {playerMaxHp}</strong></div>
            </section>
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
                    <span className={`resource-mark tile-type-${key}`}><Icon size={11} /></span><span className="resource-name">{name}</span><strong className="resource-value">{formatResourceAmount(resources[key])}</strong><div className="resource-bar"><span style={{ width: `${Math.min(100, Math.max(0, resources[key] / max * 100))}%` }} /></div>
                  </div>
                ))}
              </div>
              <button className="upgrade-row" onClick={healPlayer} disabled={gameState !== 'playing' || phase !== 'play' || resources.luminae < healCost || playerHp >= playerMaxHp}><span><strong>Heal Kael</strong><small>+{healAmount} HP · 1 Luminae</small></span><ArrowRight size={13} /></button>
              <button
                className="upgrade-row"
                onClick={callSupplyDrop}
                disabled={gameState !== 'playing' || phase !== 'play' || resources.signal < currentSupplyDropCost || supplyDropTargetTiles.length === 0}
                title={supplyDropTargetTiles.length === 0 ? 'No unclaimed tile is available for a supply drop.' : resources.signal < currentSupplyDropCost ? `Need ${currentSupplyDropCost} Signal.` : undefined}
              >
                <span>
                  <strong>Call supply drop</strong>
                  <small>Cost {currentSupplyDropCost} Signal · {getSupplyDropPayload(timesCalled + 1).scavenged} Scavenged + {getSupplyDropPayload(timesCalled + 1).luminae} Luminae</small>
                </span>
                <ArrowRight size={13} />
              </button>
            </section>

            <section className="panel experience-panel" aria-label="Combat experience">
              <div className="panel-heading"><h2>Combat XP</h2><span className="eyebrow">LEVEL {xpLevel} · BANK {xpBank}</span></div>
              <div className="xp-copy"><span>Next progression threshold</span><strong>{xp} / {xpToNext} XP</strong></div>
              <div className="xp-bar"><span style={{ width: `${Math.min(100, xp / xpToNext * 100)}%` }} /></div>
              <div className="xp-foot"><span><Zap size={11} /> Level-ups grant XP equal to the new level</span><span>Spendable: {xpBank}</span></div>
            </section>

            <section className="panel" aria-label="Crew status">
              <div className="panel-heading"><h2>Crew channel</h2><span className="eyebrow">ACTIVE</span></div>
               <div className="character-card"><div className="character-sigil">K/01</div><div><h3 className="character-name">Kael</h3><p className="character-role">Maintenance / settlement core</p><div className="character-stats"><span className="stat-chip">SPD {formatOneDecimal(movementSpeed)}</span><span className="stat-chip">DMG {attackDamage}</span><span className="stat-chip">RNG {attackRange}</span><span className="stat-chip">TARGETS {stats.targetsPerVolley}</span><span className="stat-chip">LUCK +{luckDropBonus}</span><span className="stat-chip">CLM {claimMax}</span></div></div></div>
              {miraUnlocked && <div className="mira-card" data-testid="status-mira"><strong>Mira // signal analyst</strong><p>New channel unlocked. She can hear a pattern inside the pain signal.</p></div>}
            </section>

            <section className="panel" aria-label="Wave forecast">
              <div className="panel-heading"><h2>Wave forecast</h2><button className="console-button" onClick={() => setShowEnemyPaths((current) => !current)} aria-pressed={showEnemyPaths}>{showEnemyPaths ? 'Hide paths' : 'Show enemy paths'}</button><Waves size={15} color="hsl(var(--accent))" /></div>
              <div className="forecast"><div className="eyebrow">Next resolution in {nextWaveIn} turn{nextWaveIn === 1 ? '' : 's'} · interval {waveInterval}</div><div className="forecast-track">{Array.from({ length: waveInterval }, (_, index) => <span className={`forecast-segment ${index < turnsSinceWave ? 'active' : ''}`} key={index} />)}</div><div className="forecast-labels"><span>WAVES 1–2: 5T</span><span>3–4: 4T</span><span>5–6: 3T</span></div></div>
              <div className="forecast"><div className="eyebrow">Next wave plan</div><div className="forecast-labels"><span>{nextWavePlan.drifters} drifter{nextWavePlan.drifters === 1 ? '' : 's'}</span><span>{nextWavePlan.razor ? `${nextWavePlan.razor} razor` : 'no razor'}</span><span>{nextWavePlan.siege ? `${nextWavePlan.siege} siege` : 'no siege'}</span></div></div>
            </section>

            <section className="panel" aria-label="Discovery feed"><div className="panel-heading"><h2>Discovery feed</h2><Info size={15} color="hsl(var(--muted-foreground))" /></div><div className="feed">{feed.map((item) => <div className="feed-item" key={item.id} data-testid={`feed-${item.id}`}><span className="feed-time">{item.label}</span><span>{item.text}</span></div>)}</div></section>
          </aside>
        </div>

        <div className="message-feed" role="status" data-testid="status-message">
          <strong>{phase === 'wave' ? 'WAVE' : mode === 'claim' ? 'CLAIM' : mode === 'attack' ? 'COMBAT' : mode === 'build' ? 'TURRET' : mode === 'wall' ? 'WALL' : 'KAEL'}</strong>
          {phase === 'wave' ? 'The water shifts around the claimed blocks. Hold position while the pressure passes.' : mode === 'claim' ? `Stand within ${CONFIG.claimRadius} tiles of the highlighted block and press C. ${claimBudget} claim action${claimBudget === 1 ? '' : 's'} remaining.` : mode === 'attack' ? `Kael deals ${attackDamage} damage within ${attackRange} tiles. Click a hostile or press Space to fire.` : mode === 'build' ? `Spend ${CONFIG.turretBuildCostLuminae} Luminae to place a turret on an adjacent claimed empty block or a wall. Wall mounts gain range. Turrets fire every ${CONFIG.turretFireInterval} seconds within ${CONFIG.turretRange} tiles.` : mode === 'wall' ? `Spend ${CONFIG.wallBuildCostScavenged} Scavenged to add a wall on a non-resource block; walls hold ${CONFIG.wallHp} HP.` : 'Move freely through the chart. Claim all resource blocks to expand by one row and one column.'}
        </div>
      </div>

      {showHelp && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="overlay-card help-card">
            <div className="eyebrow">How to play</div>
            <h2>Operation guide</h2>
            <div className="help-scroll">
              <section>
                <h3>Controls</h3>
                <p>Move with WASD or arrow keys, press C to claim, F to enter weapon mode, B to build, V for Wall mode, X to remove a selected turret, and Enter to end the turn. Kael automatically fires at the nearest target in range; the ? button pauses the game.</p>
              </section>
              <section>
                <h3>Turn flow</h3>
                <p>Turns advance only when End turn or Enter is used. Claim actions restore then; wave resolution occurs after {waveIntervalFor(wave)} turns, and Kael's weapon cooldown runs continuously in real time.</p>
              </section>
              <section>
                <h3>Resources</h3>
                <p>Oxygen supports the outpost, Scavenged fuels repairs and walls, Luminae funds turrets and healing, and Signal / Intel pays for supply calls.</p>
              </section>
              <section>
                <h3>Field legend</h3>
                <div className="legend-list">
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(194 75% 68%)' }}>O₂</span> Oxygen reserve</div>
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(39 88% 65%)' }}>R</span> Repair material</div>
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(168 82% 70%)' }}>L</span> Luminae growth</div>
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(194 75% 68%)' }}>D</span> Drifter route · shortest-cost path</div>
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(2 84% 72%)' }}>RZ</span> Razor route · red</div>
                  <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(22 92% 67%)' }}>SG</span> Siege route · orange</div>
                </div>
              </section>
              <section>
                <h3>Survival protocol</h3>
                <ol className="help-survival-list">
                  <li>Move Kael freely with WASD or the arrow keys; resources stay locked to the chart grid.</li>
                  <li>Stand within claim range of a connected unclaimed block and press C. Claim actions restore when the turn advances.</li>
                  <li>Kael automatically targets the nearest hostile in range, hitting up to the current targets-per-volley stat. Click a hostile or press Space to fire manually.</li>
                  <li>Claim all resource blocks to expand the chart by one row and one column. Claimed territory must stay connected to the core.</li>
                </ol>
              </section>
              <section>
                <h3>Upgrades</h3>
                <p>Movement, claim capacity, and hull shielding are resource upgrades. Damage, range, attacks per volley, luck, and max health are XP upgrades. Values are always derived from the live stats selector.</p>
              </section>
              <section>
                <h3>Walls and turrets</h3>
                <p>Walls cost {CONFIG.wallBuildCostScavenged} Scavenged and can sit on any claimed or unclaimed non-resource tile unless occupied by Kael or an enemy. Wall mode dismantles walls; a mounted turret is removed with the wall and refunds {CONFIG.turretRefundLuminae} Luminae. A turret on a wall gains +{CONFIG.wallTurretRangeBonus} range and a {CONFIG.wallTurretMinRange}-tile minimum range.</p>
              </section>
              <section>
                <h3>Supply drops</h3>
                <p>Call a drop with {CONFIG.supplyDropBaseCost} Signal plus the current call count. Each crate carries {CONFIG.supplyDropPayloadScavenged(1)} Scavenged and {CONFIG.supplyDropPayloadLuminae(1)} Luminae on the first call, and the amounts scale with each call. Drops arrive after {CONFIG.supplyDropDelayTurns} turns and pay out when their tile is claimed.</p>
              </section>
              <section>
                <h3>Enemies</h3>
                <p>U = wave − 1. Each wave adds +1 HP, +1 damage, and +1 movement stat. Speed is {CONFIG.enemyMoveSpeed} + max(0, movement stat − 1) × {CONFIG.enemyMovementSpeedPerStat} tiles/s.</p>
                <table className="enemy-stat-table">
                  <thead><tr><th>Unit</th><th>Wave</th><th>HP</th><th>DMG</th><th>Move</th><th>Speed</th></tr></thead>
                  <tbody>{(['drifter', 'razor', 'siege'] as EnemyKind[]).flatMap((kind) => [Math.max(1, wave), Math.max(1, wave) + 1].map((waveNumber) => {
                    const values = enemyStats(kind, waveNumber);
                    return <tr key={`${kind}-${waveNumber}`}><th>{kind}</th><td>{waveNumber}</td><td>{values.hp}</td><td>{values.damage}</td><td>{values.movement}</td><td>{enemySpeedFor(values.movement).toFixed(2)}</td></tr>;
                  }))}</tbody>
                </table>
                <p>Enemies spawn on the chart edge and follow a shortest-cost route to the nearest claimed block before the core. Walls and claimed blocks cost more to cross, and enemies move one horizontal or vertical tile at a time. They stop at each claimed block and damage it during wave resolution; they can pass only after it is destroyed. Once no other claimed blocks remain, they can breach the core. At a blocked tile, a wall is hit first, then an exposed turret, then the claimed block. While active, any enemy within {ENEMY_ATTACK_RANGE} tiles damages Kael every {ENEMY_CONTACT_INTERVAL} seconds. Hull reduces wall, turret, block, and oxygen damage with a floor of 1.</p>
              </section>
            </div>
            <div className="action-row">
              <button className="console-button primary" onClick={closeHelp}>Close</button>
            </div>
          </div>
        </div>
      )}
      {(gameState === 'paused' || gameState === 'gameover' || gameState === 'victory') && !showHelp && (
        <div className={`overlay ${gameState === 'paused' ? '' : 'end-state-overlay'}`} role="dialog" aria-modal="true">
          <div className="overlay-card">
            <div className="eyebrow">{gameState === 'paused' ? 'SYSTEM PAUSED' : gameState === 'victory' ? 'SIGNAL STABILIZED' : 'LIFE SUPPORT OFFLINE'}</div>
            <h2>{gameState === 'paused' && 'Hold the line.'}{gameState === 'victory' && 'The sea is listening.'}{gameState === 'gameover' && 'The outpost went dark.'}</h2>
            <p>{gameState === 'paused' && 'The chart is safe. Take a breath, then return to the water when you are ready.'}{gameState === 'victory' && `${CONFIG.maxWaves} waves survived. The path to the Mourner is open; this settlement can now prepare a healing descent.`}{gameState === 'gameover' && <><strong>Why you lost:</strong> {lossReason || 'Settlement survival conditions were breached.'}<br /><br /><strong>Oxygen rule:</strong> keep at least {CONFIG.oxygenSurvivalMinimum} O₂ in reserve.</>}</p>
            <div className="action-row">{gameState === 'paused' && <button className="console-button primary" onClick={togglePause} data-testid="button-resume"><Play size={14} /> Resume chart</button>}{(gameState === 'gameover' || gameState === 'victory') && <button className="console-button primary" onClick={resetGame} data-testid="button-restart-overlay"><RotateCcw size={14} /> Restart campaign</button>}</div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
