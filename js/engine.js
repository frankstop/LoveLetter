import { buildDeck, cardDef, CARD_DEFINITIONS } from "./cards.js";

export const SAVE_VERSION = 1;
export const TOKEN_TARGETS = { 2: 7, 3: 5, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 };

const TARGETING_CARDS = new Set([
  "crown", "blade", "duelist", "confessor", "watchdog", "saint",
  "matriarch", "fixer", "seer", "dealer", "fool",
]);

export function shuffled(cards, rng = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createGame(config, rng = Math.random) {
  const players = config.players.map((player, index) => ({
    id: `p${index + 1}`,
    name: player.name?.trim() || `Player ${index + 1}`,
    type: player.type === "human" ? "human" : "ai",
    tokens: 0,
    hand: [],
    discard: [],
    alive: true,
    protected: false,
    knowledge: {},
  }));
  const state = {
    version: SAVE_VERSION,
    phase: "playing",
    mode: players.length >= 5 ? "premium" : "core",
    players,
    deck: [],
    burned: null,
    removedFaceUp: [],
    activePlayer: 0,
    startingPlayer: 0,
    round: 0,
    pending: null,
    forcedTargetId: null,
    jesterBets: [],
    log: [],
    lastRound: null,
    winnerIds: [],
    tieBreakerIds: null,
    passRequired: false,
    settings: {
      sound: config.settings?.sound !== false,
      motion: config.settings?.motion !== false,
    },
  };
  startRound(state, rng);
  return state;
}

export function startRound(state, rng = Math.random) {
  state.round += 1;
  state.mode = state.players.length >= 5 ? "premium" : "core";
  state.deck = shuffled(buildDeck(state.mode === "premium"), rng);
  state.burned = state.deck.pop();
  state.removedFaceUp = state.players.length === 2 ? state.deck.splice(-3) : [];
  const participants = state.tieBreakerIds?.length
    ? new Set(state.tieBreakerIds)
    : new Set(state.players.map((player) => player.id));
  state.pending = null;
  state.forcedTargetId = null;
  state.jesterBets = [];
  state.lastRound = null;
  state.players.forEach((player) => {
    player.hand = participants.has(player.id) ? [state.deck.pop()] : [];
    player.discard = [];
    player.alive = participants.has(player.id);
    player.protected = false;
    player.knowledge = {};
  });
  state.activePlayer = nextEligibleIndex(state, state.startingPlayer - 1);
  addLog(state, state.tieBreakerIds?.length
    ? `Tiebreak round ${state.round} begins between ${state.tieBreakerIds.map((id) => getPlayer(state, id).name).join(" and ")}.`
    : `Round ${state.round} begins. One card was burned face down.`);
  if (state.removedFaceUp.length) addLog(state, "Three cards were removed face up for the two-player round.");
  beginTurn(state);
  return state;
}

export function beginTurn(state) {
  if (state.phase !== "playing") return state;
  const player = activePlayer(state);
  player.protected = false;
  if (state.deck.length === 0) return endRound(state);
  player.hand.push(state.deck.pop());
  state.passRequired = player.type === "human" &&
    state.players.filter((p) => p.type === "human" && p.alive).length > 1;
  addLog(state, `${player.name} draws a card.`);
  return state;
}

export function activePlayer(state) {
  return state.players[state.activePlayer];
}

export function legalCardIds(state, playerId = activePlayer(state).id) {
  const player = getPlayer(state, playerId);
  if (!player || !player.alive || player.hand.length < 2) return [];
  const hasWidow = player.hand.some((card) => card.defId === "widow");
  const forced = player.hand.some((card) => card.defId === "crown" || card.defId === "blade");
  if (hasWidow && forced) return player.hand.filter((card) => card.defId === "widow").map((card) => card.uid);
  return player.hand.map((card) => card.uid);
}

export function playCard(state, cardUid) {
  const actor = activePlayer(state);
  if (state.phase !== "playing" || state.pending || state.passRequired) return fail("It is not time to play a card.");
  if (!legalCardIds(state).includes(cardUid)) return fail("That card cannot be played now.");
  const index = actor.hand.findIndex((card) => card.uid === cardUid);
  const [card] = actor.hand.splice(index, 1);
  actor.discard.push(card);
  const def = cardDef(card);
  addLog(state, `${actor.name} plays ${def.name}.`);
  resolvePlayedCard(state, actor.id, card);
  return { ok: true, state };
}

function resolvePlayedCard(state, actorId, card) {
  const id = card.defId;
  if (state.forcedTargetId && !TARGETING_CARDS.has(id)) state.forcedTargetId = null;
  switch (id) {
    case "heart":
      eliminate(state, actorId, `${getPlayer(state, actorId).name} discarded The Heart.`);
      return completeTurn(state);
    case "widow":
    case "badge":
    case "lucky-hand":
    case "killer":
      return completeTurn(state);
    case "shield":
      getPlayer(state, actorId).protected = true;
      addLog(state, `${getPlayer(state, actorId).name} is protected until their next turn.`);
      return completeTurn(state);
    case "crown":
      return promptSingleTarget(state, actorId, id, { allowSelf: false });
    case "blade":
      return promptSingleTarget(state, actorId, id, { allowSelf: true });
    case "duelist":
    case "confessor":
    case "watchdog":
    case "saint":
    case "matriarch":
    case "fixer":
    case "fool":
      return promptSingleTarget(state, actorId, id, { allowSelf: id === "fixer" });
    case "seer":
      return promptMultipleTargets(state, actorId, id, 1, 2, false);
    case "dealer":
      return promptMultipleTargets(state, actorId, id, 2, 2, true);
    default:
      return completeTurn(state);
  }
}

function promptSingleTarget(state, actorId, cardId, options) {
  const targets = legalTargets(state, actorId, { ...options, cardId, enforceForced: true });
  if (!targets.length) {
    addLog(state, `${CARD_DEFINITIONS[cardId].name} has no legal target.`);
    consumeForcedTarget(state, cardId);
    return completeTurn(state);
  }
  state.pending = {
    type: "choosePlayer", actorId, cardId, eligibleIds: targets.map((p) => p.id),
  };
}

function promptMultipleTargets(state, actorId, cardId, min, max, allowSelf) {
  const targets = legalTargets(state, actorId, { allowSelf, cardId, enforceForced: false });
  if (targets.length < min) {
    addLog(state, `${CARD_DEFINITIONS[cardId].name} has too few legal targets.`);
    consumeForcedTarget(state, cardId);
    return completeTurn(state);
  }
  state.pending = {
    type: "choosePlayers", actorId, cardId, eligibleIds: targets.map((p) => p.id), min, max,
    requiredId: state.forcedTargetId && targets.some((p) => p.id === state.forcedTargetId)
      ? state.forcedTargetId : null,
  };
}

export function legalTargets(state, actorId, { allowSelf = false, cardId, enforceForced = true } = {}) {
  let targets = state.players.filter((player) => {
    if (!player.alive) return false;
    if (player.id === actorId) return allowSelf;
    return !player.protected;
  });
  if (enforceForced && state.forcedTargetId && TARGETING_CARDS.has(cardId)) {
    targets = targets.filter((player) => player.id === state.forcedTargetId);
  }
  return targets;
}

export function resolvePending(state, payload) {
  const pending = state.pending;
  if (!pending || state.phase !== "playing") return fail("There is no action to resolve.");
  if (pending.type === "choosePlayer") {
    if (!pending.eligibleIds.includes(payload.playerId)) return fail("Choose an eligible player.");
    return resolveSingleTarget(state, pending, payload.playerId);
  }
  if (pending.type === "choosePlayers") {
    const ids = [...new Set(payload.playerIds || [])];
    if (ids.length < pending.min || ids.length > pending.max ||
      ids.some((id) => !pending.eligibleIds.includes(id)) ||
      (pending.requiredId && !ids.includes(pending.requiredId))) return fail("Choose the required players.");
    return resolveMultipleTargets(state, pending, ids);
  }
  if (pending.type === "guessValue") {
    const valid = pending.cardId === "watchdog"
      ? Number.isInteger(payload.value) && payload.value !== 1 && payload.value >= 0 && payload.value <= 9
      : Number.isInteger(payload.value) && payload.value >= 0 && payload.value <= 9;
    if (!valid) return fail("Choose a legal value.");
    return resolveGuess(state, pending, payload.value);
  }
  if (pending.type === "discardRedraw") return resolveOptionalRedraw(state, pending, Boolean(payload.redraw));
  if (pending.type === "inspectHand") {
    state.pending = null;
    return finishAction(state);
  }
  return fail("Unknown action.");
}

function resolveSingleTarget(state, pending, targetId) {
  state.pending = null;
  consumeForcedTarget(state, pending.cardId);
  const actor = getPlayer(state, pending.actorId);
  const target = getPlayer(state, targetId);
  switch (pending.cardId) {
    case "crown":
      [actor.hand, target.hand] = [target.hand, actor.hand];
      actor.knowledge[target.id] = target.hand[0]?.defId;
      target.knowledge[actor.id] = actor.hand[0]?.defId;
      addLog(state, `${actor.name} and ${target.name} trade hands.`);
      return finishAction(state);
    case "blade":
      forceRedraw(state, targetId, { useBurned: true });
      return finishAction(state);
    case "duelist":
      compareAndEliminate(state, actor.id, target.id, "lower");
      return finishAction(state);
    case "matriarch":
      compareAndEliminate(state, actor.id, target.id, "higher");
      return finishAction(state);
    case "confessor":
      rememberHand(actor, target);
      addLog(state, `${actor.name} privately inspects ${target.name}'s hand.`);
      if (actor.type === "human") {
        state.pending = { type: "inspectHand", actorId: actor.id, playerIds: [target.id] };
        return { ok: true, state };
      }
      return finishAction(state);
    case "watchdog":
    case "saint":
      state.pending = { type: "guessValue", actorId: actor.id, cardId: pending.cardId, targetId };
      return { ok: true, state };
    case "fixer":
      state.forcedTargetId = target.id;
      addLog(state, `${target.name} must be included in the next targeting effect.`);
      return finishAction(state);
    case "fool":
      state.jesterBets.push({ ownerId: actor.id, targetId: target.id });
      addLog(state, `${actor.name} bets that ${target.name} will win the round.`);
      return finishAction(state);
    case "dealer-inspect":
      rememberHand(actor, target);
      addLog(state, `${actor.name} privately inspects ${target.name}'s new hand.`);
      if (actor.type === "human") {
        state.pending = { type: "inspectHand", actorId: actor.id, playerIds: [target.id] };
        return { ok: true, state };
      }
      return finishAction(state);
    default:
      return finishAction(state);
  }
}

function resolveMultipleTargets(state, pending, ids) {
  state.pending = null;
  consumeForcedTarget(state, pending.cardId);
  const actor = getPlayer(state, pending.actorId);
  if (pending.cardId === "seer") {
    ids.forEach((id) => rememberHand(actor, getPlayer(state, id)));
    addLog(state, `${actor.name} privately inspects ${ids.map((id) => getPlayer(state, id).name).join(" and ")}.`);
    if (actor.type === "human") {
      state.pending = { type: "inspectHand", actorId: actor.id, playerIds: ids };
      return { ok: true, state };
    }
    return finishAction(state);
  }
  if (pending.cardId === "dealer") {
    const [a, b] = ids.map((id) => getPlayer(state, id));
    [a.hand, b.hand] = [b.hand, a.hand];
    addLog(state, `${a.name} and ${b.name} trade hands.`);
    if (actor.type === "human") {
      state.pending = {
        type: "choosePlayer", actorId: actor.id, cardId: "dealer-inspect", eligibleIds: ids,
      };
      return { ok: true, state };
    }
    rememberHand(actor, a);
    return finishAction(state);
  }
  return finishAction(state);
}

function resolveGuess(state, pending, value) {
  state.pending = null;
  const actor = getPlayer(state, pending.actorId);
  const target = getPlayer(state, pending.targetId);
  const held = target.hand[0];
  const heldValue = held ? cardDef(held).value : null;

  if (pending.cardId === "watchdog" && held?.defId === "killer") {
    addLog(state, `${target.name} reveals The Killer. ${actor.name}'s Watchdog backfires.`);
    eliminate(state, actor.id, "The Killer turned the Watchdog around.");
    forceRedraw(state, target.id, { useBurned: true });
    return finishAction(state);
  }

  if (heldValue === value) {
    if (pending.cardId === "watchdog") {
      addLog(state, `${actor.name} correctly guessed ${value}.`);
      eliminate(state, target.id, `${target.name} was exposed by The Watchdog.`);
      return finishAction(state);
    }
    awardToken(state, actor.id, "The Saint's correct guess");
    addLog(state, `${actor.name} correctly guessed ${value} and gains a Heart.`);
    if (state.phase === "gameOver") return { ok: true, state };
    if (target.alive) {
      if (target.type === "ai") {
        const redraw = cardDef(target.hand[0]).value <= 4;
        if (redraw) forceRedraw(state, target.id);
        return finishAction(state);
      }
      state.pending = { type: "discardRedraw", actorId: target.id, sourceActorId: actor.id };
      return { ok: true, state };
    }
  } else {
    addLog(state, `${actor.name}'s guess of ${value} was wrong.`);
  }
  return finishAction(state);
}

function resolveOptionalRedraw(state, pending, redraw) {
  state.pending = null;
  if (redraw) forceRedraw(state, pending.actorId);
  else addLog(state, `${getPlayer(state, pending.actorId).name} keeps their hand.`);
  return finishAction(state);
}

function forceRedraw(state, playerId, { useBurned = false } = {}) {
  const player = getPlayer(state, playerId);
  const old = player.hand.pop();
  if (!old) return;
  player.discard.push(old);
  addLog(state, `${player.name} discards ${cardDef(old).name} and redraws.`);
  if (old.defId === "heart") {
    eliminate(state, player.id, `${player.name} was forced to discard The Heart.`);
    return;
  }
  let replacement = state.deck.pop();
  if (!replacement && useBurned) {
    replacement = state.burned;
    state.burned = null;
  }
  if (replacement) player.hand.push(replacement);
}

function compareAndEliminate(state, aId, bId, mode) {
  const a = getPlayer(state, aId);
  const b = getPlayer(state, bId);
  const av = a.hand[0] ? cardDef(a.hand[0]).value : -1;
  const bv = b.hand[0] ? cardDef(b.hand[0]).value : -1;
  if (av === bv) {
    addLog(state, `${a.name} and ${b.name} tie. Nobody is knocked out.`);
    return;
  }
  const loser = mode === "lower" ? (av < bv ? a : b) : (av > bv ? a : b);
  eliminate(state, loser.id, `${loser.name} lost the comparison.`);
}

export function eliminate(state, playerId, reason) {
  const player = getPlayer(state, playerId);
  if (!player?.alive) return;
  player.alive = false;
  player.protected = false;
  if (player.hand.length) player.discard.push(...player.hand.splice(0));
  addLog(state, reason || `${player.name} is knocked out.`);
  if (player.discard.some((card) => card.defId === "badge")) {
    awardToken(state, player.id, "The Badge", { deferGameOver: true });
    addLog(state, `${player.name}'s Badge earns them a Heart.`);
  }
}

export function finishAction(state) {
  if (state.pending || state.phase !== "playing") return { ok: true, state };
  return completeTurn(state);
}

function completeTurn(state) {
  if (state.phase !== "playing" || state.pending) return { ok: true, state };
  const living = state.players.filter((player) => player.alive);
  if (living.length <= 1 || state.deck.length === 0) {
    endRound(state);
    return { ok: true, state };
  }
  state.activePlayer = nextEligibleIndex(state, state.activePlayer);
  beginTurn(state);
  return { ok: true, state };
}

export function endRound(state) {
  if (state.phase !== "playing") return state;
  const living = state.players.filter((player) => player.alive);
  let winners;
  let reason;
  if (living.length === 1) {
    winners = living;
    reason = `${living[0].name} is the last player standing.`;
  } else {
    const scored = living.map((player) => ({
      player,
      handValue: showdownValue(player),
      discardTotal: player.discard.reduce((sum, card) => sum + cardDef(card).value, 0),
    }));
    const bestHand = Math.max(...scored.map((item) => item.handValue));
    let tied = scored.filter((item) => item.handValue === bestHand);
    const bestDiscard = Math.max(...tied.map((item) => item.discardTotal));
    tied = tied.filter((item) => item.discardTotal === bestDiscard);
    winners = tied.map((item) => item.player);
    reason = tied.length > 1
      ? `${tied.map((item) => item.player.name).join(" and ")} remain tied after discard totals.`
      : `${tied[0].player.name} wins the showdown at ${formatScore(tied[0].handValue)}; discard total ${tied[0].discardTotal}.`;
  }
  winners.forEach((winner) => awardToken(state, winner.id, "round win", { deferGameOver: true }));
  state.jesterBets.forEach((bet) => {
    if (winners.some((winner) => winner.id === bet.targetId)) {
      awardToken(state, bet.ownerId, "The Fool's bet", { deferGameOver: true });
      addLog(state, `${getPlayer(state, bet.ownerId).name}'s Fool bet pays off.`);
    }
  });
  state.lastRound = {
    winnerIds: winners.map((player) => player.id),
    reason,
    hands: state.players.map((player) => ({
      playerId: player.id,
      cards: player.hand.map((card) => card.defId),
      alive: player.alive,
      discardTotal: player.discard.reduce((sum, card) => sum + cardDef(card).value, 0),
      score: player.alive ? showdownValue(player) : null,
    })),
  };
  addLog(state, reason);
  const reached = tokenLeaders(state);
  if (reached.length === 1) {
    state.phase = "gameOver";
    state.winnerIds = reached.map((player) => player.id);
    state.tieBreakerIds = null;
  } else if (reached.length > 1) {
    state.phase = "roundOver";
    state.tieBreakerIds = reached.map((player) => player.id);
    state.startingPlayer = state.players.findIndex((player) => player.id === winners[0].id);
    addLog(state, `${reached.map((player) => player.name).join(" and ")} are tied for the game. They will play a tiebreak round.`);
  } else {
    state.phase = "roundOver";
    state.tieBreakerIds = null;
    state.startingPlayer = state.players.findIndex((player) => player.id === winners[0].id);
  }
  return state;
}

export function nextRound(state, rng = Math.random) {
  if (state.phase !== "roundOver") return fail("The round is not over.");
  state.phase = "playing";
  startRound(state, rng);
  return { ok: true, state };
}

export function awardToken(state, playerId, source, { deferGameOver = false } = {}) {
  const player = getPlayer(state, playerId);
  if (!player) return;
  player.tokens += 1;
  const leaders = tokenLeaders(state);
  if (!deferGameOver && leaders.length === 1 && leaders[0].id === player.id) {
    state.phase = "gameOver";
    state.winnerIds = [player.id];
    state.tieBreakerIds = null;
    addLog(state, `${player.name} reaches the Heart target through ${source} and wins the game.`);
  }
}

function tokenLeaders(state) {
  const target = TOKEN_TARGETS[state.players.length];
  const reached = state.players.filter((player) => player.tokens >= target);
  if (!reached.length) return [];
  const highest = Math.max(...reached.map((player) => player.tokens));
  return reached.filter((player) => player.tokens === highest);
}

export function showdownValue(player) {
  const hand = player.hand[0];
  if (!hand) return -1;
  const lucky = player.discard.filter((card) => card.defId === "lucky-hand").length;
  // The Heart beats an unmodified Saint at showdown, while discarded Lucky Hands still matter.
  const base = hand.defId === "saint" ? 7.5 : cardDef(hand).value;
  return base + lucky;
}

export function publicState(state, viewerId = null) {
  return {
    ...state,
    burned: state.burned ? { hidden: true } : null,
    players: state.players.map((player) => ({
      ...player,
      hand: player.id === viewerId ? player.hand : player.hand.map(() => ({ hidden: true })),
      knowledge: undefined,
    })),
  };
}

export function validateState(value) {
  return Boolean(
    value && value.version === SAVE_VERSION &&
    ["playing", "roundOver", "gameOver"].includes(value.phase) &&
    Array.isArray(value.players) && value.players.length >= 2 && value.players.length <= 8 &&
    value.players.every((p) => p && typeof p.name === "string" && Array.isArray(p.hand) && Array.isArray(p.discard)) &&
    Array.isArray(value.deck) && Array.isArray(value.log)
  );
}

export function getPlayer(state, id) {
  return state.players.find((player) => player.id === id);
}

export function addLog(state, message) {
  state.log.unshift({ id: `${Date.now()}-${Math.random()}`, round: state.round, message });
  state.log = state.log.slice(0, 80);
}

function rememberHand(observer, target) {
  observer.knowledge[target.id] = target.hand[0]?.defId || null;
}

function nextEligibleIndex(state, from) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (from + step + state.players.length) % state.players.length;
    if (state.players[index].alive) return index;
  }
  return from;
}

function consumeForcedTarget(state, cardId) {
  if (TARGETING_CARDS.has(cardId)) state.forcedTargetId = null;
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fail(error) {
  return { ok: false, error };
}
