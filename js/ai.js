import { CARD_DEFINITIONS, cardDef, totalCopies } from "./cards.js";
import { activePlayer, legalCardIds, playCard, resolvePending, getPlayer } from "./engine.js";

export function takeAiStep(state, rng = Math.random) {
  if (state.phase !== "playing") return { ok: false, error: "Game is not active." };
  const pending = state.pending;
  if (pending) return resolveAiPending(state, pending, rng);
  const actor = activePlayer(state);
  if (actor.type !== "ai") return { ok: false, error: "Waiting for a human." };
  const legal = legalCardIds(state);
  if (!legal.length) return { ok: false, error: "AI has no legal card." };
  const ranked = actor.hand
    .filter((card) => legal.includes(card.uid))
    .map((card) => ({ card, score: discardScore(state, actor, card, rng) }))
    .sort((a, b) => b.score - a.score);
  return playCard(state, ranked[0].card.uid);
}

function discardScore(state, actor, card, rng) {
  const def = cardDef(card);
  let score = 10 - def.value + rng() * 0.2;
  if (card.defId === "heart") score = -100;
  if (card.defId === "shield" && !actor.protected) score += 3;
  if (card.defId === "watchdog") score += 3;
  if (card.defId === "confessor" || card.defId === "seer") score += 1.5;
  if (card.defId === "fool" && state.deck.length > state.players.length) score += 1;
  if (card.defId === "widow") score -= 3;
  return score;
}

function resolveAiPending(state, pending, rng) {
  const actor = getPlayer(state, pending.actorId);
  if (!actor || actor.type !== "ai") return { ok: false, error: "Waiting for a human action." };

  if (pending.type === "choosePlayer") {
    return resolvePending(state, { playerId: chooseTarget(state, pending, actor, rng) });
  }
  if (pending.type === "choosePlayers") {
    const candidates = [...pending.eligibleIds];
    shuffleInPlace(candidates, rng);
    const forced = state.forcedTargetId && candidates.includes(state.forcedTargetId)
      ? [state.forcedTargetId] : [];
    const remaining = candidates.filter((id) => !forced.includes(id));
    return resolvePending(state, { playerIds: [...forced, ...remaining].slice(0, pending.max) });
  }
  if (pending.type === "guessValue") {
    return resolvePending(state, { value: chooseGuess(state, actor, pending.targetId, pending.cardId) });
  }
  if (pending.type === "discardRedraw") {
    const own = getPlayer(state, pending.actorId);
    const value = own.hand[0] ? cardDef(own.hand[0]).value : 9;
    return resolvePending(state, { redraw: value <= 4 });
  }
  if (pending.type === "inspectHand") return resolvePending(state, {});
  return { ok: false, error: "AI cannot resolve this action." };
}

function chooseTarget(state, pending, actor, rng) {
  const ids = pending.eligibleIds;
  if (pending.cardId === "dealer-inspect") return ids[0];
  if (pending.cardId === "fool") {
    return [...ids].sort((a, b) => estimatedStrength(actor, b) - estimatedStrength(actor, a))[0];
  }
  if (pending.cardId === "blade") {
    const ownValue = actor.hand[0] ? cardDef(actor.hand[0]).value : 9;
    if (ids.includes(actor.id) && ownValue <= 2) return actor.id;
  }
  if (pending.cardId === "duelist") {
    const ownValue = actor.hand[0] ? cardDef(actor.hand[0]).value : 0;
    const knownSafe = ids.find((id) => estimatedStrength(actor, id) >= 0 && estimatedStrength(actor, id) < ownValue);
    if (knownSafe) return knownSafe;
  }
  if (pending.cardId === "matriarch") {
    const ownValue = actor.hand[0] ? cardDef(actor.hand[0]).value : 9;
    const knownSafe = ids.find((id) => estimatedStrength(actor, id) > ownValue);
    if (knownSafe) return knownSafe;
  }
  return ids[Math.floor(rng() * ids.length)];
}

function estimatedStrength(actor, playerId) {
  const known = actor.knowledge[playerId];
  return known && CARD_DEFINITIONS[known] ? CARD_DEFINITIONS[known].value : -1;
}

function chooseGuess(state, actor, targetId, cardId) {
  const known = actor.knowledge[targetId];
  if (known && CARD_DEFINITIONS[known]) {
    const value = CARD_DEFINITIONS[known].value;
    if (cardId !== "watchdog" || value !== 1) return value;
  }
  const premium = state.mode === "premium";
  const counts = new Map();
  Object.values(CARD_DEFINITIONS).forEach((def) => {
    if ((!premium && def.premium) || (cardId === "watchdog" && def.value === 1)) return;
    counts.set(def.value, (counts.get(def.value) || 0) + totalCopies(def.id, premium));
  });
  const visible = [
    ...state.removedFaceUp,
    ...state.players.flatMap((player) => player.discard),
    ...actor.hand,
  ];
  visible.forEach((card) => {
    const value = cardDef(card).value;
    counts.set(value, Math.max(0, (counts.get(value) || 0) - 1));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 2;
}

function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

