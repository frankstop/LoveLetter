export const CARD_DEFINITIONS = {
  heart: {
    id: "heart", name: "The Heart", value: 8, copies: 1, icon: "heart",
    effect: "If you discard The Heart, you are knocked out of the round.",
  },
  widow: {
    id: "widow", name: "The Widow", value: 7, copies: 1, icon: "veil",
    effect: "You must discard The Widow if you also hold The Crown or The Blade.",
  },
  crown: {
    id: "crown", name: "The Crown", value: 6, copies: 1, icon: "crown",
    effect: "Trade hands with another player.",
  },
  blade: {
    id: "blade", name: "The Blade", value: 5, copies: 2, icon: "dagger",
    effect: "Choose any player. They discard their hand and draw a new card.",
  },
  shield: {
    id: "shield", name: "The Shield", value: 4, copies: 2, icon: "shield",
    effect: "You are protected from other players until your next turn.",
  },
  duelist: {
    id: "duelist", name: "The Duelist", value: 3, copies: 2, icon: "rose",
    effect: "Compare hands with another player. The lower value is knocked out.",
  },
  confessor: {
    id: "confessor", name: "The Confessor", value: 2, copies: 2, icon: "eye",
    effect: "Secretly inspect another player's hand.",
  },
  watchdog: {
    id: "watchdog", name: "The Watchdog", value: 1, copies: 5, icon: "dog",
    effect: "Name a value other than 1. If your target holds it, knock them out.",
  },
  saint: {
    id: "saint", name: "The Saint", value: 9, copies: 1, premium: true, icon: "halo",
    effect: "Name a value and a player. If correct, gain a Heart. They may redraw.",
  },
  matriarch: {
    id: "matriarch", name: "The Matriarch", value: 7, copies: 1, premium: true, icon: "flame",
    effect: "Compare hands. The higher value is knocked out.",
  },
  badge: {
    id: "badge", name: "The Badge", value: 6, copies: 1, premium: true, icon: "badge",
    effect: "If you are knocked out after discarding this, gain a Heart.",
  },
  "lucky-hand": {
    id: "lucky-hand", name: "The Lucky Hand", value: 5, copies: 2, premium: true, icon: "horseshoe",
    effect: "Each discarded Lucky Hand adds 1 to your hand at the showdown.",
  },
  fixer: {
    id: "fixer", name: "The Fixer", value: 4, copies: 2, premium: true, icon: "snake",
    effect: "Choose who must be included in the next targeting effect.",
  },
  seer: {
    id: "seer", name: "The Seer", value: 3, copies: 2, premium: true, icon: "eye",
    effect: "Secretly inspect one or two other hands.",
  },
  dealer: {
    id: "dealer", name: "The Dealer", value: 2, copies: 2, premium: true, icon: "cards",
    effect: "Choose two players to trade hands, then inspect one of them.",
  },
  fool: {
    id: "fool", name: "The Fool", value: 0, copies: 1, premium: true, icon: "bell",
    effect: "Bet on another player. Gain a Heart if they win the round.",
  },
  killer: {
    id: "killer", name: "The Killer", value: 0, copies: 1, premium: true, icon: "skull",
    effect: "If a Watchdog targets you, its player is knocked out and you redraw.",
  },
};

const CORE_ORDER = ["heart", "widow", "crown", "blade", "shield", "duelist", "confessor", "watchdog"];
const PREMIUM_ADDITIONS = [
  ["saint", 1], ["matriarch", 1], ["badge", 1], ["lucky-hand", 2],
  ["fixer", 2], ["seer", 2], ["dealer", 2], ["watchdog", 3],
  ["fool", 1], ["killer", 1],
];

export function buildDeck(premium = false) {
  const cards = [];
  for (const id of CORE_ORDER) {
    const def = CARD_DEFINITIONS[id];
    for (let i = 0; i < def.copies; i += 1) cards.push(makeCard(id, `core-${id}-${i}`));
  }
  if (premium) {
    for (const [id, count] of PREMIUM_ADDITIONS) {
      for (let i = 0; i < count; i += 1) cards.push(makeCard(id, `premium-${id}-${i}`));
    }
  }
  return cards;
}

export function makeCard(defId, uid = `${defId}-${crypto.randomUUID?.() || Math.random()}`) {
  return { uid, defId };
}

export function cardDef(card) {
  return CARD_DEFINITIONS[card.defId];
}

export function cardsForReference(premium) {
  return Object.values(CARD_DEFINITIONS)
    .filter((card) => premium || !card.premium)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function totalCopies(id, premium) {
  if (id === "watchdog") return premium ? 8 : 5;
  const def = CARD_DEFINITIONS[id];
  return premium || !def.premium ? def.copies : 0;
}

