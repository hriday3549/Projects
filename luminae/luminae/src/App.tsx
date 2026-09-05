import { useEffect, useMemo, useState } from 'react';
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
  Waves,
  Wind,
} from 'lucide-react';

type TileType = 'oxygen' | 'scavenge' | 'luminae' | 'signal' | 'blank';
type ResourceKey = 'oxygen' | 'scavenge' | 'luminae' | 'signal';
type ActionMode = 'move' | 'claim' | 'attack' | 'build';
type GameState = 'playing' | 'paused' | 'gameover' | 'victory';
type EnemyKind = 'drifter' | 'razor';

type Resources = Record<ResourceKey, number>;
type FeedItem = { id: number; label: string; text: string };
type Enemy = { id: number; x: number; y: number; kind: EnemyKind; hp: number };
type Upgrades = { movement: number; claim: number; hull: number };

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
};

const initialBlockHp: Record<string, number> = {
  '4:4': 5,
  '4:5': 3,
  '5:4': 3,
  '3:4': 3,
};

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

function tileTypeAt(x: number, y: number, boardSize: number): TileType {
  const value = (x * 17 + y * 31 + boardSize * 13 + x * y * 7) % 19;
  if (value === 2 || value === 11) return 'oxygen';
  if (value === 4 || value === 8 || value === 16) return 'scavenge';
  if (value === 6 || value === 15) return 'luminae';
  if (value === 9 || value === 14) return 'signal';
  return 'blank';
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
  for (let index = 0; index < boardSize && candidates.length < count; index += 2) {
    candidates.push([index, 0]);
    if (candidates.length < count) candidates.push([boardSize - 1, boardSize - 1 - index]);
    if (candidates.length < count) candidates.push([boardSize - 1 - index, boardSize - 1]);
    if (candidates.length < count) candidates.push([0, index]);
  }
  return candidates.slice(0, count);
}

function App() {
  const [boardSize, setBoardSize] = useState(8);
  const [player, setPlayer] = useState<[number, number]>([4, 4]);
  const [claimed, setClaimed] = useState<string[]>(['4:4', '4:5', '5:4', '3:4']);
  const [resources, setResources] = useState<Resources>(initialResources);
  const [upgrades, setUpgrades] = useState<Upgrades>(initialUpgrades);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [blockHp, setBlockHp] = useState<Record<string, number>>(initialBlockHp);
  const [turrets, setTurrets] = useState<string[]>([]);
  const [turn, setTurn] = useState(1);
  const [wave, setWave] = useState(0);
  const [intensity, setIntensity] = useState(1);
  const [movement, setMovement] = useState(3);
  const [claimBudget, setClaimBudget] = useState(2);
  const [attackBudget, setAttackBudget] = useState(1);
  const [mode, setMode] = useState<ActionMode>('move');
  const [gameState, setGameState] = useState<GameState>('playing');
  const [phase, setPhase] = useState<'play' | 'wave'>('play');
  const [edgeWarning, setEdgeWarning] = useState(false);
  const [miraUnlocked, setMiraUnlocked] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: 1, label: 'T+00', text: 'Kael is online. Core territory is holding.' },
    { id: 2, label: 'LOG', text: 'Claiming is a free action. Stay deliberate.' },
  ]);

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
  const claimMax = 2 + upgrades.claim;
  const nextWaveIn = 5 - ((turn - 1) % 5);
  const coreKey = keyFor(boardSize > 8 ? 6 : 4, boardSize > 8 ? 6 : 4);
  const playerKey = keyFor(player[0], player[1]);
  const outerBuffer = (x: number, y: number) =>
    x <= 1 || y <= 1 || x >= boardSize - 2 || y >= boardSize - 2;
  const atOuterEdge = (x: number, y: number) =>
    x === 0 || y === 0 || x === boardSize - 1 || y === boardSize - 1;

  const addFeed = (text: string, label = `T+${String(turn).padStart(2, '0')}`) => {
    setFeed((current) => [
      { id: Date.now() + Math.random(), label, text },
      ...current,
    ].slice(0, 7));
  };

  const resetGame = () => {
    setBoardSize(8);
    setPlayer([4, 4]);
    setClaimed(['4:4', '4:5', '5:4', '3:4']);
    setResources(initialResources);
    setUpgrades(initialUpgrades);
    setEnemies([]);
    setBlockHp(initialBlockHp);
    setTurrets([]);
    setTurn(1);
    setWave(0);
    setIntensity(1);
    setMovement(3);
    setClaimBudget(2);
    setAttackBudget(1);
    setMode('move');
    setPhase('play');
    setGameState('playing');
    setEdgeWarning(false);
    setMiraUnlocked(false);
    setFeed([
      { id: Date.now(), label: 'T+00', text: 'Campaign restarted. Core territory is holding.' },
      { id: Date.now() + 1, label: 'LOG', text: 'Reach the outer ring to chart new water.' },
    ]);
  };

  const expandBoard = (x: number, y: number) => {
    const offset = 2;
    setBoardSize((current) => current + 4);
    setPlayer([x + offset, y + offset]);
    setClaimed((current) => current.map((tileKey) => addOffsetToKey(tileKey, offset)));
    setTurrets((current) => current.map((tileKey) => addOffsetToKey(tileKey, offset)));
    setBlockHp((current) =>
      Object.fromEntries(Object.entries(current).map(([tileKey, hp]) => [addOffsetToKey(tileKey, offset), hp])),
    );
    setEdgeWarning(false);
    addFeed('Chart boundary breached. New water is being rendered around the settlement.', 'AUTO');
  };

  const handleMove = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const distance = Math.abs(player[0] - x) + Math.abs(player[1] - y);
    if (distance !== 1) {
      return;
    }
    if (movement <= 0) {
      addFeed('Movement reserve exhausted. End the turn or claim nearby water.');
      return;
    }
    if (atOuterEdge(x, y) && boardSize < 16) {
      expandBoard(x, y);
    } else {
      setPlayer([x, y]);
      if (outerBuffer(x, y) && boardSize < 16) {
        setEdgeWarning(true);
        addFeed('Boundary pressure detected. One more step into the outer ring will expand the chart.', 'WARN');
      }
    }
    setMovement((current) => current - 1);
  };

  const handleClaim = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const distance = Math.abs(player[0] - x) + Math.abs(player[1] - y);
    const tileKey = keyFor(x, y);
    if (distance > 1) {
      addFeed('That tile is outside Kael’s claim radius.');
      return;
    }
    if (claimed.includes(tileKey)) {
      addFeed('That tile is already part of the settlement.');
      return;
    }
    if (turrets.includes(tileKey)) {
      addFeed('That tile is occupied by a turret. Build on neutral water instead.');
      return;
    }
    if (claimBudget <= 0) {
      addFeed('Claim reserve exhausted. The next turn will restore it.');
      return;
    }
    const type = tileTypeAt(x, y, boardSize);
    const resource = resourceForTile[type];
    setClaimed((current) => [...current, tileKey]);
    setBlockHp((current) => ({ ...current, [tileKey]: 3 }));
    setClaimBudget((current) => current - 1);
    if (resource) {
      const yieldAmount = resource === 'scavenge' ? 5 : 1;
      setResources((current) => ({ ...current, [resource]: current[resource] + yieldAmount }));
      addFeed(`${tileNames[type]} secured. ${tileNames[type]} yield +${yieldAmount}.`);
      return;
    }
    addFeed(`${tileNames[type]} secured. No yield detected.`);
  };

  const handleAttack = (x: number, y: number) => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const enemy = enemies.find((candidate) => candidate.x === x && candidate.y === y);
    if (!enemy) {
      addFeed('No hostile contact at that coordinate.');
      return;
    }
    const distance = Math.abs(player[0] - x) + Math.abs(player[1] - y);
    if (distance > 1) {
      addFeed('Hostile is outside Kael’s attack range.');
      return;
    }
    if (attackBudget <= 0) {
      addFeed('Attack reserve exhausted. The next turn will restore it.');
      return;
    }
    const remainingHp = enemy.hp - 1;
    setAttackBudget((current) => current - 1);
    if (remainingHp <= 0) {
      setEnemies((current) => current.filter((candidate) => candidate.id !== enemy.id));
      addFeed(`${enemy.kind === 'razor' ? 'Razor' : 'Drifter'} neutralized. The perimeter is quieter.`, 'COMBAT');
    } else {
      setEnemies((current) => current.map((candidate) => candidate.id === enemy.id ? { ...candidate, hp: remainingHp } : candidate));
      addFeed(`Hostile damaged. ${remainingHp} HP remains.`, 'COMBAT');
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
    if (tileTypeAt(x, y, boardSize) !== 'blank' || claimed.includes(tileKey) || turrets.includes(tileKey)) {
      addFeed('Turrets require an empty, unclaimed water tile.');
      return;
    }
    if (resources.luminae < 1) {
      addFeed('One Luminae growth unit is required to build a turret.', 'BUILD');
      return;
    }
    setResources((current) => ({ ...current, luminae: current.luminae - 1 }));
    setTurrets((current) => [...current, tileKey]);
    addFeed('Luminae turret built. It deals 1 damage at the end of every turn.', 'BUILD');
  };

  const fireTurrets = (enemyPool: Enemy[]) => {
    if (!turrets.length || !enemyPool.length) return enemyPool;
    const hitIds = new Set<number>();
    const nextEnemies = enemyPool.map((enemy) => {
      const nearestTurret = turrets
        .map((tileKey) => tileKey.split(':').map(Number) as [number, number])
        .sort((a, b) => Math.abs(a[0] - enemy.x) + Math.abs(a[1] - enemy.y) - (Math.abs(b[0] - enemy.x) + Math.abs(b[1] - enemy.y)))[0];
      if (!nearestTurret) return enemy;
      const distance = Math.abs(nearestTurret[0] - enemy.x) + Math.abs(nearestTurret[1] - enemy.y);
      if (distance > 8) return enemy;
      const nextHp = enemy.hp - 1;
      if (nextHp <= 0) hitIds.add(enemy.id);
      return { ...enemy, hp: nextHp };
    }).filter((enemy) => !hitIds.has(enemy.id));
    if (enemyPool.length !== nextEnemies.length) addFeed(`${hitIds.size} hostile${hitIds.size === 1 ? '' : 's'} destroyed by turret fire.`, 'TURRET');
    else addFeed('Turret volley registered. Hostiles are taking 1 damage.', 'TURRET');
    return nextEnemies;
  };

  const resolveWave = (enemyPool = enemies) => {
    const nextWave = wave + 1;
    const newEnemyCount = Math.min(2 + intensity, 7);
    const newEnemies = edgeSpawnPositions(boardSize, newEnemyCount).map(([x, y], index) => ({
      id: nextWave * 100 + index,
      x,
      y,
      kind: index % 3 === 0 ? 'razor' as const : 'drifter' as const,
      hp: 2,
    }));
    const activeEnemies = [...enemyPool, ...newEnemies];
    const movedEnemies = activeEnemies.map((enemy) => {
      const path = findPathToTerritory([enemy.x, enemy.y], claimed, boardSize);
      const next = path[0] ?? [enemy.x, enemy.y];
      return { ...enemy, x: next[0], y: next[1] };
    });
    const enemiesOnTerritory = movedEnemies.filter((enemy) => claimed.includes(keyFor(enemy.x, enemy.y)));
    const damageCount = Math.min(
      Math.max(0, Math.floor((intensity + (boardSize > 8 ? 1 : 0) - upgrades.hull) / 2)),
      Math.max(0, claimed.length - 1),
    );
    const damagedTiles = Array.from(new Set(enemiesOnTerritory.map((enemy) => keyFor(enemy.x, enemy.y)))).slice(0, damageCount);
    const nextBlockHp = { ...blockHp };
    damagedTiles.forEach((tileKey) => {
      nextBlockHp[tileKey] = (nextBlockHp[tileKey] ?? 3) - 1;
    });
    const destroyedTiles = damagedTiles.filter((tileKey) => nextBlockHp[tileKey] <= 0);
    const remainingTerritory = claimed.filter((tileKey) => !destroyedTiles.includes(tileKey));
    const oxygenLoss = Math.max(1, 2 + intensity + (boardSize > 8 ? 1 : 0) - upgrades.hull);
    const nextOxygen = Math.max(0, resources.oxygen - oxygenLoss);
    const nextIntensity = Math.min(5, intensity + 1);
    setEnemies(movedEnemies);
    setBlockHp(nextBlockHp);
    setClaimed(remainingTerritory);
    setResources((current) => ({ ...current, oxygen: nextOxygen }));
    setWave(nextWave);
    setIntensity(nextIntensity);
    setPhase('wave');
    addFeed(
      `Wave ${String(nextWave).padStart(2, '0')} resolved. ${newEnemies.length} entities entered; ${damagedTiles.length} block${damagedTiles.length === 1 ? '' : 's'} damaged, ${destroyedTiles.length} destroyed; oxygen -${oxygenLoss}.`,
      'WAVE',
    );

    if (nextWave >= 2 && !miraUnlocked) {
      setMiraUnlocked(true);
      addFeed('Mira: “The signal is not hunting us. It is asking us to listen.”', 'MIRA');
    }
    const coreSurvives = remainingTerritory.includes(coreKey);
    if (nextOxygen <= 0 || remainingTerritory.length < 3 || !coreSurvives) {
      setGameState('gameover');
      addFeed(coreSurvives ? 'Core survival threshold breached. Settlement life support has gone quiet.' : 'The core block was breached. Settlement life support has gone quiet.', 'FAIL');
    } else if (nextWave >= 6) {
      setGameState('victory');
      addFeed('The outpost is stable enough for a deep-dive. The Mourner is waiting below.', 'CLEAR');
    }
    window.setTimeout(() => setPhase('play'), 900);
  };

  const endTurn = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    const nextTurn = turn + 1;
    setTurn(nextTurn);
    setMovement(movementMax);
    setClaimBudget(claimMax);
    setAttackBudget(1);
    setEdgeWarning(false);
    addFeed(`Turn ${String(nextTurn).padStart(2, '0')} ready. Movement and claim reserves restored.`);
    const enemyPoolAfterTurrets = fireTurrets(enemies);
    setEnemies(enemyPoolAfterTurrets);
    if (nextTurn % 5 === 0) {
      resolveWave(enemyPoolAfterTurrets);
    }
  };

  const spendResources = (
    label: string,
    cost: Partial<Resources>,
    apply: () => void,
  ) => {
    const canAfford = Object.entries(cost).every(([key, amount]) => resources[key as ResourceKey] >= amount);
    if (!canAfford) {
      addFeed(`Insufficient reserves for ${label.toLowerCase()}. Gather more territory first.`, 'SHOP');
      return;
    }
    setResources((current) => ({
      ...current,
      ...Object.fromEntries(
        (Object.keys(cost) as ResourceKey[]).map((key) => [key, current[key] - (cost[key] ?? 0)]),
      ),
    }));
    apply();
    addFeed(`${label} online. The settlement is better prepared for the next wave.`, 'UPGRADE');
  };

  const repairCore = () => {
    if (gameState !== 'playing' || phase !== 'play') return;
    spendResources('Core repair', { scavenge: 4 }, () => {
      setResources((current) => ({ ...current, oxygen: Math.min(100, current.oxygen + 10) }));
    });
  };

  const upgradeMovement = () => {
    const cost = { scavenge: 8 + upgrades.movement * 4, signal: 1 };
    spendResources(`Movement upgrade // ${movementMax + 1}`, cost, () => {
      setUpgrades((current) => ({ ...current, movement: current.movement + 1 }));
    });
  };

  const upgradeClaim = () => {
    const cost = { scavenge: 7 + upgrades.claim * 4, signal: 1 };
    spendResources(`Claim upgrade // ${claimMax + 1}`, cost, () => {
      setUpgrades((current) => ({ ...current, claim: current.claim + 1 }));
    });
  };

  const upgradeHull = () => {
    const cost = { scavenge: 10 + upgrades.hull * 5, luminae: 1 };
    spendResources(`Hull upgrade // ${upgrades.hull + 1}`, cost, () => {
      setUpgrades((current) => ({ ...current, hull: current.hull + 1 }));
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameState !== 'playing' || phase !== 'play') return;
      const [x, y] = player;
      const direction: Record<string, [number, number]> = {
        ArrowUp: [x, y - 1],
        ArrowDown: [x, y + 1],
        ArrowLeft: [x - 1, y],
        ArrowRight: [x + 1, y],
      };
      const next = direction[event.key];
      if (next && next[0] >= 0 && next[1] >= 0 && next[0] < boardSize && next[1] < boardSize) {
        event.preventDefault();
        if (mode === 'move') handleMove(next[0], next[1]);
        else if (mode === 'claim') handleClaim(next[0], next[1]);
        else if (mode === 'attack') handleAttack(next[0], next[1]);
        else handleBuildTurret(next[0], next[1]);
      }
      if (event.key.toLowerCase() === 'm') setMode('move');
      if (event.key.toLowerCase() === 'c') setMode('claim');
      if (event.key.toLowerCase() === 'a') setMode('attack');
      if (event.key.toLowerCase() === 'b') setMode('build');
      if (event.key === 'Enter') endTurn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const togglePause = () => {
    if (gameState === 'playing') setGameState('paused');
    else if (gameState === 'paused') setGameState('playing');
  };

  const handleTileClick = (x: number, y: number) => {
    if (mode === 'move') handleMove(x, y);
    if (mode === 'claim') handleClaim(x, y);
    if (mode === 'attack') handleAttack(x, y);
    if (mode === 'build') handleBuildTurret(x, y);
  };

  return (
    <main className="console-shell">
      <header className="console-header">
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden="true" />
          <span>LUMINAE</span>
        </div>
        <div className="header-status">
          <span className="status-dot" />
          <span className="mono">OUTPOST // PELAGOS-03</span>
          <span>LOCAL CAMPAIGN</span>
        </div>
        <button
          className="console-button"
          onClick={togglePause}
          data-testid="button-pause"
          disabled={gameState === 'gameover' || gameState === 'victory'}
        >
          {gameState === 'paused' ? <Play size={14} /> : <Pause size={14} />}
          {gameState === 'paused' ? 'Resume' : 'Pause'}
        </button>
      </header>

      <div className="console-main">
        <section className="campaign-bar" aria-label="Campaign heading">
          <div>
            <div className="eyebrow">Campaign / A01 / live chart</div>
            <h1 className="campaign-title">The Shallows <span>/ Sector 01</span></h1>
          </div>
          <div className="action-row">
            <button className="console-button danger" onClick={resetGame} data-testid="button-restart">
              <RotateCcw size={14} /> Restart campaign
            </button>
          </div>
        </section>

        <section className="hud-strip" aria-label="Campaign status">
          <div className="hud-stat">
            <span className="eyebrow">Wave</span>
            <strong className="hud-stat-value" data-testid="status-wave">{String(wave).padStart(2, '0')} / 06</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Turn</span>
            <strong className="hud-stat-value" data-testid="status-turn">{String(turn).padStart(2, '0')}</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Movement</span>
            <strong className="hud-stat-value good" data-testid="status-movement">{movement} / 03</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Claim reserve</span>
            <strong className="hud-stat-value warn" data-testid="status-claim">{claimBudget} / {String(claimMax).padStart(2, '0')}</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Attack reserve</span>
            <strong className="hud-stat-value danger" data-testid="status-attack">{attackBudget} / 01</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Territory</span>
            <strong className="hud-stat-value" data-testid="status-territory">{claimed.length} blocks</strong>
          </div>
          <div className="hud-stat">
            <span className="eyebrow">Chart</span>
            <strong className="hud-stat-value" data-testid="status-board">{boardSize} × {boardSize}</strong>
          </div>
        </section>

        <div className="game-layout">
          <section className={`board-frame ${phase === 'wave' ? 'wave-pulse' : ''}`} aria-label="Playable settlement chart">
            <div className="board-topline">
              <div>
                <div className="board-title"><ScanLine size={14} /> Settlement territory</div>
                <div className="board-coordinates">GRID {boardSize}×{boardSize} · KAEL {player[0].toString().padStart(2, '0')}:{player[1].toString().padStart(2, '0')}</div>
              </div>
              <span className={`eyebrow ${phase === 'wave' ? 'text-destructive' : ''}`}>
                {phase === 'wave' ? 'WAVE RESOLVING' : mode === 'move' ? 'MOVE MODE' : mode === 'claim' ? 'CLAIM MODE' : mode === 'attack' ? 'ATTACK MODE' : 'BUILD MODE'}
              </span>
            </div>

            {edgeWarning && (
              <div className="edge-banner" data-testid="status-edge-warning">
                <AlertTriangle size={16} />
                <span>Outer ring unstable. One more edge step will expand the chart by 4 × 4.</span>
              </div>
            )}

            <div className="grid-wrap">
              <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}>
                {tiles.map((tile) => {
                  const tileKey = keyFor(tile.x, tile.y);
                  const isPlayer = tileKey === playerKey;
                  const isClaimed = claimed.includes(tileKey);
                  const isAdjacent = Math.abs(player[0] - tile.x) + Math.abs(player[1] - tile.y) === 1;
                  const isCore = tileKey === coreKey;
                      const isWarning = boardSize < 16 && outerBuffer(tile.x, tile.y);
                      const tileEnemies = enemies.filter((enemy) => enemy.x === tile.x && enemy.y === tile.y);
                      const isTurret = turrets.includes(tileKey);
                  return (
                    <button
                      key={tileKey}
                       className={`tile tile-type-${tile.type} ${isClaimed ? 'claimed' : ''} ${isPlayer ? 'player' : ''} ${isCore ? 'core' : ''} ${isAdjacent && !isClaimed ? 'claimable' : ''} ${isWarning && edgeWarning ? 'edge-warning' : ''} ${tileEnemies.length ? 'enemy-tile' : ''} ${isTurret ? 'turret-tile' : ''}`}
                       onClick={() => handleTileClick(tile.x, tile.y)}
                      data-testid={`tile-${tile.x}-${tile.y}`}
                       aria-label={`${tileNames[tile.type]} at ${tile.x}, ${tile.y}${isClaimed ? `, claimed, ${blockHp[tileKey] ?? 3} HP` : ''}${isTurret ? ', turret' : ''}${tileEnemies.length ? `, enemy contact, ${tileEnemies[0].hp} HP` : ''}`}
                    >
                       <span className="tile-glyph">{isPlayer ? 'K' : tileEnemies.length ? tileEnemies[0].kind === 'razor' ? 'R' : 'E' : isTurret ? 'T' : tileGlyphs[tile.type]}</span>
                       {tileEnemies.length > 0 && <span className="enemy-count">{tileEnemies.length > 1 ? tileEnemies.length : ''}</span>}
                       {isClaimed && <span className="tile-health">{blockHp[tileKey] ?? 3}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="board-bottomline">
              <span><Crosshair size={13} /> {mode === 'move' ? 'Click an adjacent tile to move' : mode === 'claim' ? `Click an adjacent tile to claim · ${claimBudget} left` : mode === 'attack' ? `Click an adjacent enemy to attack · ${attackBudget} left` : 'Click adjacent empty water to build a turret'} · Arrow keys supported</span>
              <span className="mono">{boardIsExpanded ? 'EXPANSION 01' : 'INITIAL CHART'}</span>
            </div>

            <div className="turn-controls">
              <div className="mode-toggle" aria-label="Action mode">
                <button className={mode === 'move' ? 'active' : ''} onClick={() => setMode('move')} data-testid="button-mode-move">
                  Move <span className="mono">M</span>
                </button>
                <button className={mode === 'claim' ? 'active' : ''} onClick={() => setMode('claim')} data-testid="button-mode-claim">
                  Claim <span className="mono">C</span>
                </button>
                <button className={mode === 'attack' ? 'active attack-mode' : ''} onClick={() => setMode('attack')} data-testid="button-mode-attack">
                  Attack <span className="mono">A</span>
                </button>
                <button className={mode === 'build' ? 'active build-mode' : ''} onClick={() => setMode('build')} data-testid="button-mode-build">
                  Build <span className="mono">B</span>
                </button>
              </div>
              <button
                className="console-button primary"
                onClick={endTurn}
                disabled={gameState !== 'playing' || phase !== 'play'}
                data-testid="button-end-turn"
              >
                End turn <ArrowRight size={14} />
              </button>
            </div>
          </section>

          <aside className="sidebar-stack">
            <section className="panel" aria-label="Settlement resources">
              <div className="panel-heading">
                <h2>Life support</h2>
                <ShieldCheck size={15} color="hsl(var(--primary))" />
              </div>
              <div className="resource-list">
                {([
                  ['oxygen', 'Oxygen', Wind, 100],
                  ['scavenge', 'Scavenged resources', Package, 30],
                  ['luminae', 'Luminae', Sparkles, 10],
                  ['signal', 'Signal / intel', Radio, 20],
                ] as const).map(([key, name, Icon, max]) => (
                  <div className="resource-row" key={key} data-testid={`resource-${key}`}>
                    <span className={`resource-mark tile-type-${key}`}><Icon size={11} /></span>
                    <span className="resource-name">{name}</span>
                    <strong className="resource-value">{resources[key]}</strong>
                    <div className="resource-bar"><span style={{ width: `${Math.min(100, resources[key] / max * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel upgrade-panel" aria-label="Workshop upgrades">
              <div className="panel-heading">
                <h2>Workshop</h2>
                <span className="eyebrow">SPEND RESERVES</span>
              </div>
              <div className="upgrade-list">
                <button className="upgrade-row" onClick={repairCore} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < 4}>
                  <span><strong>Repair core</strong><small>+10 oxygen · 4 R</small></span>
                  <ArrowRight size={13} />
                </button>
                <button className="upgrade-row" onClick={upgradeMovement} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < 8 + upgrades.movement * 4 || resources.signal < 1}>
                  <span><strong>Movement range <em>LV {upgrades.movement}</em></strong><small>{8 + upgrades.movement * 4} R · 1 S</small></span>
                  <ArrowRight size={13} />
                </button>
                <button className="upgrade-row" onClick={upgradeClaim} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < 7 + upgrades.claim * 4 || resources.signal < 1}>
                  <span><strong>Claim capacity <em>LV {upgrades.claim}</em></strong><small>{7 + upgrades.claim * 4} R · 1 S</small></span>
                  <ArrowRight size={13} />
                </button>
                <button className="upgrade-row" onClick={upgradeHull} disabled={gameState !== 'playing' || phase !== 'play' || resources.scavenge < 10 + upgrades.hull * 5 || resources.luminae < 1}>
                  <span><strong>Hull shielding <em>LV {upgrades.hull}</em></strong><small>{10 + upgrades.hull * 5} R · 1 L</small></span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </section>

            <section className="panel" aria-label="Crew status">
              <div className="panel-heading">
                <h2>Crew channel</h2>
                <span className="eyebrow">ACTIVE</span>
              </div>
              <div className="character-card">
                <div className="character-sigil">K/01</div>
                <div>
                  <h3 className="character-name">Kael</h3>
                  <p className="character-role">Maintenance / settlement core</p>
                  <div className="character-stats">
                    <span className="stat-chip">MOV 03</span>
                    <span className="stat-chip">CLM 02</span>
                    <span className="stat-chip">RAD 01</span>
                  </div>
                </div>
              </div>
              {miraUnlocked && (
                <div className="mira-card" data-testid="status-mira">
                  <strong>Mira // signal analyst</strong>
                  <p>New channel unlocked. She can hear a pattern inside the pain signal.</p>
                </div>
              )}
            </section>

            <section className="panel" aria-label="Wave forecast and legend">
              <div className="panel-heading">
                <h2>Wave forecast</h2>
                <Waves size={15} color="hsl(var(--accent))" />
              </div>
              <div className="forecast">
                <div className="eyebrow">Next resolution in {nextWaveIn} turn{nextWaveIn === 1 ? '' : 's'}</div>
                <div className="forecast-track">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span className={`forecast-segment ${index < 5 - nextWaveIn ? 'active' : ''}`} key={index} />
                  ))}
                </div>
                <div className="forecast-labels"><span>LOW</span><span>INTENSITY {intensity}</span><span>HIGH</span></div>
              </div>
              <div className="legend-list">
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(194 75% 68%)' }}>O₂</span> Oxygen reserve</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(39 88% 65%)' }}>R</span> Repair material</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(168 82% 70%)' }}>L</span> Luminae growth</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(278 70% 78%)' }}>S</span> Signal / intel</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(2 84% 72%)' }}>E</span> Enemy · 2 HP base</div>
                <div className="legend-item"><span className="legend-glyph" style={{ color: 'hsl(168 82% 70%)' }}>T</span> Luminae turret · 1 damage / turn</div>
              </div>
            </section>

            <section className="panel survival-guide" aria-label="How to survive">
              <div className="panel-heading">
                <h2>Survival protocol</h2>
                <ShieldCheck size={15} color="hsl(var(--primary))" />
              </div>
              <ol>
                <li><span>01</span><p>Claim oxygen and repair tiles before the next wave.</p></li>
                <li><span>02</span><p>Keep the core connected; enemies path toward claimed blocks.</p></li>
                <li><span>03</span><p>Attack nearby enemies before they reach territory. Two hits destroy a base contact.</p></li>
                <li><span>04</span><p>Spend Luminae on empty water to build a turret; it takes two turns to destroy base HP.</p></li>
              </ol>
            </section>

            <section className="panel" aria-label="Discovery feed">
              <div className="panel-heading">
                <h2>Discovery feed</h2>
                <Info size={15} color="hsl(var(--muted-foreground))" />
              </div>
              <div className="feed">
                {feed.map((item) => (
                  <div className="feed-item" key={item.id} data-testid={`feed-${item.id}`}>
                    <span className="feed-time">{item.label}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <div className="message-feed" role="status" data-testid="status-message">
          <strong>{phase === 'wave' ? 'WAVE' : mode === 'claim' ? 'CLAIM' : mode === 'attack' ? 'COMBAT' : mode === 'build' ? 'BUILD' : 'KAEL'}</strong>
          {phase === 'wave' ? 'The water shifts around the claimed blocks. Hold position while the pressure passes.' : mode === 'claim' ? `Select a lit adjacent tile to spend one claim reserve. ${claimBudget} remaining.` : mode === 'attack' ? `Kael deals 1 damage per attack. Base enemies have 2 HP. ${attackBudget} attack remaining.` : mode === 'build' ? 'Spend 1 Luminae to place a turret on adjacent neutral water. Turrets fire at the end of each turn.' : 'Move toward the outer ring to reveal new water, or switch to Claim and make this territory yours.'}
        </div>
      </div>

      {(gameState === 'paused' || gameState === 'gameover' || gameState === 'victory') && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="overlay-card">
            <div className="eyebrow">{gameState === 'paused' ? 'SYSTEM PAUSED' : gameState === 'victory' ? 'SIGNAL STABILIZED' : 'LIFE SUPPORT OFFLINE'}</div>
            <h2>
              {gameState === 'paused' && 'Hold the line.'}
              {gameState === 'victory' && 'The sea is listening.'}
              {gameState === 'gameover' && 'The outpost went dark.'}
            </h2>
            <p>
              {gameState === 'paused' && 'The chart is safe. Take a breath, then return to the water when you are ready.'}
              {gameState === 'victory' && 'Six waves survived. The path to the Mourner is open; this settlement can now prepare a healing descent.'}
              {gameState === 'gameover' && 'Claimed territory fell below the survival threshold. Restart the campaign and protect oxygen before the next wave.'}
            </p>
            <div className="action-row">
              {gameState === 'paused' && (
                <button className="console-button primary" onClick={togglePause} data-testid="button-resume">
                  <Play size={14} /> Resume chart
                </button>
              )}
              {(gameState === 'gameover' || gameState === 'victory') && (
                <button className="console-button primary" onClick={resetGame} data-testid="button-restart-overlay">
                  <RotateCcw size={14} /> Restart campaign
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;