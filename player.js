const audio = document.getElementById('audio');
const playBtn = document.getElementById('playBtn');
const icon = document.getElementById('playIcon');
const bar = document.getElementById('bar');
const player = document.querySelector('.player');
const stage = document.querySelector('.stage');
const lyricBox = document.getElementById('lyrics');
const lyricJp = document.getElementById('lyricJp');
const lyricRomaji = document.getElementById('lyricRomaji');
const lwPlay = document.getElementById('lwPlay');
const lwIcon = document.getElementById('lwPlayIcon');

const PLAY = 'M5 3v18l16-9z';
const PAUSE = 'M6 3h4v18H6zM14 3h4v18h-4z';

// Simulated audio playback in case di nag load music.
const FALLBACK_LENGTH = 212; // seconds
let simulated = false, simTime = 0, simTimer = null, playing = false;

const duration = () => simulated ? FALLBACK_LENGTH : (audio.duration || 0);
const current = () => simulated ? simTime : audio.currentTime;

function render() {
    const d = duration();
    const pct = d ? Math.min(100, (current() / d) * 100) : 0;
    bar.style.setProperty('--p', pct + '%');
    bar.setAttribute('aria-valuenow', Math.round(pct));
    updateLyrics(current());
}

// ---- lyrics sync: show the last line whose time has passed ----
let lyricIndex = -2;
function findLyric(t) {
    if (typeof lyrics === 'undefined') return -1;
    let lo = 0, hi = lyrics.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lyrics[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
}
function updateLyrics(t) {
    const i = findLyric(t);
    if (i === lyricIndex) return;
    lyricIndex = i;
    setActiveRow(i);
    lyricJp.textContent = i >= 0 ? lyrics[i].text : '';
    lyricRomaji.textContent = i >= 0 ? lyrics[i].romaji : '';
    lyricBox.classList.remove('swap');
    void lyricBox.offsetWidth;            // restart the fade-in
    if (i >= 0) { lyricBox.classList.add('swap'); if (typeof hintFirstLyric === 'function') hintFirstLyric(); }
}

// smooth ticking while playing (timeupdate alone is only ~4x/sec)
let raf = 0;
function tick() {
    if (!playing) { raf = 0; return; }
    render();
    raf = requestAnimationFrame(tick);
}

function setPlaying(on) {
    playing = on;
    player.classList.toggle('playing', on);
    stage.classList.toggle('playing', on);
    if (on && !raf) raf = requestAnimationFrame(tick);
    icon.setAttribute('d', on ? PAUSE : PLAY);
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    startViz();
    lwIcon.setAttribute('d', on ? PAUSE : PLAY);
    lwPlay.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function startSim() {
    clearInterval(simTimer);
    simTimer = setInterval(() => {
        simTime += 0.25;
        if (simTime >= FALLBACK_LENGTH) { resetPlayer(); return; }
        render();
    }, 250);
}
function stopSim() { clearInterval(simTimer); }

// Song finished: put everything back at the start so it can be played again
function resetPlayer() {
    stopSim();
    simTime = 0;
    if (!simulated) { audio.pause(); audio.currentTime = 0; }
    setPlaying(false);
    lyricIndex = -2;                      // force lyrics to clear
    player.style.animation = 'none';      // restart the color flow from the beginning
    void player.offsetWidth;
    player.style.animation = '';
    render();
}

function toggle() {
    if (playing) {
        simulated ? stopSim() : audio.pause();
        setPlaying(false);
        return;
    }
    if (simulated) { startSim(); setPlaying(true); return; }
    initAnalyser();
    audio.play().then(() => setPlaying(true)).catch(() => {
        simulated = true; startSim(); setPlaying(true);
    });
}

function seekTo(pct) {
    pct = Math.max(0, Math.min(1, pct));
    const d = duration();
    if (!d) return;
    if (simulated) simTime = pct * d; else audio.currentTime = pct * d;
    render();
}
const pctFromEvent = e => {
    const r = bar.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
};

playBtn.addEventListener('click', toggle);
lwPlay.addEventListener('click', toggle);

audio.addEventListener('timeupdate', render);
audio.addEventListener('loadedmetadata', render);
audio.addEventListener('ended', resetPlayer);
audio.addEventListener('error', () => { simulated = true; render(); });

// click + drag on the progress bar
let dragging = false;
bar.addEventListener('pointerdown', e => {
    dragging = true;
    bar.classList.add('drag');
    bar.setPointerCapture(e.pointerId);
    seekTo(pctFromEvent(e));
});
bar.addEventListener('pointermove', e => { if (dragging) seekTo(pctFromEvent(e)); });
const endDrag = () => { dragging = false; bar.classList.remove('drag'); };
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', endDrag);

// keyboard: arrows seek 5s
bar.addEventListener('keydown', e => {
    const d = duration();
    if (!d) return;
    if (e.key === 'ArrowRight') seekTo((current() + 5) / d);
    if (e.key === 'ArrowLeft') seekTo((current() - 5) / d);
});

// ---------- Audio-reactive bars ----------
const viz = document.getElementById('viz');
const vctx = viz.getContext('2d');
const BARS = 48, GAP = 4;
const levels = new Array(BARS).fill(0);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let actx = null, analyser = null, freq = null, vizReal = false, rafViz = 0, lastViz = 0, vizGrad = null;

function sizeViz() {
    viz.width = viz.clientWidth;          // 1:1 pixels, bars are large so no need for hi-dpi
    viz.height = viz.clientHeight;
    vizGrad = vctx.createLinearGradient(0, viz.height, 0, 0);
    vizGrad.addColorStop(0, 'rgba(255,255,255,.95)');
    vizGrad.addColorStop(1, 'rgba(255,111,181,.15)');
}
new ResizeObserver(sizeViz).observe(viz);
sizeViz();

// if it were routed through Web Audio, so there the bars use a simulated motion instead.
function initAnalyser() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    if (location.protocol === 'file:') return;
    try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        src.connect(analyser);
        analyser.connect(actx.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        vizReal = true;
    } catch (err) { vizReal = false; }
}

function startViz() {
    if (reduceMotion || rafViz) return;
    rafViz = requestAnimationFrame(vizTick);
}

function vizTick(now) {
    if (now - lastViz < 33) { rafViz = requestAnimationFrame(vizTick); return; }   // ~30 fps cap
    lastViz = now;

    const useReal = vizReal && playing;
    if (useReal) analyser.getByteFrequencyData(freq);
    const t = current(), step = 64 / BARS;

    for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (playing) {
            target = useReal
                ? Math.min(1, (freq[Math.floor(i * step)] / 255) * (1 + i / BARS * 0.8))
                : (0.3 + 0.55 * Math.abs(Math.sin(t * (1.7 + i * 0.31) + i * 1.3))) * (1 - i / BARS * 0.45);
        }
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.55 : 0.15);
    }

    const W = viz.width, H = viz.height, bw = (W - GAP * (BARS - 1)) / BARS;
    vctx.clearRect(0, 0, W, H);
    vctx.fillStyle = vizGrad;
    for (let i = 0; i < BARS; i++) {
        const h = Math.pow(levels[i], 1.2) * H;
        vctx.fillRect(i * (bw + GAP), H - h, bw, h);
    }

    // keep going while playing or while the bars are still falling
    rafViz = (playing || levels.some(v => v > 0.01)) ? requestAnimationFrame(vizTick) : 0;
    if (!rafViz) vctx.clearRect(0, 0, W, H);
}

// ---------- Lyrics window ----------
const lwOverlay = document.getElementById('lwOverlay');
const lwOpen = document.getElementById('lwOpen');
const lwCols = document.getElementById('lwCols');
let lyricRows = [];

// ragged "torn paper" edges
function torn(el, amp, seed) {
    let r = seed;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const n = 28, m = 12, pts = [];
    for (let i = 0; i <= n; i++) pts.push([i / n * 100, rnd() * amp]);
    for (let j = 1; j <= m; j++) pts.push([100 - rnd() * amp, j / m * 100]);
    for (let i = n - 1; i >= 0; i--) pts.push([i / n * 100, 100 - rnd() * amp]);
    for (let j = m - 1; j > 0; j--) pts.push([rnd() * amp, j / m * 100]);
    el.style.clipPath = 'polygon(' + pts.map(p => p[0].toFixed(1) + '% ' + p[1].toFixed(1) + '%').join(',') + ')';
}
torn(document.getElementById('lwFrame'), 2.2, 7);
torn(document.getElementById('lwHead'), 4, 21);
torn(document.getElementById('lwPanel'), 1.2, 33);

const fmt = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');

// jump to a line and start playing
function playFrom(t) {
    if (simulated) simTime = t; else audio.currentTime = t;
    lyricIndex = -2;
    render();
    if (!playing) toggle();
}

if (typeof lyrics === 'undefined') {
    lwCols.innerHTML = '<p class="lw-empty">lyrics.js was not found next to this page.</p>';
} else {
    const esc = str => str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // keywords get their own text tag
    const KEYWORD = { 'アイドル': 'u', '嘘': 'b', '愛': 'mark', '完璧': 'em', '一番星': 'strong' };
    const decorate = str => esc(str).replace(/アイドル|嘘|愛|完璧|一番星/g, m => '<' + KEYWORD[m] + '>' + m + '</' + KEYWORD[m] + '>');
    function lineHTML(text) {
        if (/^[(（]/.test(text)) return '<small>' + esc(text) + '</small>';      // backing vocals
        if (text.startsWith('[')) return '<em>' + esc(text) + '</em>';           // [Instrumental] etc.
        if (text.startsWith('「')) return '<blockquote>' + decorate(text) + '</blockquote>';  // spoken line
        return decorate(text);
    }

    // image + horizontal rule at the top
    const fig = document.createElement('figure');
    fig.className = 'lw-fig';
    fig.innerHTML = '<img src="img/Illustration.jpg" alt="Illustration for the song アイドル"><figcaption><em>アイドル</em> by <strong>YOASOBI</strong></figcaption>';
    lwCols.appendChild(fig);
    const topHr = document.createElement('hr');
    topHr.className = 'lw-sec-hr full';
    lwCols.appendChild(topHr);

    // section labels - each one gets a heading and an hr
    const sections = [
        { t: 0, label: 'Verse 1' },
        { t: 17.26, label: 'Verse 2' },
        { t: 46.16, label: 'Pre-Chorus' },
        { t: 57.70, label: 'Chorus' },
        { t: 78.51, label: 'Rap' },
        { t: 125.18, label: 'Verse 3' },
        { t: 151.33, label: 'Bridge' },
        { t: 164.79, label: 'Final Chorus' },
        { t: 195.66, label: 'Outro' }
    ];
    let sec = null, si = -1;

    lyrics.forEach(l => {
        while (si + 1 < sections.length && l.time >= sections[si + 1].t) {
            si++;
            sec = document.createElement('section');
            sec.className = 'lw-sec';
            sec.innerHTML = '<h3><strong>' + sections[si].label + '</strong></h3><hr class="lw-sec-hr">';
            lwCols.appendChild(sec);
        }
        const row = document.createElement('div');
        row.className = 'lw-row';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');

        const t = document.createElement('time');
        t.className = 't';
        t.setAttribute('datetime', 'PT' + Math.floor(l.time) + 'S');
        t.textContent = '[' + fmt(l.time) + ']';

        const box = document.createElement('div');
        const jp = document.createElement('div'); jp.className = 'jp'; jp.innerHTML = lineHTML(l.text);
        const ro = document.createElement('div'); ro.className = 'ro';
        if (l.romaji) ro.innerHTML = '<i>' + esc(l.romaji) + '</i>';
        box.append(jp, ro); row.append(t, box);

        row.addEventListener('click', () => playFrom(l.time));
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playFrom(l.time); } });
        (sec || lwCols).appendChild(row);
        lyricRows.push(row);
    });
}

let activeRow = null;
function setActiveRow(i) {
    if (activeRow) activeRow.classList.remove('active');
    activeRow = i >= 0 ? lyricRows[i] || null : null;
    if (activeRow) {
        activeRow.classList.add('active');
        if (!lwOverlay.hidden) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function openLyrics() {
    lwOverlay.hidden = false;
    lwOpen.setAttribute('aria-expanded', 'true');
    if (activeRow) activeRow.scrollIntoView({ block: 'center' });
    document.getElementById('lwClose').focus();
}
function closeLyrics() {
    lwOverlay.hidden = true;
    lwOpen.setAttribute('aria-expanded', 'false');
    lwOpen.focus();
}
lwOpen.addEventListener('click', openLyrics);
document.getElementById('lwClose').addEventListener('click', closeLyrics);
document.getElementById('lwMin').addEventListener('click', closeLyrics);
document.getElementById('lwMax').addEventListener('click', () => document.getElementById('lw').classList.toggle('max'));
lwOverlay.addEventListener('click', e => { if (e.target === lwOverlay) closeLyrics(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lwOverlay.hidden) closeLyrics(); });

// ---------- Drag the on-screen lyrics up/down ----------
const resetBtn = document.getElementById('lyricReset');
let lyricDrag = false, moved = false, dragY0 = 0, top0 = 0, resetTimer = 0;
const RESET_VISIBLE_MS = 4000;

function hideReset() {
    clearTimeout(resetTimer);
    resetBtn.classList.remove('show');
}
// put a small element just above the lyrics (or just below when they are in the top half)
function placeNearLyrics(el) {
    const r = lyricBox.getBoundingClientRect();
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    el.style.top = (window.scrollY + (below ? r.bottom + 12 : r.top - 12 - el.offsetHeight)) + 'px';
}

// tip: "Drag up / down to move"
const tip = document.getElementById('lyricTip');
let tipTimer = 0, tipShownOnce = false;
function hideTip() { clearTimeout(tipTimer); tip.classList.remove('show'); }
function showTip(ms) {
    if (lyricDrag || resetBtn.classList.contains('show')) return;
    placeNearLyrics(tip);
    tip.classList.add('show');
    clearTimeout(tipTimer);
    if (ms) tipTimer = setTimeout(hideTip, ms);
}
// called by updateLyrics: show the hint once, the first time a line appears
function hintFirstLyric() {
    if (tipShownOnce) return;
    tipShownOnce = true;
    requestAnimationFrame(() => showTip(3500));
}
lyricBox.addEventListener('pointerenter', () => showTip(0));
lyricBox.addEventListener('pointerleave', hideTip);

function showReset() {
    hideTip();
    placeNearLyrics(resetBtn);
    resetBtn.classList.add('show');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(hideReset, RESET_VISIBLE_MS);
}

lyricBox.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const r = lyricBox.getBoundingClientRect();
    top0 = r.top + window.scrollY;
    dragY0 = e.clientY;
    moved = false;
    lyricDrag = true;
    hideTip();
    lyricBox.setPointerCapture(e.pointerId);
    lyricBox.classList.add('dragging');
    hideReset();
});
lyricBox.addEventListener('pointermove', e => {
    if (!lyricDrag) return;
    const dy = e.clientY - dragY0;
    if (!moved && Math.abs(dy) < 4) return;
    moved = true;
    const min = window.scrollY, max = window.scrollY + window.innerHeight - lyricBox.offsetHeight;
    lyricBox.style.bottom = 'auto';
    lyricBox.style.top = Math.max(min, Math.min(max, top0 + dy)) + 'px';
});
function endLyricDrag() {
    if (!lyricDrag) return;
    lyricDrag = false;
    lyricBox.classList.remove('dragging');
    if (moved) showReset();
}
lyricBox.addEventListener('pointerup', endLyricDrag);
lyricBox.addEventListener('pointercancel', endLyricDrag);

// keep the button while the pointer is on it, then give it a moment more
resetBtn.addEventListener('mouseenter', () => clearTimeout(resetTimer));
resetBtn.addEventListener('mouseleave', () => { if (resetBtn.classList.contains('show')) resetTimer = setTimeout(hideReset, 1500); });
resetBtn.addEventListener('click', () => {
    lyricBox.style.top = '';              // back to the CSS default (bottom of the screen)
    lyricBox.style.bottom = '';
    hideReset();
});
window.addEventListener('resize', () => {
    hideReset();
    if (lyricBox.style.top) {
        const max = window.scrollY + window.innerHeight - lyricBox.offsetHeight;
        lyricBox.style.top = Math.max(window.scrollY, Math.min(max, parseFloat(lyricBox.style.top))) + 'px';
    }
});

// ---------- Drag the audio player ----------
const playerResetBtn = document.getElementById('playerReset');
let pDrag = false, pMoved = false, pX0 = 0, pY0 = 0, pLeft0 = 0, pTop0 = 0, pResetTimer = 0;

function hidePlayerReset() {
    clearTimeout(pResetTimer);
    playerResetBtn.classList.remove('show');
}
function showPlayerReset() {
    // above the player, or below it if there isn't room
    const above = player.offsetTop - 12 - playerResetBtn.offsetHeight;
    playerResetBtn.style.left = (player.offsetLeft + player.offsetWidth / 2) + 'px';
    playerResetBtn.style.top = (above >= 0 ? above : player.offsetTop + player.offsetHeight + 12) + 'px';
    playerResetBtn.classList.add('show');
    clearTimeout(pResetTimer);
    pResetTimer = setTimeout(hidePlayerReset, 4000);
}

player.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.play, .bar')) return;       // keep the controls working
    pDrag = true; pMoved = false;
    pX0 = e.clientX; pY0 = e.clientY;
    pLeft0 = player.offsetLeft; pTop0 = player.offsetTop;   // layout position, unaffected by rotate
    player.setPointerCapture(e.pointerId);
    player.classList.add('dragging');
    hidePlayerReset();
});
player.addEventListener('pointermove', e => {
    if (!pDrag) return;
    const dx = e.clientX - pX0, dy = e.clientY - pY0;
    if (!pMoved && Math.hypot(dx, dy) < 4) return;
    pMoved = true;
    const maxL = document.documentElement.clientWidth - player.offsetWidth;
    const maxT = window.scrollY + window.innerHeight - player.offsetHeight;
    player.style.right = 'auto';
    player.style.bottom = 'auto';
    player.style.left = Math.max(0, Math.min(maxL, pLeft0 + dx)) + 'px';
    player.style.top = Math.max(0, Math.min(maxT, pTop0 + dy)) + 'px';
});
function endPlayerDrag() {
    if (!pDrag) return;
    pDrag = false;
    player.classList.remove('dragging');
    if (pMoved) showPlayerReset();
}
player.addEventListener('pointerup', endPlayerDrag);
player.addEventListener('pointercancel', endPlayerDrag);

playerResetBtn.addEventListener('mouseenter', () => clearTimeout(pResetTimer));
playerResetBtn.addEventListener('mouseleave', () => { if (playerResetBtn.classList.contains('show')) pResetTimer = setTimeout(hidePlayerReset, 1500); });
playerResetBtn.addEventListener('click', () => {
    player.style.left = player.style.top = player.style.right = player.style.bottom = '';   // back to CSS default
    hidePlayerReset();
});
window.addEventListener('resize', () => {
    hidePlayerReset();
    if (player.style.left) {
        const maxL = document.documentElement.clientWidth - player.offsetWidth;
        const maxT = window.scrollY + window.innerHeight - player.offsetHeight;
        player.style.left = Math.max(0, Math.min(maxL, parseFloat(player.style.left))) + 'px';
        player.style.top = Math.max(0, Math.min(maxT, parseFloat(player.style.top))) + 'px';
    }
});

render();
