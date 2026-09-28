// Все звуки синтезируются на лету через WebAudio — никаких файлов.
(function () {
  'use strict';

  const Sound = {
    ctx: null,
    master: null,
    muted: false,
    lastWall: 0,

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    toggle() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
      return this.muted;
    },

    tone(freq, dur, { type = 'sine', vol = 0.2, to = null, delay = 0, attack = 0.005 } = {}) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },

    noise(dur, { vol = 0.2, freq = 1000, q = 1, type = 'bandpass', to = null, delay = 0 } = {}) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t0);
      if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0);
    },

    hit(power) {
      this.noise(0.08, { vol: 0.3 + power * 0.4, freq: 1800, q: 0.8 });
      this.tone(180 + power * 120, 0.12, { type: 'triangle', vol: 0.25, to: 90 });
    },
    wall(speed) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      if (now - this.lastWall < 0.05) return;
      this.lastWall = now;
      const v = Math.min(1, speed / 900);
      this.tone(420 + v * 300, 0.07, { type: 'square', vol: 0.03 + v * 0.1, to: 200 });
    },
    spinner() {
      this.tone(140, 0.15, { type: 'sawtooth', vol: 0.12, to: 70 });
      this.noise(0.1, { vol: 0.15, freq: 400 });
    },
    bumper() {
      this.tone(300, 0.25, { type: 'sine', vol: 0.3, to: 900 });
      this.tone(600, 0.12, { type: 'square', vol: 0.06, to: 1400 });
    },
    portal() {
      this.tone(200, 0.45, { type: 'sine', vol: 0.25, to: 1600 });
      this.noise(0.4, { vol: 0.12, freq: 300, to: 4000, q: 4 });
    },
    button(on) {
      this.tone(on ? 660 : 440, 0.1, { type: 'square', vol: 0.12 });
      this.tone(on ? 990 : 330, 0.18, { type: 'square', vol: 0.1, delay: 0.09 });
    },
    splash() {
      this.noise(0.6, { vol: 0.5, freq: 900, to: 200, q: 0.7, type: 'lowpass' });
      this.tone(500, 0.2, { vol: 0.15, to: 120 });
      this.tone(900, 0.1, { vol: 0.08, to: 300, delay: 0.12 });
    },
    void() {
      this.tone(400, 1.2, { type: 'sawtooth', vol: 0.15, to: 30 });
      this.tone(80, 1.2, { type: 'sine', vol: 0.4, to: 25 });
    },
    sink(good) {
      this.noise(0.12, { vol: 0.3, freq: 600, q: 2 });
      this.tone(220, 0.15, { type: 'triangle', vol: 0.3, to: 110, delay: 0.05 });
      const notes = good ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
      notes.forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.18, delay: 0.25 + i * 0.09 }));
    },
    fanfare() {
      [523, 523, 523, 698, 880, 1047].forEach((f, i) =>
        this.tone(f, i === 5 ? 0.6 : 0.16, { type: 'square', vol: 0.09, delay: i * 0.13 })
      );
    },
  };

  window.Sound = Sound;
})();
