// GARGANTUA — optional ambient music, fully procedural (WebAudio, no assets).

// A slow evolving drone: detuned sine pad + sub bass + filtered air noise,
// with sparse pentatonic bell sparkles scheduled via a lookahead timer.

const CHORD = [55.0, 82.41, 110.0, 130.81, 164.81];        // A2 E3 A3 C4 E4
const BELLS = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.playing = false;
    this.vol = 0.3;
    this.bellTimer = null;
    this.nextBell = 0;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.6;
    lp.connect(this.master);

    // drone pad: detuned sines with slow amplitude LFOs
    for (let i = 0; i < CHORD.length; i++) {
      const f = CHORD[i];
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (i === 0 ? 1 : 1 + 0.0015 * (i % 2 === 0 ? 1 : -1));
      osc.detune.value = (Math.random() - 0.5) * 8;

      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(lp);
      osc.start();

      // slow swell LFO
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.05 + i * 0.011;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.03 + Math.random() * 0.02;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();
    }

    // sub bass
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 36.71; // D1
    const sg = this.ctx.createGain();
    sg.gain.value = 0.05;
    sub.connect(sg);
    sg.connect(this.master);
    sub.start();
    const slfo = this.ctx.createOscillator();
    slfo.frequency.value = 0.02;
    const slg = this.ctx.createGain();
    slg.gain.value = 0.025;
    slfo.connect(slg);
    slg.connect(sg.gain);
    slfo.start();

    // air / wind: looped noise through a slow bandpass
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.012;
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    noise.start();
    const nlfo = this.ctx.createOscillator();
    nlfo.frequency.value = 0.05;
    const nlg = this.ctx.createGain();
    nlg.gain.value = 300;
    nlfo.connect(nlg);
    nlg.connect(bp.frequency);
    nlfo.start();
  }

  start() {
    this.ensure();
    if (!this.ctx || this.playing) return;
    this.ctx.resume().catch(() => {});
    this.playing = true;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.vol, now + 4.0);
    this.nextBell = now + 2;
    this.scheduleBells();
  }

  stop() {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0, now + 1.5);
    clearInterval(this.bellTimer);
    this.bellTimer = null;
  }

  toggle() {
    if (this.playing) this.stop();
    else this.start();
    return this.playing;
  }

  setVolume(v) {
    this.vol = v;
    if (this.ctx && this.playing) {
      this.master.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.5);
    }
  }

  scheduleBells() {
    clearInterval(this.bellTimer);
    this.bellTimer = setInterval(() => {
      if (!this.ctx || !this.playing) return;
      const now = this.ctx.currentTime;
      while (this.nextBell < now + 1.5) {
        this.playBell(this.nextBell);
        this.nextBell += 2.5 + Math.random() * 7;
      }
    }, 500);
  }

  playBell(at) {
    if (!this.ctx) return;
    const f = BELLS[(Math.random() * BELLS.length) | 0] * (Math.random() < 0.3 ? 0.5 : 1);
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * 6;

    const g = this.ctx.createGain();
    const peak = 0.015 + Math.random() * 0.025;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.5 + Math.random() * 3);

    // gentle stereo position
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.random() * 2 - 1;
      osc.connect(g);
      g.connect(pan);
      pan.connect(this.master);
    } else {
      osc.connect(g);
      g.connect(this.master);
    }
    osc.start(at);
    osc.stop(at + 6);
  }
}
