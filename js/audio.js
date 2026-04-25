// audio.js — Procedural industrial soundtrack (Web Audio API)

export class SoundtrackManager {
    constructor() {
        this.ctx = null;
        this.playing = false;
        this.muted = false;
        this.bpm = 130;
        this.stepIndex = 0;
        this.nextStepTime = 0;
        this.stepLength = 60 / this.bpm / 4; // 16th note duration
        this._interval = null;
        this._continuousNodes = [];

        // Master chain nodes
        this.masterGain = null;
        this.compressor = null;
        this.distortion = null;

        // Reusable noise buffer
        this._noiseBuffer = null;

        // Beat patterns (16 steps = 1 bar of 4/4)
        //                   1 . . .  2 . . .  3 . . .  4 . . .
        this.patterns = {
            kick:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
            clank:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
            hihat:    [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
            metallic: [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,1],
        };

        // Second pattern for variation (plays every other 2 bars)
        this.patternsB = {
            kick:     [1,0,0,0, 1,0,0,0, 1,0,1,0, 1,0,0,1],
            clank:    [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
            hihat:    [1,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,1,0],
            metallic: [0,0,0,1, 0,0,0,0, 1,0,0,0, 0,1,0,0],
        };

        this.barCount = 0;
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

    // --- Master signal chain ---

    _buildMasterChain() {
        const ctx = this.ctx;

        // Waveshaper for subtle grit
        this.distortion = ctx.createWaveShaper();
        this.distortion.curve = this._makeDistortionCurve(8);
        this.distortion.oversample = '2x';

        // Compressor for punch
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 4;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.12;

        // Master gain
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0.45;

        // Chain: distortion → compressor → master → destination
        this.distortion.connect(this.compressor);
        this.compressor.connect(this.masterGain);
        this.masterGain.connect(ctx.destination);
    }

    _makeDistortionCurve(amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }

    _createNoiseBuffer() {
        // 2 seconds of white noise, reused for all noise-based sounds
        const len = this.ctx.sampleRate * 2;
        this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this._noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }

    // --- Beat scheduler ---

    _scheduler() {
        while (this.nextStepTime < this.ctx.currentTime + 0.1) {
            this._scheduleStep(this.stepIndex, this.nextStepTime);
            this.stepIndex++;
            if (this.stepIndex >= 16) {
                this.stepIndex = 0;
                this.barCount++;
            }
            this.nextStepTime += this.stepLength;
        }
    }

    _scheduleStep(step, time) {
        // Alternate pattern every 2 bars
        const pat = (this.barCount % 4 < 2) ? this.patterns : this.patternsB;

        if (pat.kick[step])     this._playKick(time);
        if (pat.clank[step])    this._playClank(time);
        if (pat.hihat[step])    this._playHihat(time);
        if (pat.metallic[step]) this._playMetallic(time);

        this._updateBass(step, time);
    }

    // --- Percussion instruments ---

    _playKick(time) {
        const ctx = this.ctx;

        // Pitched sine with rapid decay
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(35, time + 0.07);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.75, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

        // Sub layer for weight
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(55, time);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.5, time);
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

    _playClank(time) {
        const ctx = this.ctx;

        // Noise burst through resonant bandpass
        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3200;
        bp.Q.value = 3;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.55, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

        noise.connect(bp);
        bp.connect(noiseGain);
        noiseGain.connect(this.distortion);

        // Metallic ring component
        const ring = ctx.createOscillator();
        ring.type = 'square';
        ring.frequency.value = 185;

        const ringGain = ctx.createGain();
        ringGain.gain.setValueAtTime(0.12, time);
        ringGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

        ring.connect(ringGain);
        ringGain.connect(this.distortion);

        noise.start(time);
        noise.stop(time + 0.08);
        ring.start(time);
        ring.stop(time + 0.12);
    }

    _playHihat(time) {
        const ctx = this.ctx;

        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 9000;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.14, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

        noise.connect(hp);
        hp.connect(gain);
        gain.connect(this.compressor); // skip distortion for hats

        noise.start(time);
        noise.stop(time + 0.04);
    }

    _playMetallic(time) {
        const ctx = this.ctx;

        // Inharmonic frequencies = metallic timbre
        const freqs = [347, 563, 891, 1247];
        for (const f of freqs) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = f;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.05, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

            osc.connect(gain);
            gain.connect(this.compressor);

            osc.start(time);
            osc.stop(time + 0.18);
        }
    }

    // --- Continuous layers ---

    _startBass() {
        const ctx = this.ctx;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55; // A1

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
    }

    _updateBass(step, time) {
        if (!this._bassOsc) return;
        // A1=55, E1=41.2, G1=49 — dark minor movement
        if (step === 0)  this._bassOsc.frequency.setValueAtTime(55, time);
        if (step === 8)  this._bassOsc.frequency.setValueAtTime(41.2, time);
        if (step === 12) this._bassOsc.frequency.setValueAtTime(49, time);
    }

    _startDrone() {
        const ctx = this.ctx;

        // Two detuned sawtooths for thick drone
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = 27.5; // A0

        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = 27.8; // Slightly sharp for beating

        // Dark lowpass with slow LFO
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

        // Ambient machinery: filtered noise with slow amplitude modulation
        const noise = ctx.createBufferSource();
        noise.buffer = this._noiseBuffer;
        noise.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 400;
        bp.Q.value = 0.8;

        // Slow AM for rhythmic machinery feel
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

    // --- Weapon SFX ---

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

        // Whoosh
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

        // Low boom
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(20, t + 0.3);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.5, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        // Noise crackle
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
