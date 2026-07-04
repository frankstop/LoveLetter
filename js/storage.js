import { validateState } from "./engine.js";

const GAME_KEY = "marked-hearts-game-v1";
const SETTINGS_KEY = "marked-hearts-settings-v1";

export const DEFAULT_SETTINGS = {
  sound: true,
  motion: !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
};

export function saveGame(state) {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_KEY));
    return validateState(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    // Storage can be unavailable in private browsing; the current session still works.
  }
}

export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: settings simply remain session-only.
  }
}

