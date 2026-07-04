import { CARD_DEFINITIONS, cardDef, cardsForReference, totalCopies } from "./cards.js";
import {
  createGame, activePlayer, legalCardIds, playCard, resolvePending,
  nextRound, TOKEN_TARGETS, getPlayer,
} from "./engine.js";
import { takeAiStep } from "./ai.js";
import {
  saveGame, loadGame, clearGame, loadSettings, saveSettings,
} from "./storage.js";
import { playCue } from "./audio.js";

const app = document.querySelector("#app");
const live = document.querySelector("#live-region");
let state = null;
let screen = "menu";
let previousScreen = "menu";
let settings = loadSettings();
let selectedCardUid = null;
let selectedPlayers = new Set();
let installPrompt = null;
let aiTimer = null;
let renderedScreen = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  render();
});

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ["rules", "settings"].includes(screen)) {
    screen = previousScreen;
    render();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

render();

function render() {
  clearTimeout(aiTimer);
  const screenChanged = renderedScreen !== screen;
  document.documentElement.dataset.motion = settings.motion ? "on" : "off";
  if (screen === "menu") app.innerHTML = renderMenu();
  else if (screen === "setup") app.innerHTML = renderSetup();
  else if (screen === "rules") app.innerHTML = renderRules();
  else if (screen === "settings") app.innerHTML = renderSettings();
  else if (screen === "game" && state) app.innerHTML = renderGame();
  else {
    screen = "menu";
    app.innerHTML = renderMenu();
  }
  renderedScreen = screen;
  if (screenChanged) requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  scheduleAi();
}

function renderMenu() {
  const hasSave = Boolean(loadGame());
  return `
    <main class="menu-shell paper-screen">
      <section class="menu-art" aria-labelledby="title">
        <div class="brand-lockup">
          ${flashIcon("heart-dagger", "brand-mark")}
          <h1 id="title">Marked<br><span>Hearts</span></h1>
          <p class="tagline">A dirty little game of deduction.</p>
        </div>
        <div class="menu-flash" aria-hidden="true">
          ${flashIcon("rose")}
          ${flashIcon("skull")}
          ${flashIcon("envelope")}
        </div>
      </section>
      <section class="menu-actions" aria-label="Main menu">
        <p class="banner">Pass the letter. Guard your heart.</p>
        <button class="ink-button primary" data-action="new-game">New Game</button>
        <button class="ink-button" data-action="continue" ${hasSave ? "" : "disabled"}>Continue</button>
        <button class="ink-button" data-action="open-rules">Rules & Cards</button>
        <button class="ink-button" data-action="open-settings">Settings</button>
        ${installPrompt ? `<button class="text-button" data-action="install">Install app</button>` : ""}
        <p class="menu-foot">2–8 players · Solo AI or hot-seat · Works offline</p>
      </section>
    </main>`;
}

function renderSetup() {
  return `
    <main class="setup-shell paper-screen">
      <header class="screen-header">
        <button class="icon-button" data-action="menu" aria-label="Back to menu">${icon("back")}</button>
        <div><h1>Gather the crew</h1><p>Choose who holds a heart and who runs on cold logic.</p></div>
      </header>
      <form id="setup-form" class="setup-form">
        <label class="count-control">
          <span>Players</span>
          <select id="player-count" name="playerCount">
            ${Array.from({ length: 7 }, (_, i) => i + 2).map((n) => `<option value="${n}" ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <p id="deck-mode" class="mode-note">Classic 16-card deck · First to 4 Hearts</p>
        <div id="player-fields" class="player-fields">${renderPlayerFields(4)}</div>
        <button class="ink-button primary wide" type="submit">Deal the cards</button>
      </form>
    </main>`;
}

function renderPlayerFields(count, values = []) {
  const fallbackNames = ["Player 1", "Morgan", "Jules", "Ash", "Rook", "Kit", "Reyes", "Sal"];
  return Array.from({ length: count }, (_, index) => {
    const value = values[index] || {};
    return `
      <fieldset class="player-row">
        <legend>Player ${index + 1}</legend>
        <label>
          <span class="sr-only">Player ${index + 1} name</span>
          <input name="name-${index}" maxlength="18" value="${escapeHtml(value.name || fallbackNames[index])}" required>
        </label>
        <label>
          <span class="sr-only">Player ${index + 1} control</span>
          <select name="type-${index}">
            <option value="human" ${(value.type || (index === 0 ? "human" : "ai")) === "human" ? "selected" : ""}>Human</option>
            <option value="ai" ${(value.type || (index === 0 ? "human" : "ai")) === "ai" ? "selected" : ""}>AI</option>
          </select>
        </label>
      </fieldset>`;
  }).join("");
}

function renderGame() {
  if (state.phase === "roundOver") return renderRoundOver();
  if (state.phase === "gameOver") return renderGameOver();
  const actor = activePlayer(state);
  const humans = state.players.filter((player) => player.type === "human").length;
  const conceal = state.passRequired && actor.type === "human" && humans > 1;
  return `
    <main class="game-shell">
      <header class="game-header">
        <a class="mini-brand" href="#" data-action="menu" aria-label="Save and exit to menu">Marked <span>Hearts</span></a>
        <div class="round-stats">
          <span>${icon("star")} Round ${state.round}</span>
          <span>${icon("deck")} Deck ${state.deck.length}</span>
          <span>${icon("flame")} ${state.burned ? "1 burned" : "Burn used"}</span>
        </div>
        <div class="header-actions">
          <button class="icon-button" data-action="open-rules" aria-label="Rules">${icon("book")}</button>
          <button class="icon-button" data-action="open-settings" aria-label="Settings">${icon("gear")}</button>
          <button class="icon-button" data-action="save-exit" aria-label="Save and exit">${icon("exit")}</button>
        </div>
      </header>
      <section class="table">
        <div class="players-grid" style="--players:${state.players.length}">
          ${state.players.map((player) => renderPlayerPanel(player, actor.id)).join("")}
        </div>
        <section class="table-center" aria-label="Draw deck">
          <div class="deck-stack" aria-label="${state.deck.length} cards remain">${flashIcon("heart-dagger")}</div>
          <div class="burned-card">${flashIcon("flame")}<span>Burned</span></div>
          ${state.removedFaceUp.length ? `
            <details class="removed-cards">
              <summary>${state.removedFaceUp.length} removed face up</summary>
              <div>${state.removedFaceUp.map((card) => miniCard(card)).join("")}</div>
            </details>` : ""}
        </section>
        <section class="turn-zone ${actor.type === "ai" ? "ai-turn" : ""}">
          <div class="turn-banner">${turnLabel(actor)}</div>
          ${actor.type === "human" && !conceal ? renderHumanHand(actor) : `<div class="waiting-mark">${flashIcon(actor.type === "ai" ? "skull" : "envelope")}</div>`}
        </section>
        <aside class="action-log" aria-labelledby="log-title">
          <h2 id="log-title">Action log</h2>
          <ol>${state.log.slice(0, 10).map((entry) => `<li>${escapeHtml(entry.message)}</li>`).join("")}</ol>
        </aside>
      </section>
      ${conceal ? renderPassScreen(actor) : ""}
      ${state.pending && !conceal ? renderPending(state.pending) : ""}
    </main>`;
}

function renderPlayerPanel(player, activeId) {
  const classes = [
    "player-panel",
    player.id === activeId ? "current" : "",
    !player.alive ? "knocked-out" : "",
    player.protected ? "protected" : "",
  ].join(" ");
  return `
    <article class="${classes}" aria-label="${escapeHtml(player.name)}, ${player.tokens} Hearts, ${player.alive ? "in round" : "knocked out"}">
      <header>
        <h3>${escapeHtml(player.name)}</h3>
        <span>${player.type === "ai" ? "AI" : "Human"}</span>
      </header>
      <div class="status-row">
        <span class="tokens" aria-label="${player.tokens} affection Hearts">${heartTokens(player.tokens, TOKEN_TARGETS[state.players.length])}</span>
        <span class="player-status">${!player.alive ? `${icon("broken")} Out` : player.protected ? `${icon("shield")} Protected` : `${icon("eye")} In play`}</span>
      </div>
      <div class="discard-pile" aria-label="${player.discard.length} discarded cards">
        ${player.discard.length ? player.discard.slice(-4).map((card) => miniCard(card)).join("") : `<span class="empty-discard">No discards</span>`}
      </div>
    </article>`;
}

function renderHumanHand(actor) {
  const legal = new Set(legalCardIds(state));
  return `
    <div class="human-hand" aria-label="Your hand">
      ${actor.hand.map((card) => renderCard(card, {
        selectable: true,
        selected: card.uid === selectedCardUid,
        disabled: !legal.has(card.uid) || Boolean(state.pending),
      })).join("")}
    </div>
    <button class="ink-button play-button" data-action="play-card" ${selectedCardUid && legal.has(selectedCardUid) && !state.pending ? "" : "disabled"}>
      Play selected
    </button>`;
}

function renderCard(card, { selectable = false, selected = false, disabled = false } = {}) {
  const def = cardDef(card);
  const content = `
    <span class="card-value">${def.value}</span>
    <span class="card-art" aria-hidden="true">${flashIcon(def.icon)}</span>
    <strong>${escapeHtml(def.name)}</strong>
    <span class="card-effect">${escapeHtml(def.effect)}</span>`;
  if (!selectable) return `<article class="game-card">${content}</article>`;
  return `<button class="game-card selectable ${selected ? "selected" : ""}" data-action="select-card" data-card="${card.uid}" ${disabled ? "disabled" : ""} aria-pressed="${selected}">${content}</button>`;
}

function renderPassScreen(actor) {
  return `
    <div class="modal-backdrop privacy-backdrop">
      <section class="pass-screen" role="dialog" aria-modal="true" aria-labelledby="pass-title">
        ${flashIcon("envelope")}
        <p>Pass the device to</p>
        <h2 id="pass-title">${escapeHtml(actor.name)}</h2>
        <button class="ink-button primary" data-action="reveal-hand">Reveal my hand</button>
      </section>
    </div>`;
}

function renderPending(pending) {
  const actor = getPlayer(state, pending.actorId);
  if (actor?.type === "ai") return "";
  let body = "";
  let title = "Choose";
  if (pending.type === "choosePlayer") {
    title = pending.cardId === "dealer-inspect" ? "Inspect one new hand" : `${CARD_DEFINITIONS[pending.cardId]?.name || "Card"}: choose a player`;
    body = `<div class="target-list">${pending.eligibleIds.map((id) => targetButton(getPlayer(state, id))).join("")}</div>`;
  } else if (pending.type === "choosePlayers") {
    title = `${CARD_DEFINITIONS[pending.cardId].name}: choose ${pending.min === pending.max ? pending.min : "one or two"}`;
    body = `
      <div class="target-list multi">${pending.eligibleIds.map((id) => {
        const player = getPlayer(state, id);
        return `<label class="target-check"><input type="checkbox" data-player-check="${id}" ${selectedPlayers.has(id) ? "checked" : ""}><span>${escapeHtml(player.name)}</span></label>`;
      }).join("")}</div>
      <button class="ink-button primary" data-action="confirm-players">Confirm</button>`;
  } else if (pending.type === "guessValue") {
    title = `${CARD_DEFINITIONS[pending.cardId].name}: name a value`;
    body = `<div class="guess-grid">${Array.from({ length: 10 }, (_, value) => value)
      .filter((value) => pending.cardId !== "watchdog" || value !== 1)
      .map((value) => `<button class="guess-button" data-action="guess" data-value="${value}">${value}</button>`).join("")}</div>`;
  } else if (pending.type === "inspectHand") {
    title = "For your eyes only";
    body = `
      <div class="inspected-hands">${pending.playerIds.map((id) => {
        const player = getPlayer(state, id);
        return `<div><h3>${escapeHtml(player.name)}</h3>${player.hand.map((card) => renderCard(card)).join("")}</div>`;
      }).join("")}</div>
      <button class="ink-button primary" data-action="close-inspect">Got it</button>`;
  } else if (pending.type === "discardRedraw") {
    title = "The Saint found you";
    body = `<p>You may discard your current hand and draw a replacement.</p>
      <div class="choice-row"><button class="ink-button" data-action="saint-redraw" data-redraw="false">Keep it</button><button class="ink-button primary" data-action="saint-redraw" data-redraw="true">Redraw</button></div>`;
  }
  return `
    <div class="modal-backdrop">
      <section class="action-modal" role="dialog" aria-modal="true" aria-labelledby="action-title">
        <h2 id="action-title">${escapeHtml(title)}</h2>
        ${body}
      </section>
    </div>`;
}

function renderRoundOver() {
  const result = state.lastRound;
  return `
    <main class="result-shell paper-screen">
      <section class="result-poster">
        <p class="small-banner">Round ${state.round}</p>
        ${flashIcon("heart-dagger")}
        <h1>${result.winnerIds.length > 1 ? "Dead heat" : `${escapeHtml(getPlayer(state, result.winnerIds[0]).name)} wins`}</h1>
        <p>${escapeHtml(result.reason)}</p>
        <div class="revealed-grid">
          ${result.hands.map((item) => {
            const player = getPlayer(state, item.playerId);
            return `<article class="${item.alive ? "" : "knocked-out"}">
              <h2>${escapeHtml(player.name)}</h2>
              ${item.cards.length ? item.cards.map((id) => renderCard({ uid: id, defId: id })).join("") : `<p>No hand</p>`}
              <p>${item.alive ? `Showdown ${item.score} · Discards ${item.discardTotal}` : "Knocked out"}</p>
              <strong>${player.tokens} / ${TOKEN_TARGETS[state.players.length]} Hearts</strong>
            </article>`;
          }).join("")}
        </div>
        <button class="ink-button primary" data-action="next-round">Deal next round</button>
        <button class="text-button" data-action="save-exit">Save & exit</button>
      </section>
    </main>`;
}

function renderGameOver() {
  const names = state.winnerIds.map((id) => getPlayer(state, id).name);
  return `
    <main class="result-shell game-over paper-screen">
      <section class="result-poster">
        <p class="small-banner">The final mark</p>
        ${flashIcon("crown")}
        <h1>${names.length > 1 ? "Shared glory" : `${escapeHtml(names[0])} wins`}</h1>
        <p>${names.length > 1 ? `${names.map(escapeHtml).join(" and ")} reached the target together.` : `First to ${TOKEN_TARGETS[state.players.length]} Hearts.`}</p>
        <ol class="final-scores">${[...state.players].sort((a, b) => b.tokens - a.tokens).map((player) => `<li><span>${escapeHtml(player.name)}</span><strong>${player.tokens} ${icon("heart")}</strong></li>`).join("")}</ol>
        <button class="ink-button primary" data-action="new-game">Play again</button>
        <button class="ink-button" data-action="menu-clear">Main menu</button>
      </section>
    </main>`;
}

function renderRules() {
  const premium = state?.mode === "premium";
  return `
    <main class="overlay-page paper-screen">
      <header class="screen-header">
        <button class="icon-button" data-action="close-overlay" aria-label="Close rules">${icon("back")}</button>
        <div><h1>Rules & cards</h1><p>Draw one. Play one. Stay alive.</p></div>
      </header>
      <section class="rules-copy">
        <article><h2>The round</h2><p>Hold one secret card. On your turn, draw a second card, play one, and resolve its effect. Protection blocks effects from other players until your next turn.</p></article>
        <article><h2>Winning</h2><p>The last player standing wins the round. If the deck runs out, survivors compare hands; highest wins, then highest discard total. Exact ties each earn a Heart.</p></article>
        <article><h2>The game</h2><p>First to 7 Hearts with 2 players, 5 with 3, and 4 with 4–8 players wins. Five or more players use all 32 cards.</p></article>
        <article><h2>Two players</h2><p>One card is burned face down and three more are removed face up each round.</p></article>
      </section>
      <section class="reference-section">
        <div class="reference-heading">
          <h2>Flash sheet</h2>
          <button class="text-button" data-action="toggle-reference">${premium ? "Show core only" : "Show all 32 cards"}</button>
        </div>
        <div class="reference-grid">
          ${cardsForReference(premium).map((def) => `
            <article class="reference-card">
              <span class="ref-value">${def.value}</span>${flashIcon(def.icon)}
              <div><h3>${escapeHtml(def.name)} <small>×${totalCopies(def.id, premium)}</small></h3><p>${escapeHtml(def.effect)}</p></div>
            </article>`).join("")}
        </div>
      </section>
      <p class="rules-note">Original theme and artwork. Mechanics follow the 2016 Premium ruleset.</p>
    </main>`;
}

function renderSettings() {
  return `
    <main class="overlay-page settings-page paper-screen">
      <header class="screen-header">
        <button class="icon-button" data-action="close-overlay" aria-label="Close settings">${icon("back")}</button>
        <div><h1>Settings</h1><p>Keep the ink loud or quiet.</p></div>
      </header>
      <section class="settings-list">
        <label><span><strong>Sound</strong><small>Short card and victory cues</small></span><input type="checkbox" id="setting-sound" ${settings.sound ? "checked" : ""}></label>
        <label><span><strong>Motion</strong><small>Card slides and ink-stamp feedback</small></span><input type="checkbox" id="setting-motion" ${settings.motion ? "checked" : ""}></label>
        <button class="ink-button" data-action="ios-help">How to install on iPhone</button>
        ${installPrompt ? `<button class="ink-button primary" data-action="install">Install on this device</button>` : ""}
      </section>
      <div id="ios-instructions" class="ios-instructions" hidden>
        <h2>Install on iPhone or iPad</h2>
        <p>Open this page in Safari, tap Share, then choose <strong>Add to Home Screen</strong>.</p>
      </div>
    </main>`;
}

function targetButton(player) {
  return `<button class="target-button" data-action="choose-player" data-player="${player.id}"><span>${escapeHtml(player.name)}</span><small>${player.protected ? "Protected" : `${player.discard.length} discards`}</small></button>`;
}

function miniCard(card) {
  const def = cardDef(card);
  return `<span class="mini-card" title="${escapeHtml(def.name)}"><b>${def.value}</b>${flashIcon(def.icon)}</span>`;
}

function heartTokens(count, target) {
  return Array.from({ length: target }, (_, index) => `<span class="${index < count ? "filled" : ""}">${icon("heart")}</span>`).join("");
}

function turnLabel(player) {
  const name = player.name.trim();
  if (name.toLowerCase() === "you") return player.type === "human" ? "Your move" : "You are thinking";
  return player.type === "human" ? `${escapeHtml(name)}'s move` : `${escapeHtml(name)} is thinking`;
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  event.preventDefault();
  const action = button.dataset.action;

  if (action === "new-game") {
    screen = "setup";
    selectedCardUid = null;
  } else if (action === "continue") {
    state = loadGame();
    if (state) {
      settings = { ...settings, ...state.settings };
      screen = "game";
    }
  } else if (action === "menu" || action === "save-exit") {
    if (state) saveGame(state);
    screen = "menu";
  } else if (action === "menu-clear") {
    clearGame();
    state = null;
    screen = "menu";
  } else if (action === "open-rules") {
    previousScreen = screen;
    screen = "rules";
  } else if (action === "open-settings") {
    previousScreen = screen;
    screen = "settings";
  } else if (action === "close-overlay") {
    screen = previousScreen;
  } else if (action === "select-card") {
    selectedCardUid = button.dataset.card;
  } else if (action === "play-card") {
    const result = playCard(state, selectedCardUid);
    if (result.ok) {
      selectedCardUid = null;
      afterTransition("play");
    } else announce(result.error);
  } else if (action === "reveal-hand") {
    state.passRequired = false;
    saveGame(state);
  } else if (action === "choose-player") {
    transition(resolvePending(state, { playerId: button.dataset.player }));
  } else if (action === "confirm-players") {
    transition(resolvePending(state, { playerIds: [...selectedPlayers] }));
    selectedPlayers.clear();
  } else if (action === "guess") {
    transition(resolvePending(state, { value: Number(button.dataset.value) }));
  } else if (action === "close-inspect") {
    transition(resolvePending(state, {}));
  } else if (action === "saint-redraw") {
    transition(resolvePending(state, { redraw: button.dataset.redraw === "true" }));
  } else if (action === "next-round") {
    transition(nextRound(state), "draw");
  } else if (action === "toggle-reference") {
    if (!state) state = { mode: "premium" };
    else state.mode = state.mode === "premium" ? "core" : "premium";
  } else if (action === "ios-help") {
    document.querySelector("#ios-instructions").hidden = false;
    button.hidden = true;
    return;
  } else if (action === "install" && installPrompt) {
    installPrompt.prompt();
    installPrompt = null;
  }
  render();
}

function handleChange(event) {
  if (event.target.id === "player-count") {
    const current = [...document.querySelectorAll(".player-row")].map((row) => ({
      name: row.querySelector("input").value,
      type: row.querySelector("select").value,
    }));
    const count = Number(event.target.value);
    document.querySelector("#player-fields").innerHTML = renderPlayerFields(count, current);
    document.querySelector("#deck-mode").textContent = `${count >= 5 ? "Premium 32-card deck" : "Classic 16-card deck"} · First to ${TOKEN_TARGETS[count]} Hearts`;
    return;
  }
  if (event.target.matches("[data-player-check]")) {
    const id = event.target.dataset.playerCheck;
    if (event.target.checked) selectedPlayers.add(id);
    else selectedPlayers.delete(id);
    return;
  }
  if (event.target.id === "setting-sound" || event.target.id === "setting-motion") {
    settings.sound = document.querySelector("#setting-sound").checked;
    settings.motion = document.querySelector("#setting-motion").checked;
    saveSettings(settings);
    if (state) {
      state.settings = { ...settings };
      saveGame(state);
    }
    render();
  }
}

document.addEventListener("submit", (event) => {
  if (event.target.id !== "setup-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const count = Number(form.get("playerCount"));
  const players = Array.from({ length: count }, (_, index) => ({
    name: form.get(`name-${index}`),
    type: form.get(`type-${index}`),
  }));
  state = createGame({ players, settings });
  clearGame();
  saveGame(state);
  screen = "game";
  playCue("draw", settings.sound);
  render();
});

function transition(result, cue = "play") {
  if (!result?.ok) {
    announce(result?.error || "That action is not available.");
    return;
  }
  afterTransition(cue);
  render();
}

function afterTransition(cue) {
  state.settings = { ...settings };
  saveGame(state);
  playCue(state.phase === "gameOver" || state.phase === "roundOver" ? "win" : cue, settings.sound);
  announce(state.log[0]?.message || "Move complete.");
}

function scheduleAi() {
  if (screen !== "game" || !state || state.phase !== "playing" || state.passRequired) return;
  const actor = activePlayer(state);
  const pendingActor = state.pending ? getPlayer(state, state.pending.actorId) : null;
  if (actor.type !== "ai" && pendingActor?.type !== "ai") return;
  aiTimer = setTimeout(() => {
    const result = takeAiStep(state);
    if (result.ok) afterTransition("play");
    else announce(result.error);
    render();
  }, settings.motion ? 650 : 80);
}

function announce(message) {
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function flashIcon(kind, className = "") {
  const icons = {
    heart: `<path d="M50 85C22 64 10 45 18 29c8-16 28-14 32 1 4-15 24-17 32-1 8 16-4 35-32 56Z"/><path d="M50 17v68"/>`,
    "heart-dagger": `<path d="M50 89C22 67 11 49 18 34c8-16 27-13 32 2 5-15 24-18 32-2 7 15-4 33-32 55Z"/><path d="m55 4-8 42 9 4-14 44 5-42-9-4Z"/><path d="m40 18 22 5"/>`,
    rose: `<path d="M50 27c15-16 31 4 18 16 14 6 5 25-9 20-5 16-26 8-22-6-16 1-18-19-4-24-7-15 12-24 17-6Z"/><path d="M48 60 37 94M42 78 24 67M40 84l17-10"/>`,
    skull: `<path d="M23 49c0-22 12-36 27-36s27 14 27 36c0 12-6 18-14 22v16H37V71c-8-4-14-10-14-22Z"/><circle cx="38" cy="48" r="8"/><circle cx="62" cy="48" r="8"/><path d="m50 57-5 9h10ZM42 76v11m8-11v11m8-11v11"/>`,
    envelope: `<path d="M10 25h80v55H10Z"/><path d="m11 27 39 31 39-31M11 79l29-29m49 29L60 50"/><path d="M50 53c-12-8-17-17-12-24 4-7 11-5 12 2 2-7 9-9 13-2 5 7 0 16-13 24Z"/>`,
    flame: `<path d="M52 91c-25 0-36-21-26-42 5-11 15-17 13-36 13 7 17 20 14 31 7-5 11-13 10-22 16 13 21 28 14 44-5 15-14 25-25 25Z"/><path d="M50 80c-9-1-14-9-10-18 2-5 7-8 7-16 9 6 14 14 9 23 5-2 7-6 8-10 4 11-3 22-14 21Z"/>`,
    crown: `<path d="m16 70-7-43 25 19 16-33 16 33 25-19-7 43Z"/><path d="M16 70h68v16H16ZM25 60h50"/>`,
    dagger: `<path d="m56 8-7 51-11 11-8-8 11-11Z"/><path d="m25 55 20 20M22 67l11 11M46 76 29 93"/>`,
    shield: `<path d="M50 9 84 22v25c0 22-13 36-34 45-21-9-34-23-34-45V22Z"/><path d="M50 25v49M31 45h38"/>`,
    veil: `<path d="M50 10c17 0 26 17 26 33v46H24V43c0-16 9-33 26-33Z"/><path d="M36 43c7-7 21-7 28 0M39 56c8 6 14 6 22 0"/><path d="M23 89 8 69m69 20 15-20"/>`,
    eye: `<path d="M8 52s17-27 42-27 42 27 42 27-17 27-42 27S8 52 8 52Z"/><circle cx="50" cy="52" r="14"/><circle cx="50" cy="52" r="5"/>`,
    dog: `<path d="m27 35-15-16 3 32c-7 8-5 28 5 39h60c10-11 12-31 5-39l3-32-15 16C61 26 39 26 27 35Z"/><circle cx="36" cy="56" r="4"/><circle cx="64" cy="56" r="4"/><path d="m50 61-7 7 7 6 7-6ZM31 79h38"/>`,
    halo: `<ellipse cx="50" cy="18" rx="28" ry="9"/><path d="M50 28 75 82H25Z"/><path d="m50 39-8 22 8 12 8-12Z"/>`,
    badge: `<path d="m50 8 12 23 26 4-19 19 5 27-24-13-24 13 5-27-19-19 26-4Z"/><circle cx="50" cy="49" r="12"/>`,
    horseshoe: `<path d="M28 14c-19 15-17 56 2 73 13 11 27 11 40 0 19-17 21-58 2-73l-11 16c9 9 7 38-2 45-6 5-12 5-18 0-9-7-11-36-2-45Z"/><path d="M20 31h17m-20 20h17m46-20H63m20 20H66"/>`,
    snake: `<path d="M25 80c22 17 52 5 49-14-3-17-28-11-31-27-3-13 13-24 29-15"/><path d="m70 24 18-9-4 19Z"/><circle cx="79" cy="23" r="1"/>`,
    cards: `<path d="m20 24 52-12 14 61-52 12Z"/><path d="M14 33h55v58H14Z"/><path d="M42 75c-13-10-18-19-12-27 5-7 12-4 12 3 1-7 8-10 13-3 6 8 1 17-13 27Z"/>`,
    bell: `<path d="M27 67c8-8 7-26 7-36h32c0 10-1 28 7 36Z"/><path d="M21 67h58M42 76h16"/><circle cx="34" cy="22" r="8"/><circle cx="66" cy="22" r="8"/>`,
    broken: `<path d="M50 87C21 65 10 44 19 28c7-13 22-12 31 2 9-14 24-15 31-2 9 16-2 37-31 59Z"/><path d="m55 20-11 25 12 8-13 29"/>`,
  };
  const path = icons[kind] || icons.heart;
  return `<svg class="flash-icon ${className}" viewBox="0 0 100 100" aria-hidden="true">${path}</svg>`;
}

function icon(kind) {
  const paths = {
    heart: `<path d="M12 21C5 16 2 11 4 7c2-4 7-3 8 1 1-4 6-5 8-1 2 4-1 9-8 14Z"/>`,
    star: `<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z"/>`,
    deck: `<path d="M4 8h14v11H4zM7 5h14v11M10 2h11v11"/>`,
    flame: `<path d="M12 22c-6 0-9-5-6-10 1-3 4-4 3-9 4 2 5 6 4 9 3-2 3-5 3-7 5 4 6 8 4 12-1 3-4 5-8 5Z"/>`,
    book: `<path d="M3 4h7c2 0 2 2 2 2s0-2 2-2h7v15h-7c-2 0-2 2-2 2s0-2-2-2H3ZM12 6v15"/>`,
    gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>`,
    exit: `<path d="M10 4H4v16h6M14 8l4 4-4 4m-7-4h11"/>`,
    back: `<path d="m15 5-7 7 7 7M8 12h12"/>`,
    shield: `<path d="M12 2 20 5v6c0 5-3 9-8 11-5-2-8-6-8-11V5Z"/>`,
    eye: `<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2"/>`,
    broken: `<path d="M12 21C5 16 2 11 4 7c2-4 7-3 8 1 1-4 6-5 8-1 2 4-1 9-8 14Z"/><path d="m13 6-3 6 4 2-3 6"/>`,
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.heart}</svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
