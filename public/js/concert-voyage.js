// Concert Voyage — the concert-ticket sequence, self-contained.
//
// Structure copied from the old site's concert_voyage.js (2026-08-02), with
// one change: it used to be loaded after app.js and inherit these four
// globals from it. Op: Reconnect never loads app.js, so they're declared
// here instead of on the page. Nothing else about the sequence changed.
var concertPlayer, strobeInterval, waveInterval, progressInterval;
const CONCERT_VIDEO_ID = 'sj95YLW-7-g';

function injectConcertVoyageCSS() {
  if (document.getElementById('concert-voyage-extra-css')) return;
  const s = document.createElement('style');
  s.id = 'concert-voyage-extra-css';
  s.textContent = `
    .vy-phase1-bg { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 35%, #1a1040, #060612 55%, #000); }
    .vy-portal-ring { position:absolute; width:min(70vw,340px); height:min(70vw,340px); border-radius:50%; border:2px solid rgba(168,85,247,0.45); animation:vySpin 10s linear infinite; opacity:0.5; }
    .vy-portal-ring--2 { width:min(55vw,260px); height:min(55vw,260px); border-color:rgba(255,255,255,0.2); animation-direction:reverse; animation-duration:7s; }
    .vy-portal-core { position:absolute; width:min(30vw,120px); height:min(30vw,120px); border-radius:50%; background:radial-gradient(circle,#fff,rgba(168,85,247,0.7),transparent); animation:vyCorePulse 2s ease-in-out infinite; }
    @keyframes vySpin { to { transform:rotate(360deg); } }
    @keyframes vyCorePulse { 50% { transform:scale(1.15); opacity:1; } }
    .ship-warp-drive { animation:warpSpeed 3s cubic-bezier(0.5,0,0.2,1) forwards !important; }
    @keyframes warpSpeed { 0%{transform:scale(1) translateY(0);filter:blur(0) brightness(1)} 40%{transform:scale(0.9) translateY(10px);filter:blur(1px) brightness(1.5)} 100%{transform:scale(4) translateY(-100px);filter:blur(15px) brightness(5);opacity:0} }
    
    /* --- DYNAMIC MOVEMENT ANIMATIONS --- */
    #my-army-bomb {
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        --wave-speed: 4s; 
        transform-origin: bottom center !important;
    }

    .anim-sway { animation: moveSway var(--wave-speed) ease-in-out infinite alternate; }
    .anim-drift { animation: moveDrift var(--wave-speed) linear infinite; }
    .anim-ocean { animation: moveOcean var(--wave-speed) ease-in-out infinite alternate; }
    .anim-stars { animation: moveStars var(--wave-speed) ease-in-out infinite alternate; }
    .anim-flutter { animation: moveFlutter var(--wave-speed) linear infinite; }

    @keyframes moveSway { 
        0% { transform: rotate(-24deg) scale(1); } 
        100% { transform: rotate(24deg) scale(1.03); } 
    }
    @keyframes moveDrift { 
        0%, 100% { transform: translate(0, 0) rotate(0deg); } 
        25% { transform: translate(30px, -15px) rotate(10deg); } 
        50% { transform: translate(-10px, -30px) rotate(-8deg); } 
        75% { transform: translate(-30px, -10px) rotate(6deg); } 
    }
    @keyframes moveOcean { 
        0%, 100% { transform: translateY(0) rotate(0deg); } 
        50% { transform: translateY(-35px) rotate(12deg); } 
    }
    @keyframes moveStars { 
        0%, 100% { transform: translateY(0) rotate(0deg) scale(1); } 
        25% { transform: translateY(-24px) rotate(8deg) scale(1.06); } 
        75% { transform: translateY(-16px) rotate(-8deg) scale(0.94); } 
    }
    @keyframes moveFlutter { 
        0%, 100% { transform: rotate(0); } 
        25% { transform: rotate(-15deg) translate(-6px,-6px); } 
        50% { transform: rotate(0) translate(0,-12px); } 
        75% { transform: rotate(15deg) translate(6px,-6px); } 
    }

    #ambient-glow, #bomb-back-glow { transition: background-color 1s ease; }

    /* --- SOFT GLASSMORPHISM UI --- */
    .soft-controls-panel {
        position: absolute; bottom: 25px; left: 50%; transform: translateX(-50%); 
        z-index: 1000; background: rgba(15, 15, 20, 0.7); backdrop-filter: blur(25px); 
        border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px;
        display: flex; flex-direction: column; gap: 8px; padding: 10px 16px;
        width: max-content; max-width: 95vw; transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        overflow: visible !important; /* Ensure the toggle button is not clipped */
    }
    .soft-controls-panel.minimized {
        bottom: -95px; opacity: 0.6; filter: blur(2px) grayscale(1);
    }
    .panel-toggle-btn {
        position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff; border-radius: 10px; padding: 4px 12px; font-size: 8px; 
        font-family: 'Orbitron'; cursor: pointer; backdrop-filter: blur(12px);
        box-shadow: 0 -5px 15px rgba(0,0,0,0.3); transition: all 0.3s;
        display: flex; align-items: center; gap: 4px;
    }
    .panel-toggle-btn:hover { background: rgba(255, 255, 255, 0.3); transform: translateX(-50%) translateY(-2px); }

    .soft-pill-btn {
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.6); padding: 4px 8px; border-radius: 8px;
        font-size: 8px; font-family: 'Orbitron', sans-serif; cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .soft-pill-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
    .soft-pill-btn.active {
        background: rgba(255,255,255,0.25); color: #fff; font-weight: bold;
        border-color: rgba(255,255,255,0.5); box-shadow: 0 0 10px rgba(255,255,255,0.2);
    }

    .soft-btn { border: none; outline: none; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    .color-btn {
        width: 20px; height: 20px; border-radius: 50%; background: var(--btn-color);
        box-shadow: inset 2px 2px 4px rgba(255, 255, 255, 0.4), 0 4px 10px rgba(0, 0, 0, 0.4);
    }
    .color-btn:hover { transform: translateY(-3px) scale(1.1); box-shadow: inset 2px 2px 6px rgba(255, 255, 255, 0.6), inset -2px -2px 6px rgba(0, 0, 0, 0.2), 0 8px 15px var(--btn-color); }
    .color-btn:active { transform: translateY(1px) scale(0.95); box-shadow: inset 3px 3px 8px rgba(0, 0, 0, 0.4); }

    .rainbow-btn { background: linear-gradient(135deg, #ef4444, #fbbf24, #22c55e, #3b82f6, #a855f7); }

    .text-btn {
        background: transparent; color: #fff; font-size: 9px; font-weight: 900; 
        font-family: 'Orbitron'; padding: 4px 8px; border-radius: 12px;
    }
    .text-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.1); text-shadow: 0 0 10px rgba(255, 255, 255, 0.8); }

    .vy-controls-row {
        display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap;
    }
    .vy-controls-row.secondary-row {
        gap: 8px;
    }
    .vy-controls-divider-v {
        width: 1px; height: 10px; background: rgba(255,255,255,0.2);
    }
    .vy-controls-divider-h {
        width: 100%; height: 1px; background: rgba(255,255,255,0.1);
    }

    #youtube-player {
        aspect-ratio: 16 / 9;
        width: 100vw !important;
        height: auto !important;
        max-height: 100vh !important;
        object-fit: contain !important;
        opacity: 1 !important; /* CRITICAL: Full quality */
        pointer-events: none;
        z-index: 2;
        transform: scale(1.5) !important; /* Start cropped! */
        transform-origin: center center !important;
        transition: transform 2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    #youtube-player.vy-player-normal {
        transform: scale(1.4) !important;
        transform-origin: center center !important;
    }

    .vy-sky-bg {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at center, #0c0824 0%, #030308 70%, #000 100%) !important;
        z-index: 1;
        pointer-events: none;
        overflow: hidden !important;
    }

    .vy-star {
        position: absolute;
        background: #fff;
        border-radius: 50%;
        box-shadow: 0 0 6px #fff, 0 0 12px rgba(168, 85, 247, 0.6);
        opacity: 0.3;
        pointer-events: none;
        animation: vyStarBlink var(--blink-dur, 3s) ease-in-out infinite;
    }

    @keyframes vyStarBlink {
        0%, 100% { opacity: 0.1; transform: scale(0.6); }
        50% { opacity: 1; transform: scale(1.3); }
    }

    /* Magical floating dust */
    .concert-dust {
        background-image: radial-gradient(1px 1px at 20px 30px, #fff, transparent);
        background-repeat: repeat; background-size: 200px 200px;
        animation: magicDrift 20s linear infinite; mix-blend-mode: overlay; opacity: 0.3;
    }

    @keyframes magicDrift {
        0% { transform: translateY(0px) translateX(0px); }
        100% { transform: translateY(-200px) translateX(-50px); }
    }

    /* ── MAGICAL OVERLAY LAYER ── */
    @keyframes waveBarAnim {
        0%   { transform: scaleY(0.35); opacity: 0.4; }
        100% { transform: scaleY(1.2);  opacity: 0.9; }
    }
    @keyframes liveBlip {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.2; }
    }
    @keyframes heartFloat {
        0%   { transform: translateY(0) scale(1); opacity: 1; }
        100% { transform: translateY(-120px) scale(0.5); opacity: 0; }
    }
    @keyframes lyricDrift {
        0%   { opacity: 0; transform: translateX(0); }
        8%   { opacity: 1; }
        90%  { opacity: 0.8; }
        100% { opacity: 0; transform: translateX(110vw); }
    }
    #vy-love-btn:active { transform: scale(0.9) !important; }

    @media (max-width: 600px) {
        #video-wrapper iframe { transform: scale(1.5) !important; width: 100vw !important; height: auto !important; aspect-ratio: 16 / 9 !important; transition: transform 2s cubic-bezier(0.4, 0, 0.2, 1) !important; }
        #video-wrapper iframe.vy-player-normal { transform: scale(1.4) !important; }
        #fan-zone { bottom: 18%; }
        
        .soft-controls-panel {
            bottom: 12px;
            padding: 8px 12px;
            gap: 6px;
            border-radius: 16px;
            max-width: 98vw;
        }
        .soft-controls-panel.minimized {
            bottom: -64px;
            opacity: 0.5;
        }
        .panel-toggle-btn {
            top: -24px;
            padding: 3px 10px;
            font-size: 8px;
            border-radius: 8px;
        }
        .soft-pill-btn {
            padding: 4px 6px;
            font-size: 8px;
            border-radius: 6px;
        }
        .color-btn {
            width: 20px;
            height: 20px;
        }
        .text-btn {
            font-size: 9px;
            padding: 4px 6px;
        }
        .vy-controls-row {
            gap: 6px;
        }
        .vy-controls-row.secondary-row {
            gap: 8px;
        }
        .vy-controls-divider-v {
            height: 10px;
        }
    }

    .vy-finale { position:absolute; inset:0; z-index:70; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; opacity:0; transition:opacity 1s; }
    .vy-finale--on { opacity:1; }
    .vy-finale__army { font-family:Orbitron; font-size:64px; font-weight:900; color:#fff; text-shadow:0 0 40px #a855f7; }

    /* Magical Interactivity: Stardust Trail */
    .bomb-sparkle {
        position: absolute; width: 4px; height: 4px; border-radius: 50%;
        pointer-events: none; z-index: 15; mix-blend-mode: screen;
        animation: sparkleFade 1s cubic-bezier(0.1, 1, 0.3, 1) forwards;
    }
    @keyframes sparkleFade {
        0% { transform: scale(1) translateY(0); opacity: 0.8; background: #fff; }
        100% { transform: scale(0) translateY(-25px); opacity: 0; }
    }

    /* Cultural Magic: Fanchants */
    .fanchant-word {
        position: absolute; bottom: 5%; left: 50%; transform: translateX(-50%);
        font-family: 'Orbitron', sans-serif; font-size: clamp(32px, 8vw, 80px);
        font-weight: 900; color: transparent; -webkit-text-stroke: 1px rgba(255, 255, 255, 0.6);
        text-shadow: 0 0 30px rgba(168, 85, 247, 0.8); pointer-events: none; z-index: 500;
        animation: fanchantRise 3s ease-out forwards; white-space: nowrap;
    }
    @keyframes fanchantRise {
        0% { transform: translate(-50%, 50px) scale(0.8); opacity: 0; }
        20% { transform: translate(-50%, 0px) scale(1); opacity: 1; }
        80% { transform: translate(-50%, -100px) scale(1.05); opacity: 1; }
        100% { transform: translate(-50%, -160px) scale(1.1); opacity: 0; filter: blur(10px); }
    }

    /* Lore Magic: Whalien 52 */
    .magic-whale {
        position: absolute; left: -20%; font-size: clamp(100px, 15vw, 200px);
        opacity: 0.05; filter: blur(10px) drop-shadow(0 0 40px #a855f7);
        pointer-events: none; z-index: 2; animation: whaleSwim 28s linear forwards;
    }
    @keyframes whaleSwim {
        0% { transform: translateX(0vw) translateY(0px) rotate(-10deg); }
        50% { transform: translateX(60vw) translateY(-40px) rotate(5deg); }
        100% { transform: translateX(125vw) translateY(10px) rotate(-15deg); }
    }
  `;
  document.head.appendChild(s);
}

window.launchTheVoyage = function () {
  const existing = document.getElementById('voyage-overlay');
  if (existing) existing.remove();

  if (typeof ensureVoyageStyles === 'function') {
    ensureVoyageStyles();
  }
  injectConcertVoyageCSS();

  const root = document.createElement('div');
  root.id = 'voyage-overlay';
  root.className = 'vy-root';
  
  root.innerHTML = `
    <!-- PHASE 1: THE MAGIC SHIP -->
    <div id="phase-1-ship" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; transition: opacity 1s ease;">
        <div class="vy-arirang-ship" id="sailing-ship">
            <div class="vy-arirang__glow"></div>
            <div class="vy-arirang__sail vy-arirang__sail--g1"></div>
            <div class="vy-arirang__sail vy-arirang__sail--g2"></div>
            <div class="vy-arirang__sail vy-arirang__sail--g3"></div>
            <div class="vy-arirang__hull"><div class="vy-arirang__hull-name">Arirang</div></div>
            <div class="vy-arirang__wake"><div class="vy-arirang__foam"></div></div>
        </div>
        <div id="warp-text" style="margin-top: 40px; font-family: 'Orbitron'; font-size: 14px; color: #a855f7; letter-spacing: 4px; text-transform: uppercase; animation: pulse 1s infinite;">Initiating Magic Shop Portal...</div>
    </div>

    <div id="magic-flash" style="position: absolute; inset: 0; background: radial-gradient(circle, #fff 0%, #a855f7 50%, #000 100%); opacity: 0; pointer-events: none; z-index: 80; transition: opacity 2s ease-in;"></div>

    <div id="phase-2-concert" style="position: absolute; inset: 0; opacity: 0; pointer-events: none; z-index: 60; transition: opacity 2s ease-out; background: #000; overflow: hidden;">
        
        <div id="video-wrapper" class="vy-sky-bg" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 1; overflow: hidden !important;">
            <div class="vy-stars-container" style="position: absolute; inset: 0; z-index: 0; pointer-events: none;"></div>
            <div id="youtube-player" class="vy-player-cropped" style="position: relative; z-index: 1;"></div>
            <div class="vy-video-shield" style="position: absolute; inset: 0; z-index: 5; pointer-events: auto; background: transparent;"></div>
        </div>

        <div id="yt-chrome-cover" style="position: absolute; inset: 0; z-index: 8; pointer-events: none; background: #000; opacity: 1; transition: opacity 0.6s ease;"></div>
        <div style="position: absolute; inset: 0; z-index: 2; pointer-events: none; background: radial-gradient(circle at 50% 50%, transparent 40%, rgba(0,0,0,0.4) 80%, #000 100%);"></div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 120px; z-index: 9; pointer-events: none; background: linear-gradient(to top, #000 30%, rgba(0,0,0,0.7) 70%, transparent 100%);"></div>
        <div style="position: absolute; top: 0; left: 0; right: 0; height: 100px; z-index: 9; pointer-events: none; background: linear-gradient(to bottom, #000 30%, rgba(0,0,0,0.7) 70%, transparent 100%);"></div>
        <div id="ambient-glow" style="position: absolute; inset: 0; z-index: 3; background: #a855f7; opacity: 0.1; mix-blend-mode: lighten; pointer-events: none;"></div>
        <div class="concert-dust"></div>

        <div id="fan-zone" style="position: absolute; bottom: 12%; left: 50%; transform: translateX(-50%); z-index: 10; display: flex; flex-direction: column; align-items: center;">
            <div id="bomb-back-glow" style="position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); width: 250px; height: 250px; background: #a855f7; filter: blur(80px); opacity: 0.2; pointer-events: none;"></div>
            <div class="cs-bomb anim-sway" id="my-army-bomb" style="--glow-color: #a855f7; --wave-speed: 4s;">
                <div class="cs-sphere" style="width: 100px; height: 100px; box-shadow: 0 0 40px var(--glow-color), inset 0 0 20px var(--glow-color); background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6), transparent); border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; position: relative; z-index: 2;">
                    <span class="cs-logo" style="text-shadow: 0 0 15px var(--glow-color); color: #fff; font-size: 32px; font-weight: 900;">⟭⟬</span>
                </div>
                <div class="cs-handle" style="width: 22px; height: 80px; background: #111; border-radius: 0 0 10px 10px; margin-top: -5px; border: 1px solid #333;"></div>
            </div>
        </div>

        <div id="lightstick-controls" class="soft-controls-panel">
            <button class="panel-toggle-btn" onclick="toggleControlPanel()">HIDE CONTROLS ▽</button>
            <div class="vy-controls-row">
                <button class="soft-pill-btn active" onclick="setWavePattern('sway', this)">SWAY</button>
                <button class="soft-pill-btn" onclick="setWavePattern('drift', this)">DRIFT</button>
                <button class="soft-pill-btn" onclick="setWavePattern('ocean', this)">OCEAN</button>
                <button class="soft-pill-btn" onclick="setWavePattern('stars', this)">STARS</button>
                <button class="soft-pill-btn" onclick="setWavePattern('flutter', this)">FLUTTER</button>
                <div class="vy-controls-divider-v"></div>
                <button class="soft-pill-btn active" onclick="setWaveSpeed(4, this)">2X</button>
            </div>
            <div class="vy-controls-divider-h"></div>
            <div class="vy-controls-row secondary-row">
                <button class="soft-btn color-btn" style="--btn-color: #a855f7;" onclick="changeBombColor('#a855f7')"></button>
                <button class="soft-btn color-btn" style="--btn-color: #3b82f6;" onclick="changeBombColor('#3b82f6')"></button>
                <button class="soft-btn color-btn" style="--btn-color: #22c55e;" onclick="changeBombColor('#22c55e')"></button>
                <button class="soft-btn color-btn rainbow-btn" onclick="changeBombColor('rainbow')"></button>
                <div class="vy-controls-divider-v" style="height: 18px;"></div>
                <button class="soft-btn text-btn" onclick="triggerFanchant()" style="letter-spacing: 2px;">FANCHANT</button>
                <button class="soft-btn text-btn" onclick="toggleStrobe()">STROBE</button>
            </div>
        </div>

        <!-- ══ MAGICAL OVERLAY LAYER ══ -->

        <!-- ① LIVE BROADCAST TOP BAND — covers YouTube title & channel name -->
        <div id="vy-live-band" style="position:absolute;top:0;left:0;right:0;z-index:25;padding:10px 14px 32px;background:linear-gradient(to bottom,rgba(0,0,0,0.93) 0%,rgba(0,0,0,0.65) 55%,transparent 100%);pointer-events:none;">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
            <div style="width:7px;height:7px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 12px #ff3b3b;animation:liveBlip 1s ease-in-out infinite;flex-shrink:0;"></div>
            <span style="font-family:Orbitron;font-size:7px;color:#ff3b3b;letter-spacing:3px;font-weight:700;flex-shrink:0;">LIVE</span>
            <span style="font-family:Orbitron;font-size:7px;color:rgba(255,255,255,0.25);flex-shrink:0;">|</span>
            <span style="font-family:Orbitron;font-size:7px;color:rgba(255,255,255,0.7);letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">BTS — PERMISSION TO DANCE ON STAGE · MEXICO CITY</span>
            <span id="vy-live-time" style="margin-left:auto;font-family:Orbitron;font-size:7px;color:rgba(168,85,247,0.85);letter-spacing:2px;flex-shrink:0;">00:00</span>
          </div>
        </div>

        <!-- ② FLOATING BTS LYRICS — drifts across center covering pause button area -->
        <div id="vy-lyrics-stage" style="position:absolute;inset:0;z-index:22;pointer-events:none;overflow:hidden;"></div>

        <!-- ③ FIREWORKS CANVAS -->
        <canvas id="vy-fireworks" style="position:absolute;inset:0;z-index:21;pointer-events:none;"></canvas>

        <!-- ④ FLOATING HEARTS STAGE -->
        <div id="vy-hearts-stage" style="position:absolute;inset:0;z-index:24;pointer-events:none;overflow:hidden;"></div>

        <!-- ⑤ ARMY COUNTER — sits above YouTube logo zone -->
        <div id="vy-army-bond" style="position:absolute;bottom:115px;left:0;right:0;z-index:25;display:flex;justify-content:center;align-items:center;gap:7px;pointer-events:none;">
          <span style="font-size:11px;filter:drop-shadow(0 0 6px #a855f7);">💜</span>
          <span id="vy-army-count" style="font-family:Orbitron;font-size:7px;color:rgba(255,255,255,0.45);letter-spacing:2px;">connecting to arena…</span>
          <span style="font-size:11px;filter:drop-shadow(0 0 6px #a855f7);">💜</span>
        </div>

        <!-- ⑥ EQUALIZER WAVE — covers YouTube logo/button strip -->
        <div id="vy-bomb-wave" style="position:absolute;bottom:76px;left:0;right:0;z-index:25;display:flex;justify-content:center;align-items:flex-end;gap:3px;height:32px;pointer-events:none;overflow:hidden;padding:0 6px;"></div>

        <!-- ⑦ SEND LOVE BUTTON -->
        <button id="vy-love-btn" onclick="sendLoveBurst(event)" style="position:absolute;bottom:195px;right:14px;z-index:30;background:rgba(168,85,247,0.18);border:1px solid rgba(168,85,247,0.55);color:#fff;border-radius:50%;width:46px;height:46px;font-size:20px;cursor:pointer;backdrop-filter:blur(12px);box-shadow:0 0 22px rgba(168,85,247,0.35);transition:transform 0.15s;pointer-events:auto;" title="Send Love 💜">💜</button>

        <div id="concert-finale" class="vy-finale"><div class="vy-finale__army">ARMY</div></div>
        <button onclick="exitConcert()" style="position: absolute; top: 30px; right: 30px; z-index: 50; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-family:'Orbitron'; font-size:10px;">EXIT ARENA ✕</button>
    </div>
  `;

  document.body.appendChild(root);

  // Generate magical background stars dynamically
  const starsContainer = root.querySelector('.vy-stars-container');
  if (starsContainer) {
    let starsHtml = '';
    for (let i = 0; i < 45; i++) {
      const top = Math.random() * 100;
      const left = Math.random() * 100;
      const size = Math.random() * 2.5 + 1;
      const delay = Math.random() * 4;
      const dur = Math.random() * 3 + 2;
      starsHtml += `<div class="vy-star" style="top: ${top}%; left: ${left}%; width: ${size}px; height: ${size}px; --blink-dur: ${dur}s; animation-delay: ${delay}s;"></div>`;
    }
    starsContainer.innerHTML = starsHtml;
  }

  if (!window.YT) {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  }

  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('visible')));

  setTimeout(() => {
    const ship = document.getElementById('sailing-ship');
    const text = document.getElementById('warp-text');
    if (ship) ship.classList.add('ship-warp-drive');
    if (text) text.innerText = 'Entering Coordinates...';
  }, 1000);

  setTimeout(() => {
    const flash = document.getElementById('magic-flash');
    if (flash) flash.style.opacity = '1';
    // Start YouTube player loading under cover of full-screen flash transition
    initYouTubePlayer(CONCERT_VIDEO_ID);
  }, 3500);

  setTimeout(() => {
    const phase1 = document.getElementById('phase-1-ship');
    if (phase1) phase1.style.display = 'none';

    const phase2 = document.getElementById('phase-2-concert');
    if (phase2) {
      phase2.style.opacity = '1';
      phase2.style.pointerEvents = 'all';

      // Boot magical overlay system
      if (typeof bootConcertMagic === 'function') bootConcertMagic();
      // Welcome fireworks burst when you arrive at the concert
      setTimeout(() => {
        if (typeof launchFirework === 'function') {
          launchFirework(window.innerWidth * 0.25, window.innerHeight * 0.3);
          setTimeout(() => launchFirework(window.innerWidth * 0.75, window.innerHeight * 0.25), 300);
          setTimeout(() => launchFirework(window.innerWidth * 0.5,  window.innerHeight * 0.2),  600);
        }
      }, 800);

      // 1. Interactive Magic: Stardust Trail (Mouse + Touch)
      const handleMove = (e) => {
          if (Math.random() > 0.4) return;
          const x = e.clientX || (e.touches && e.touches[0].clientX);
          const y = e.clientY || (e.touches && e.touches[0].clientY);
          if (!x || !y) return;

          const bomb = document.getElementById('my-army-bomb');
          const color = bomb ? getComputedStyle(bomb).getPropertyValue('--glow-color').trim() : '#a855f7';
          
          const spark = document.createElement('div');
          spark.className = 'bomb-sparkle';
          spark.style.left = x + 'px';
          spark.style.top = y + 'px';
          spark.style.boxShadow = `0 0 15px ${color}, 0 0 30px ${color}`;
          phase2.appendChild(spark);
          setTimeout(() => spark.remove(), 1000);
      };
      phase2.addEventListener('mousemove', handleMove);
      phase2.addEventListener('touchmove', handleMove);

      // 2. Lore Magic: Whalien 52 (Every 35s)
      setInterval(() => {
          const arena = document.getElementById('phase-2-concert');
          if (!arena) return;
          const whale = document.createElement('div');
          whale.className = 'magic-whale';
          whale.innerText = '🐋';
          whale.style.top = (20 + Math.random() * 40) + '%';
          arena.appendChild(whale);
          setTimeout(() => whale.remove(), 28000);
      }, 35000);
    }
  }, 5000);

  window.triggerFanchant = function() {
      const names = ["KIM NAMJOON", "KIM SEOKJIN", "MIN YOONGI", "JUNG HOSEOK", "PARK JIMIN", "KIM TAEHYUNG", "JEON JUNGKOOK", "BTS!"];
      const arena = document.getElementById('phase-2-concert');
      if (!arena) return;
      if (navigator.vibrate) navigator.vibrate([40, 80, 40]);
      
      names.forEach((name, i) => {
          setTimeout(() => {
              const word = document.createElement('div');
              word.className = 'fanchant-word';
              word.innerText = name;
              arena.appendChild(word);
              setTimeout(() => word.remove(), 3500);
          }, i * 850);
      });
  };

  setTimeout(() => {
    const flash = document.getElementById('magic-flash');
    if (flash) { flash.style.transition = 'opacity 3s'; flash.style.opacity = '0'; }
  }, 8500);
};

window.toggleControlPanel = function() {
    const panel = document.getElementById('lightstick-controls');
    const btn = panel.querySelector('.panel-toggle-btn');
    if (panel.classList.contains('minimized')) {
        panel.classList.remove('minimized');
        btn.innerHTML = 'HIDE CONTROLS ▽';
    } else {
        panel.classList.add('minimized');
        btn.innerHTML = 'SHOW CONTROLS △';
    }
};

function initYouTubePlayer(videoId) {
  console.log("📺 initYouTubePlayer: Initiating load sequence for Video ID:", videoId);

  if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
      console.log("⏳ initYouTubePlayer: YouTube Iframe API not ready yet. Retrying in 500ms...");
      setTimeout(() => initYouTubePlayer(videoId), 500);
      return;
  }

  const target = document.getElementById('youtube-player');
  if (!target) {
    console.warn("⚠️ initYouTubePlayer: Target element '#youtube-player' not found in DOM!");
    return;
  }

  console.log("🚀 initYouTubePlayer: YouTube Iframe API IS READY! Creating new YT.Player instance...");

  if (progressInterval) clearInterval(progressInterval);

  concertPlayer = new YT.Player('youtube-player', {
    height: '100%',
    width: '100%',
    videoId: videoId, 
    playerVars: {
      'autoplay': 1, 'controls': 0, 'disablekb': 1, 'fs': 0, 'modestbranding': 1, 'rel': 0, 'showinfo': 0, 'playsinline': 1, 'iv_load_policy': 3
    },
    events: {
      'onReady': (event) => {
          console.log("🎉 initYouTubePlayer: YT Player successfully loaded & onReady event fired! Playing video...");
          event.target.playVideo();
          // Fallback: if PLAYING state fires slowly, reveal after 3s max
          setTimeout(() => {
            const cover = document.getElementById('yt-chrome-cover');
            if (cover && cover.style.opacity !== '0') cover.style.opacity = '0';
          }, 3000);
          // Suggest maximum quality (Best effort as YT often ignores this on modern browsers)
          if (typeof event.target.setPlaybackQuality === 'function') {
              event.target.setPlaybackQuality('highres');
          }

          // Monitor play duration to trigger Grand Finale early to preempt creator's End Screen cards (usually last 10-20 seconds)
          progressInterval = setInterval(() => {
              if (concertPlayer && typeof concertPlayer.getCurrentTime === 'function' && typeof concertPlayer.getDuration === 'function') {
                  const currentTime = concertPlayer.getCurrentTime();
                  const duration = concertPlayer.getDuration();
                  
                  // If playing for 10 seconds or more, transition back to normal widescreen
                  if (currentTime >= 10) {
                      const iframe = document.getElementById('youtube-player');
                      if (iframe && !iframe.classList.contains('vy-player-normal')) {
                          console.log("🌊 Crop sequence complete: transitioning YouTube player smoothly to full widescreen width...");
                          iframe.classList.add('vy-player-normal');
                      }
                  }

                  console.log(`[CONCERT TIME] Current: ${currentTime.toFixed(2)}s | Total: ${duration.toFixed(2)}s | Remaining: ${(duration - currentTime).toFixed(2)}s`);
                  if (duration > 0 && (duration - currentTime <= 13)) {
                      clearInterval(progressInterval);
                      if (typeof triggerGrandFinale === 'function') {
                          triggerGrandFinale();
                      }
                  }
              }
          }, 500);
      },
      'onStateChange': (event) => {
        console.log("📺 initYouTubePlayer: YT Player state changed to:", event.data);
        const cover = document.getElementById('yt-chrome-cover');
        if (event.data === YT.PlayerState.PLAYING) {
          // Video confirmed playing — reveal the concert
          if (cover) cover.style.opacity = '0';
        } else if (event.data === YT.PlayerState.PAUSED) {
          // Snap cover back immediately so YouTube UI is never visible
          if (cover) cover.style.opacity = '1';
          // Resume playback right away
          if (concertPlayer && typeof concertPlayer.playVideo === 'function') {
            concertPlayer.playVideo();
          }
        } else if (event.data === YT.PlayerState.BUFFERING) {
          // Keep cover while buffering so spinner doesn't show
          if (cover) cover.style.opacity = '1';
        } else if (event.data === YT.PlayerState.ENDED) {
          if (typeof triggerGrandFinale === 'function') triggerGrandFinale();
        }
      }
    }
  });
}

let rainbowInterval = null;

// ══════════════════════════════════════════════
//  MAGICAL CONCERT OVERLAY SYSTEM
// ══════════════════════════════════════════════

const BTS_LYRICS = [
  "I'm the one I should love in this world 💜",
  "Life goes on — like an arrow in the blue sky",
  "We are bulletproof — the eternal",
  "Boy With Luv — oh my my my",
  "We don't need permission to dance ✨",
  "Mikrokosmos — you shine in this universe",
  "Spring Day — I miss you",
  "Euphoria — you are my hope, my angel",
  "Black Swan — art of survival",
  "ON — thunder, let it rain on us",
  "Butter — smooth like summer",
  "Dynamite — shining through the city",
  "ARMY — we are one 💜",
  "Dream Glow — with every heartbeat",
  "Moon — you're beautiful tonight",
  "Your galaxy — I live in it",
  "Magic Shop — a door in your heart",
  "Find your map of the soul 💜",
];

// ① FLOATING LYRICS
window.startLyricsLoop = function() {
  function spawnLyric() {
    const stage = document.getElementById('vy-lyrics-stage');
    if (!stage) return;
    const lyric = BTS_LYRICS[Math.floor(Math.random() * BTS_LYRICS.length)];
    const el = document.createElement('div');
    const topPct = 18 + Math.random() * 58;
    const dur = 11 + Math.random() * 7;
    const size = 7 + Math.random() * 4;
    const alpha = 0.13 + Math.random() * 0.18;
    el.style.cssText = `
      position:absolute;
      left:-120%;
      top:${topPct}%;
      font-family:Orbitron,sans-serif;
      font-size:${size}px;
      color:rgba(255,255,255,${alpha});
      letter-spacing:2px;
      white-space:nowrap;
      text-transform:uppercase;
      text-shadow:0 0 12px rgba(168,85,247,0.6);
      animation:lyricDrift ${dur}s linear forwards;
    `;
    el.textContent = lyric;
    stage.appendChild(el);
    setTimeout(() => el.remove(), (dur + 0.5) * 1000);
  }
  spawnLyric();
  setInterval(spawnLyric, 5000 + Math.random() * 3000);
};

// ② SEND LOVE BURST
window.sendLoveBurst = function(e) {
  const stage = document.getElementById('vy-hearts-stage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const cx = e?.clientX ?? rect.width * 0.85;
  const cy = e?.clientY ?? rect.height * 0.6;
  const icons = ['💜','💜','💜','✨','⭐','💜','🌟','💜'];
  for (let i = 0; i < 9; i++) {
    const h = document.createElement('div');
    const angle = (Math.PI * 2 * i) / 9 - Math.PI / 2;
    const dist = 50 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30;
    const dur = 0.7 + Math.random() * 0.5;
    h.style.cssText = `
      position:absolute;
      left:${cx - rect.left}px;
      top:${cy - rect.top}px;
      font-size:${14 + Math.random() * 12}px;
      transform:translate(-50%,-50%);
      transition:all ${dur}s cubic-bezier(0.25,0.46,0.45,0.94);
      pointer-events:none;
    `;
    h.textContent = icons[Math.floor(Math.random() * icons.length)];
    stage.appendChild(h);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      h.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.3)`;
      h.style.opacity = '0';
    }));
    setTimeout(() => h.remove(), (dur + 0.1) * 1000);
  }
};

// ③ ARMY COUNTER (feels live)
window.startArmyCounter = function() {
  const el = document.getElementById('vy-army-count');
  if (!el) return;
  let count = 11800 + Math.floor(Math.random() * 3200);
  function tick() {
    count += Math.floor(Math.random() * 7) - 3;
    if (count < 11000) count = 11000;
    el.textContent = count.toLocaleString() + ' ARMY IN THIS ARENA';
    setTimeout(tick, 2500 + Math.random() * 2000);
  }
  tick();
};

// ④ EQUALIZER WAVE (covers YouTube logo strip)
window.buildBombWave = function() {
  const wave = document.getElementById('vy-bomb-wave');
  if (!wave) return;
  const palette = ['#a855f7','#3b82f6','#a855f7','#e879f9','#a855f7','#7c3aed','#a855f7','#6366f1'];
  let html = '';
  for (let i = 0; i < 36; i++) {
    const color = palette[i % palette.length];
    const delay = (i * 0.09).toFixed(2);
    const h = 10 + Math.random() * 18;
    html += `<div style="width:5px;min-height:${h}px;background:${color};border-radius:3px 3px 0 0;opacity:0.55;box-shadow:0 0 6px ${color};animation:waveBarAnim ${0.9 + Math.random() * 0.7}s ease-in-out ${delay}s infinite alternate;flex-shrink:0;"></div>`;
  }
  wave.innerHTML = html;
};

// ⑤ LIVE TIMER
window.startLiveTimer = function() {
  let s = 0;
  const el = document.getElementById('vy-live-time');
  setInterval(() => {
    s++;
    const mm = String(Math.floor(s / 60)).padStart(2,'0');
    const ss = String(s % 60).padStart(2,'0');
    if (el) el.textContent = mm + ':' + ss;
  }, 1000);
};

// ⑥ FIREWORKS ENGINE
let _fwCanvas, _fwCtx;
function _ensureFireworkCanvas() {
  _fwCanvas = document.getElementById('vy-fireworks');
  if (!_fwCanvas) return false;
  _fwCanvas.width  = window.innerWidth;
  _fwCanvas.height = window.innerHeight;
  _fwCtx = _fwCanvas.getContext('2d');
  return true;
}

window.launchFirework = function(x, y) {
  if (!_ensureFireworkCanvas()) return;
  const ctx = _fwCtx;
  const colors = ['#a855f7','#ffffff','#e879f9','#f59e0b','#3b82f6','#ec4899','#22c55e'];
  const parts = [];
  for (let i = 0; i < 38; i++) {
    const a = (Math.PI * 2 * i) / 38;
    const spd = 2.5 + Math.random() * 4;
    parts.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      alpha: 1, color: colors[Math.floor(Math.random() * colors.length)],
      r: 1.5 + Math.random() * 2.5
    });
  }
  function draw() {
    ctx.clearRect(0, 0, _fwCanvas.width, _fwCanvas.height);
    let alive = false;
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.07; p.alpha -= 0.022;
      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
    if (alive) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, _fwCanvas.width, _fwCanvas.height);
  }
  draw();
};

window.startRandomFireworks = function() {
  function fire() {
    const x = window.innerWidth  * (0.15 + Math.random() * 0.7);
    const y = window.innerHeight * (0.08 + Math.random() * 0.45);
    launchFirework(x, y);
    setTimeout(fire, 9000 + Math.random() * 14000);
  }
  setTimeout(fire, 4000);
};

// ── BOOT ALL MAGIC ON CONCERT REVEAL ──
window.bootConcertMagic = function() {
  startLyricsLoop();
  startArmyCounter();
  buildBombWave();
  startLiveTimer();
  startRandomFireworks();
};

// 1. Smooth Color Transition (Now with Rainbow Mode!)
window.changeBombColor = function(color) {
    const bomb = document.getElementById('my-army-bomb');
    const ambient = document.getElementById('ambient-glow');
    const backGlow = document.getElementById('bomb-back-glow');
    const crowd = document.querySelector('.virtual-crowd');
    
    // Stop the strobe or existing rainbow if running
    if (strobeInterval) { clearInterval(strobeInterval); strobeInterval = null; if (bomb) bomb.style.opacity = '1'; }
    if (rainbowInterval) { clearInterval(rainbowInterval); rainbowInterval = null; }

    const applyColor = (c) => {
        if (bomb) bomb.style.setProperty('--glow-color', c);
        if (ambient) ambient.style.backgroundColor = c;
        if (backGlow) backGlow.style.backgroundColor = c;
        if (crowd) crowd.style.setProperty('--ambient-color', c);
    };

    if (color === 'rainbow') {
        const colors = ['#a855f7','#e879f9','#6366f1','#22c55e','#fbbf24','#ef4444','#3b82f6'];
        let idx = 0;
        rainbowInterval = setInterval(() => {
            applyColor(colors[idx]);
            idx = (idx + 1) % colors.length;
        }, 1000); // 1-second smooth fade between colors
    } else {
        applyColor(color);
    }
    
    // Satisfying bump animation
    if (bomb) {
        bomb.style.transform = 'scale(1.1)';
        setTimeout(() => { bomb.style.transform = 'scale(1)'; }, 150);
        if (navigator.vibrate) navigator.vibrate(15);
    }
    
    // Auto-unmute the video on the first interaction
    if (concertPlayer && typeof concertPlayer.unMute === 'function') {
        concertPlayer.unMute();
        concertPlayer.setVolume(100);
    }
};

window.setWavePattern = function(pattern, btn) {
    const bomb = document.getElementById('my-army-bomb');
    if (bomb) {
        bomb.classList.remove('anim-sway', 'anim-drift', 'anim-ocean', 'anim-stars', 'anim-flutter');
        bomb.classList.add('anim-' + pattern);
    }
    
    // UI Toggle
    document.querySelectorAll('.soft-pill-btn').forEach(b => {
        if (['〰️ SWAY', '🪐 DRIFT', '🌊 OCEAN', '✨ STARS', '🦋 FLUTTER'].includes(b.innerText)) {
            b.classList.remove('active');
        }
    });
    if (btn) btn.classList.add('active');
    if (navigator.vibrate) navigator.vibrate(10);
};

window.setWaveSpeed = function(seconds, btn) {
    const bomb = document.getElementById('my-army-bomb');
    if (bomb) {
        bomb.style.setProperty('--wave-speed', seconds + 's');
    }
    
    // UI Toggle
    document.querySelectorAll('.soft-pill-btn').forEach(b => {
        if (['1X', '2X', '3X'].includes(b.innerText)) b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    if (navigator.vibrate) navigator.vibrate(10);
};

// 2. The Strobe Effect
window.toggleStrobe = function() {
    const bomb = document.getElementById('my-army-bomb');
    if (!bomb) return;
    if (navigator.vibrate) navigator.vibrate(30);
    
    // Auto-unmute the video on the first interaction
    if (concertPlayer && typeof concertPlayer.unMute === 'function') {
        concertPlayer.unMute();
        concertPlayer.setVolume(100);
    }
    
    if (strobeInterval) {
        // Turn Strobe OFF
        clearInterval(strobeInterval);
        strobeInterval = null;
        bomb.style.opacity = '1';
    } else {
        // Turn Strobe ON
        strobeInterval = setInterval(() => {
            bomb.style.opacity = bomb.style.opacity === '1' ? '0.1' : '1';
        }, 100); // 100ms creates a fast, rave-like flash
    }
};

window.exitConcert = function() {
  const arena = document.getElementById('voyage-overlay');
  if (strobeInterval) clearInterval(strobeInterval);
  if (rainbowInterval) clearInterval(rainbowInterval);
  if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
  }
  if (concertPlayer && typeof concertPlayer.destroy === 'function') {
      concertPlayer.destroy();
  }
  if (arena) {
      arena.style.opacity = '0';
      setTimeout(() => arena.remove(), 1000);
  }
  
  // Stop the high-intensity waving animation of the main page lightstick
  const mainVessel = document.querySelector('.army-bomb-vessel');
  if (mainVessel) {
    mainVessel.classList.remove('army-bomb-launch-wave');
  }
};

window.triggerGrandFinale = function() {
  const wrapper = document.getElementById('video-wrapper');
  if (wrapper) wrapper.style.opacity = '0';
  const finale = document.getElementById('concert-finale');
  if (finale) finale.classList.add('vy-finale--on');
  launchFireworksFallback();
  setTimeout(window.exitConcert, 8000);
};

function launchFireworksFallback() {
  if (!window.confetti) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
    script.onload = () => { doFireworksBurst(); };
    document.head.appendChild(script);
  } else {
    doFireworksBurst();
  }
}

function doFireworksBurst() {
  const duration = 5 * 1000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 40, spread: 360, ticks: 60, zIndex: 10000 };

  const randomInRange = (min, max) => Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return clearInterval(interval);

    const particleCount = 50 * (timeLeft / duration);
    // Multiple explosive bursts
    window.confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }, colors: ['#a855f7', '#ffffff'] });
    window.confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }, colors: ['#ff00ff', '#ffffff'] });
    window.confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.4, 0.6), y: Math.random() - 0.2 }, colors: ['#3b82f6', '#ffffff'] });
  }, 250);
}
