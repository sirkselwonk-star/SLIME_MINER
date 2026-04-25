// audio.js — Procedural industrial soundtrack (Web Audio API)
// 32-bar arrangement cycle with swing, ghost notes, and section-based bass

export class SoundtrackManager {
    constructor() {
        this.ctx = null;
        this.playing = false;
        this.muted = false;
        this.bpm = 130;
        this.stepLength = 60 / this.bpm / 4; // 16th note duration
        this.swingRatio = 0.58; // 0.5=straight, 0.67=triplet — subtle push
        this._interval = null;
        this._continuousNodes = [];

        // Master chain nodes
        this.masterGain = null;
        this.compressor = null;
        this.distortion = null;
        this._noiseBuffer = null;

        // Transport state
        this.stepIndex = 0;
        this.barCount = 0;
        this.arrIndex = 0;   // index into arrangement
        this.barInSection = 0;

        // --- Pattern bank (velocity 0.0–1.0 per step) ---
        // Each pattern is one bar of 16 steps (16th notes in 4/4)
        //                        1  .  .  .   2  .  .  .   3  .  .  .   4  .  .  .
        this.patBank = [
            // 0: "Stripped" — kick + sparse hat, builds tension
            { kick:    [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
              clank:   [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              hihat:   [0, 0,.5, 0,  0, 0,.5, 0,  0, 0,.5, 0,  0, 0,.5, 0],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              metal:   [.4,0, 0, 0,  0, 0, 0, 0, .4, 0, 0, 0,  0, 0, 0, 0] },

            // 1: "Building" — snare enters, kick ghost notes add push
            { kick:    [1, 0, 0, 0, .8, 0, 0,.3,  1, 0, 0, 0, .8, 0,.6, 0],
              clank:   [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
              hihat:   [.5,0, 1,.3, .5, 0, 1,.3, .5, 0, 1,.3, .5, 0, 1,.3],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              metal:   [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0,.5] },

            // 2: "Main Groove A" — full kit, syncopated kick, open hat on 4-and
            { kick:    [1, 0, 0, 0, .8, 0, 0,.3,  1, 0,.3, 0, .7, 0, 1, 0],
              clank:   [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0,.4],
              hihat:   [.6,0, 1,.3, .6, 0, 1,.3, .6, 0, 1,.3, .6, 0, 0, 0],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0],
              metal:   [.7,0, 0, 0,  0, 0,.4, 0,  0, 0, 0, 0,  0, 0, 0, 0] },

            // 3: "Main Groove B" — shifted kick, ghost hats, different accent
            { kick:    [1, 0, 0,.3,  0, 0, 1, 0, .8, 0, 0, 0, .5, 0, 1,.3],
              clank:   [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0,.4,  1, 0, 0, 0],
              hihat:   [.6,.3,1,.3, .6,.3, 1, 0, .6,.3, 1,.3, .5, 0, 0, 0],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 1],
              metal:   [0, 0, 0,.5,  0, 0, 0, 0, .6, 0, 0, 0,  0, 0,.4, 0] },

            // 4: "Breakdown" — half-time, sparse, menacing
            { kick:    [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              clank:   [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
              hihat:   [0, 0, 0, 0, .4, 0, 0, 0,  0, 0, 0, 0, .4, 0, 0, 0],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              metal:   [.5,0, 0, 0,  0, 0, 0, 0, .3, 0, 0, 0,  0, 0, 0, 0] },

            // 5: "Rebuild" — climbing back from breakdown, momentum
            { kick:    [1, 0, 0, 0, .6, 0, 0, 0,  1, 0, 0, 0, .6, 0, 0,.3],
              clank:   [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0, .8, 0, 0, 0],
              hihat:   [.5,0,.7, 0, .5, 0,.7, 0, .5, 0,.7, 0, .5, 0,.7,.3],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              metal:   [0, 0, 0, 0,  0, 0,.4, 0,  0, 0, 0, 0,  0, 0,.4, 0] },

            // 6: "Heavy" — dense 16th hats, driving kick, peak energy
            { kick:    [1, 0,.3, 0,  1, 0, 0,.3,  1, 0,.3, 0,  1, 0, 1,.3],
              clank:   [0, 0, 0, 0,  1, 0, 0,.3,  0, 0, 0, 0,  1, 0, 0, 0],
              hihat:   [.7,.3,.8,.3, .7,.3,.8,.3, .7,.3,.8,.3, .7,.3,.8, 0],
              openHat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0,.8],
              metal:   [1, 0, 0, 0,  0, 0,.5, 0,  0, 0, 0,.4,  0, 0, 0, 0] },

            // 7: "Fill" — kick roll, snare roll, crash — turnaround bar
            { kick:    [1, 0, 0, 0,  1, 0, 1, 0,  1, 0, 1, 1,  1, 1, 1, 1],
              clank:   [0, 0, 0, 0,  0, 0, 0, 0, .3, 0,.4, 0, .5,.6,.8, 1],
              hihat:   [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
              openHat: [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 1],
              metal:   [0, 0, 0, 0,  0, 0, 0, 0, .3,.3,.5,.5, .7,.7, 1, 1] },
        ];

        // --- Bass progressions (step → frequency pairs) ---
        // Each entry: [[step, freq], ...]
        this.bassProgs = [
            /* 0  root    */ [[0, 55]],
            /* 1  minor   */ [[0, 55], [8, 41.2], [12, 49]],
            /* 2  dark    */ [[0, 55], [4, 58.3], [8, 41.2], [12, 55]],
            /* 3  low-D   */ [[0, 36.7]],
            /* 4  eighth  */ [[0,55],[2,55],[4,41.2],[6,41.2],[8,49],[10,49],[12,55],[14,55]],
            /* 5  descend */ [[0, 55], [4, 49], [8, 41.2], [12, 36.7]],
        ];

        // --- 32-bar arrangement cycle ---
        // pat = patBank index, bars = how many bars, bass = bassProgs index
        this.arrangement = [
            { pat: 0, bars: 2, bass: 0 },   // Intro — stripped, root drone
            { pat: 1, bars: 2, bass: 1 },   // Build — snare enters
            { pat: 2, bars: 4, bass: 1 },   // Main groove A
            { pat: 3, bars: 4, bass: 2 },   // Main groove B — darker bass
            { pat: 4, bars: 2, bass: 3 },   // Breakdown — low D
            { pat: 5, bars: 2, bass: 1 },   // Rebuild — momentum
            { pat: 6, bars: 4, bass: 4 },   // Heavy — eighth-note bass
            { pat: 2, bars: 4, bass: 2 },   // Return to main — dark bass
            { pat: 3, bars: 3, bass: 1 },   // Main B
            { pat: 7, bars: 1, bass: 5 },   // Fill — turnaround
            { pat: 4, bars: 2, bass: 3 },   // Breakdown reprise
            { pat: 6, bars: 2, bass: 4 },   // Heavy return
        ];
    }

    start() {
        if (this.playing) return;

        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this._buildMasterChain();
            this._createNoiseBuffer();
        }

        if (this.ctx.state === 'suspended') this.ctx.resume();

        this.playing = true;
        this.stepIndex = 0;
        this.barCount = 0;
        this.arrIndex = 0;
        this.barInSection = 0;
        this.nextStepTime = this.ctx.currentTime + 0.05;

        this._startDrone();
        this._startBass();
        this._startMachinery();

        this._interval = setInterval(() => this._scheduler(), 25);
    }

    stop() {
        this.playing = false;
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        for (const node of this._continuousNodes) {
            try { node.stop(); } catch (e) { /* already stopped */ }
        }
        this._continuousNodes = [];
        this._bassOsc = null;
        this._bassGain = null;
        this._bassFilter = null;
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(
                this.muted ? 0 : 0.45,
                this.ctx.currentTime, 0.05
            );
        }
        return this.muted;
    }

    // ========== Master signal chain ==========

    _buildMasterChain() {
        const ctx = this.ctx;

        this.distortion = ctx.createWaveShaper();
        this.distortion.curve = this._makeDistortionCurve(8);
        this.distortion.oversample = '2x';

        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 4;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.12;

        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0.45;

        this.distortion.connect(this.compressor);
        this.compressor.connect(this.masterGain);
        this.masterGain.connect(ctx.destination);
    }

    _makeDistortionCurve(amount) {
        const n = 44100;
        const curve = new Float32Array(n);
        const deg = Math.PI / 180;
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }

    _createNoiseBuffer() {
        const len = this.ctx.sampleRate * 2;
        this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this._noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    // ========== Beat scheduler with swing ==========

    _scheduler() {
        while (this.nextStepTime < this.ctx.currentTime + 0.1) {
            this._scheduleStep(this.stepIndex, this.nextStepTime);

            // Advance step with swing timing
            // Pairs of 16ths: even→odd gets stretched, odd→even gets compressed
            const pairDur = this.stepLength * 2; // one 8th note
            if (this.stepIndex % 2 === 0) {
                this.nextStepTime += pairDur * this.swingRatio;
            } else {
                this.nextStepTime += pairDur * (1 - this.swingRatio);
            }

            this.stepIndex++;
            if (this.stepIndex >= 16) {
                this.stepIndex = 0;
                this.barCount++;
                this.barInSection++;
                this._advanceArrangement();
            }
        }
    }

    _advanceArrangement() {
        const section = this.arrangement[this.arrIndex];
        if (this.barInSection >= section.bars) {
            this.barInSection = 0;
            this.arrIndex = (this.arrIndex + 1) % this.arrangement.length;
        }
    }

    _scheduleStep(step, time) {
        const section = this.arrangement[this.arrIndex];
        const pat = this.patBank[section.pat];

        if (pat.kick[step])    this._playKick(time, pat.kick[step]);
        if (pat.clank[step])   this._playClank(time, pat.clank[step]);
        if (pat.hihat[step])   this._playHihat(time, pat.hihat[step]);
        if (pat.openHat[step]) this._playOpenHat(time, pat.openHat[step]);
        if (pat.metal[step])   this._playMetallic(time, pat.metal[step]);

        this._updateBass(step, time, section.bass);
    }

    // ========== Percussion instruments (velocity-scaled) ==========

    _playKick(time, vel) {
        const ctx = this.ctx;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(35, time + 0.07);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.75 * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

        // Sub layer
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(55, time);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.5 * vel, time);
        subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

        osc.connect(gain);
        gain.connect(this.distortion);
        sub.connect(subGain);
        subGain.connect(this.distortion);

        osc.start(time);
        osc.stop(time + 0.25);
        sub.start(time);
        sub.stop(time + 0.18);
    }

    _playClank(time, vel) {
        const ctx = this.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3200;
        bp.Q.value = 3;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.55 * vel, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

        noise.connect(bp);
        bp.connect(noiseGain);
        noiseGain.connect(this.distortion);

        // Metallic ring
        const ring = ctx.createOscillator();
        ring.type = 'square';
        ring.frequency.value = 185;

        const ringGain = ctx.createGain();
        ringGain.gain.setValueAtTime(0.12 * vel, time);
        ringGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

        ring.connect(ringGain);
        ringGain.connect(this.distortion);

        noise.start(time);
        noise.stop(time + 0.08);
        ring.start(time);
        ring.stop(time + 0.12);
    }

    _playHihat(time, vel) {
        const ctx = this.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 9000;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.16 * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

        noise.connect(hp);
        hp.connect(gain);
        gain.connect(this.compressor);

        noise.start(time);
        noise.stop(time + 0.04);
    }

    _playOpenHat(time, vel) {
        const ctx = this.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 5500;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.2 * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

        noise.connect(hp);
        hp.connect(gain);
        gain.connect(this.compressor);

        noise.start(time);
        noise.stop(time + 0.18);
    }

    _playMetallic(time, vel) {
        const ctx = this.ctx;
        const freqs = [347, 563, 891, 1247];
        for (const f of freqs) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = f;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.05 * vel, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

            osc.connect(gain);
            gain.connect(this.compressor);

            osc.start(time);
            osc.stop(time + 0.18);
        }
    }

    // ========== Continuous layers ==========

    _startBass() {
        const ctx = this.ctx;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 180;
        lp.Q.value = 5;

        const gain = ctx.createGain();
        gain.gain.value = 0.22;

        osc.connect(lp);
        lp.connect(gain);
        gain.connect(this.distortion);

        osc.start();
        this._continuousNodes.push(osc);
        this._bassOsc = osc;
        this._bassGain = gain;
        this._bassFilter = lp;
    }

    _updateBass(step, time, bassProgIdx) {
        if (!this._bassOsc) return;
        const prog = this.bassProgs[bassProgIdx];
        for (const [s, freq] of prog) {
            if (step === s) {
                this._bassOsc.frequency.setValueAtTime(freq, time);
                // Filter + volume envelope per note hit — adds groove pulse
                this._bassFilter.frequency.setValueAtTime(350, time);
                this._bassFilter.frequency.exponentialRampToValueAtTime(180, time + 0.1);
                this._bassGain.gain.setValueAtTime(0.28, time);
                this._bassGain.gain.setTargetAtTime(0.16, time + 0.02, 0.08);
            }
        }
    }

    _startDrone() {
        const ctx = this.ctx;

        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = 27.5;

        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = 27.8;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 80;
        lp.Q.value = 2;

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.08;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 40;
        lfo.connect(lfoGain);
        lfoGain.connect(lp.frequency);

        const gain = ctx.createGain();
        gain.gain.value = 0.12;

        osc1.connect(lp);
        osc2.connect(lp);
        lp.connect(gain);
        gain.connect(this.distortion);

        osc1.start();
        osc2.start();
        lfo.start();

        this._continuousNodes.push(osc1, osc2, lfo);
    }

    _startMachinery() {
        const ctx = this.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;
        noise.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 400;
        bp.Q.value = 0.8;

        const amOsc = ctx.createOscillator();
        amOsc.type = 'sine';
        amOsc.frequency.value = 0.3;

        const amGain = ctx.createGain();
        amGain.gain.value = 0;

        const amDepth = ctx.createGain();
        amDepth.gain.value = 0.04;

        amOsc.connect(amDepth);
        amDepth.connect(amGain.gain);

        noise.connect(bp);
        bp.connect(amGain);
        amGain.connect(this.compressor);

        noise.start();
        amOsc.start();

        this._continuousNodes.push(noise, amOsc);
    }

    // ========== Weapon SFX ==========

    playGunSound() {
        if (!this.ctx || this.muted) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.04);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 400;

        osc.connect(hp);
        hp.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.06);
    }

    playRocketSound() {
        if (!this.ctx || this.muted) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(600, t);
        bp.frequency.exponentialRampToValueAtTime(200, t + 0.3);
        bp.Q.value = 1;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        noise.connect(bp);
        bp.connect(gain);
        gain.connect(ctx.destination);

        noise.start(t);
        noise.stop(t + 0.3);
    }

    playExplosionSound() {
        if (!this.ctx || this.muted) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(20, t + 0.3);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.5, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2000, t);
        lp.frequency.exponentialRampToValueAtTime(100, t + 0.4);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.3, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        noise.connect(lp);
        lp.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.4);
        noise.start(t);
        noise.stop(t + 0.4);
    }
}
