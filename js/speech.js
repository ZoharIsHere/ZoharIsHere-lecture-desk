// speech.js — the browser's own speech recognition (free, no AI tokens).
// Chrome sends audio to Google's recogniser; nothing is recorded or stored as audio.
// Recognition stops on silence or after a minute, so it restarts itself.

export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export class Listener {
  /** opts: { lang, onFinal(text), onInterim(text), onState(state), onError(msg) } */
  constructor(opts) { this.o = opts; this.on = false; this.rec = null; this.fails = 0; }

  start() {
    if (this.on) return;
    if (!speechSupported()) { this.o.onError?.('This browser can’t listen. Use Google Chrome.'); return; }
    this.on = true; this.fails = 0;
    this.spawn();
    this.o.onState?.('listening');
  }

  stop() {
    this.on = false;
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.rec = null;
    this.o.onState?.('off');
  }

  setLang(lang) {
    this.o.lang = lang;
    if (this.on) { try { this.rec?.stop(); } catch { /* restarts in onend */ } }
  }

  spawn() {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new R();
    rec.lang = this.o.lang || 'he-IL';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      this.fails = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.o.onFinal?.(text); else interim += text + ' ';
      }
      this.o.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.o.onError?.('Microphone access was blocked. Allow it in the address bar, then press Listen again.');
        this.stop();
      } else if (e.error === 'network') {
        this.fails++;
      }
      // 'no-speech' and 'aborted' are normal: onend restarts.
    };
    rec.onend = () => {
      if (!this.on) return;
      if (this.fails > 5) { this.o.onError?.('Listening keeps failing; check the connection.'); this.stop(); return; }
      setTimeout(() => { if (this.on) this.spawn(); }, this.fails ? 1000 * this.fails : 150);
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { console.warn('[speech]', e); }
  }
}
