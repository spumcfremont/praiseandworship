/* Metronome: a steady click, scheduled on the Web Audio clock so the tempo stays exact.
   This module only plays the tempo it's given. The screen (app.js) decides which tempo to use:
   the song's own tempo, or the one the user set for it. */
(function (root) {
  "use strict";
  const MIN = 30;
  const MAX = 240;
  let ctx = null;
  let bpm = 100;
  let running = false;
  let timer = 0;
  let nextTime = 0;
  let beat = 0;
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => { try { fn(event); } catch {} });

  function audio() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One short click; the first beat of each bar is higher.
  function click(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.8 : 0.45, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // Schedule clicks a little ahead of time. A tempo change applies from the next click.
  function schedule() {
    while (nextTime < ctx.currentTime + 0.12) {
      const accent = beat % 4 === 0;
      click(nextTime, accent);
      const delay = Math.max(0, (nextTime - ctx.currentTime) * 1000);
      const n = beat;
      setTimeout(() => { if (running) emit({ type: "beat", beat: n, accent }); }, delay);
      nextTime += 60 / bpm;
      beat += 1;
    }
  }

  root.Metronome = {
    min: MIN,
    max: MAX,
    bpm: () => bpm,
    playing: () => running,
    setBpm(n) {
      const v = Math.round(Number(n));
      if (Number.isFinite(v)) bpm = Math.min(MAX, Math.max(MIN, v));
      emit({ type: "tempo", bpm });
      return bpm;
    },
    start() {
      if (running) return;
      audio();
      running = true;
      beat = 0;
      nextTime = ctx.currentTime + 0.05;
      timer = setInterval(schedule, 25);
      schedule();
      emit({ type: "state", playing: true, bpm });
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      emit({ type: "state", playing: false, bpm });
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})(window);
