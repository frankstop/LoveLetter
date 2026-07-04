import test from "node:test";
import assert from "node:assert/strict";
import { buildDeck, makeCard } from "../js/cards.js";
import {
  createGame, legalCardIds, legalTargets, playCard, resolvePending, nextRound,
  validateState, TOKEN_TARGETS, endRound,
} from "../js/engine.js";
import { takeAiStep } from "../js/ai.js";

function seeded(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function game(count = 2, type = "human") {
  const state = createGame({
    players: Array.from({ length: count }, (_, i) => ({ name: `P${i + 1}`, type })),
    settings: { sound: false, motion: false },
  }, seeded(count));
  state.passRequired = false;
  return state;
}

function setHands(state, hands) {
  state.players.forEach((player, index) => {
    player.hand = hands[index].map((id, cardIndex) => makeCard(id, `${player.id}-${id}-${cardIndex}`));
  });
  state.deck = [makeCard("confessor", "deck-spare")];
  state.pending = null;
  state.phase = "playing";
  state.activePlayer = 0;
  state.passRequired = false;
}

test("core and Premium decks contain the exact expected number of cards", () => {
  assert.equal(buildDeck(false).length, 16);
  assert.equal(buildDeck(true).length, 32);
  assert.equal(buildDeck(true).filter((card) => card.defId === "watchdog").length, 8);
  assert.equal(buildDeck(true).filter((card) => card.defId === "lucky-hand").length, 2);
});

test("two-player setup burns one hidden card and removes three face up", () => {
  const state = game(2);
  assert.ok(state.burned);
  assert.equal(state.removedFaceUp.length, 3);
  assert.equal(state.deck.length, 9);
  assert.equal(state.players[0].hand.length, 2);
  assert.equal(state.players[1].hand.length, 1);
});

test("five players use Premium mode and the 32-card deck", () => {
  const state = game(5);
  assert.equal(state.mode, "premium");
  assert.equal(state.removedFaceUp.length, 0);
  assert.equal(state.deck.length, 25);
});

test("The Widow is forced when held with The Crown or The Blade", () => {
  const state = game(2);
  setHands(state, [["widow", "crown"], ["heart"]]);
  assert.deepEqual(legalCardIds(state), [state.players[0].hand[0].uid]);
  setHands(state, [["widow", "blade"], ["heart"]]);
  assert.deepEqual(legalCardIds(state), [state.players[0].hand[0].uid]);
});

test("protection prevents another player from targeting a Shielded player", () => {
  const state = game(3);
  state.players[1].protected = true;
  const targets = legalTargets(state, state.players[0].id, { allowSelf: false, cardId: "watchdog" });
  assert.deepEqual(targets.map((player) => player.id), [state.players[2].id]);
});

test("Watchdog correct guess eliminates its target", () => {
  const state = game(2);
  setHands(state, [["watchdog", "shield"], ["heart"]]);
  const result = playCard(state, state.players[0].hand[0].uid);
  assert.equal(result.ok, true);
  resolvePending(state, { playerId: state.players[1].id });
  resolvePending(state, { value: 8 });
  assert.equal(state.players[1].alive, false);
  assert.equal(state.phase, "roundOver");
});

test("The Killer reverses a Watchdog and redraws", () => {
  const state = game(2);
  setHands(state, [["watchdog", "shield"], ["killer"]]);
  playCard(state, state.players[0].hand[0].uid);
  resolvePending(state, { playerId: state.players[1].id });
  resolvePending(state, { value: 8 });
  assert.equal(state.players[0].alive, false);
  assert.equal(state.players[1].alive, true);
  assert.notEqual(state.players[1].hand[0]?.defId, "killer");
});

test("The Heart knocks out the player who discards it", () => {
  const state = game(2);
  setHands(state, [["heart", "shield"], ["watchdog"]]);
  playCard(state, state.players[0].hand[0].uid);
  assert.equal(state.players[0].alive, false);
  assert.equal(state.phase, "roundOver");
});

test("The Blade uses the burned card when forcing a redraw from an empty deck", () => {
  const state = game(2);
  setHands(state, [["blade", "shield"], ["confessor"]]);
  state.deck = [];
  state.burned = makeCard("heart", "burned-heart");
  playCard(state, state.players[0].hand[0].uid);
  resolvePending(state, { playerId: state.players[1].id });
  assert.equal(state.players[1].hand[0]?.defId, "heart");
  assert.equal(state.burned, null);
});

test("players tied at the Heart target continue into a tiebreak round", () => {
  const state = game(5);
  state.players[0].tokens = 3;
  state.players[1].tokens = 4;
  state.players[1].discard = [makeCard("badge", "badge")];
  state.players[1].alive = false;
  state.players[0].alive = true;
  state.players.slice(2).forEach((player) => { player.alive = false; });
  endRound(state);
  assert.equal(state.phase, "roundOver");
  assert.deepEqual(state.tieBreakerIds, [state.players[0].id, state.players[1].id]);
  nextRound(state, seeded(99));
  assert.deepEqual(
    state.players.filter((player) => player.alive).map((player) => player.id),
    state.tieBreakerIds,
  );
});

test("Fixer requirement is included in a multi-player Dealer choice", () => {
  const state = game(5);
  setHands(state, [["dealer", "heart"], ["shield"], ["shield"], ["shield"], ["shield"]]);
  state.forcedTargetId = state.players[2].id;
  playCard(state, state.players[0].hand[0].uid);
  assert.equal(state.pending.type, "choosePlayers");
  assert.equal(state.pending.requiredId, state.players[2].id);
  const bad = resolvePending(state, { playerIds: [state.players[1].id, state.players[3].id] });
  assert.equal(bad.ok, false);
  const good = resolvePending(state, { playerIds: [state.players[1].id, state.players[2].id] });
  assert.equal(good.ok, true);
});

test("saved state validation rejects malformed and accepts game state", () => {
  assert.equal(validateState({ version: 1 }), false);
  assert.equal(validateState(game(4)), true);
});

test("token thresholds match all player counts", () => {
  assert.deepEqual(TOKEN_TARGETS, { 2: 7, 3: 5, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 });
});

for (let count = 2; count <= 8; count += 1) {
  test(`${count}-player all-AI game reaches a legal winner`, () => {
    const state = game(count, "ai");
    const rng = seeded(100 + count);
    let steps = 0;
    while (state.phase !== "gameOver" && steps < 10000) {
      if (state.phase === "roundOver") {
        const result = nextRound(state, rng);
        assert.equal(result.ok, true);
      } else {
        const result = takeAiStep(state, rng);
        assert.equal(result.ok, true, result.error);
      }
      steps += 1;
    }
    assert.equal(state.phase, "gameOver");
    assert.ok(state.winnerIds.length >= 1);
    assert.ok(state.players.some((player) => player.tokens >= TOKEN_TARGETS[count]));
  });
}
