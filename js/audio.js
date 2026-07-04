let context;

export function playCue(name, enabled = true) {
  if (!enabled) return;
  try {
    context ||= new AudioContext();
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { play: 145, draw: 220, win: 392, knock: 82 };
    osc.type = name === "win" ? "triangle" : "square";
    osc.frequency.setValueAtTime(frequencies[name] || 160, now);
    if (name === "win") osc.frequency.exponentialRampToValueAtTime(587, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch {
    // Audio feedback is optional and must never block a move.
  }
}

