(function () {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);
  const POINTS = [20, 15, 10, 5, 0];

  let state = null;
  let offset = 0; // server time minus client time
  let lastKey = '';
  let lastOpened = 0;

  // ---------- storage (wrapped: it can throw in private modes) ----------
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('wordx') || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('wordx', JSON.stringify(v)); } catch (e) {} },
    clear() { try { localStorage.removeItem('wordx'); } catch (e) {} },
    getName() { try { return localStorage.getItem('wordx_name') || ''; } catch (e) { return ''; } },
    setName(n) { try { localStorage.setItem('wordx_name', n); } catch (e) {} }
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function show(id) {
    ['home', 'lobby', 'game', 'final'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function nowServer() { return Date.now() + offset; }
  function me() { return state.players.find((p) => p.id === state.you); }
  function isHost() { return state && state.hostId === state.you; }
  function roomLink() { return location.origin + '/?room=' + state.code; }

  // ---------- home ----------
  $('nameInput').value = store.getName();
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase().slice(0, 4);

  function getName() {
    const n = $('nameInput').value.trim();
    if (!n) {
      $('homeError').textContent = 'Please enter your name first.';
      $('nameInput').focus();
      return null;
    }
    store.setName(n);
    return n;
  }

  function handleEntry(res) {
    if (!res.ok) {
      $('homeError').textContent = res.error || 'Something went wrong.';
      return;
    }
    $('homeError').textContent = '';
    store.set({ code: res.code, pid: res.pid });
    history.replaceState(null, '', '/');
  }

  $('createBtn').addEventListener('click', () => {
    const name = getName();
    if (!name) return;
    socket.emit('create', { name }, handleEntry);
  });

  $('joinBtn').addEventListener('click', () => {
    const name = getName();
    if (!name) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) {
      $('homeError').textContent = 'Enter the 4-letter room code.';
      return;
    }
    socket.emit('join', { name, code }, handleEntry);
  });

  $('codeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  // ---------- lobby ----------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    return Promise.resolve(false);
  }

  $('copyBtn').addEventListener('click', async () => {
    const ok = await copyText(roomLink());
    toast(ok ? 'Link copied!' : 'Room code: ' + state.code);
  });

  $('shareBtn').addEventListener('click', async () => {
    const text = 'Join my WordX game! Room code: ' + state.code;
    if (navigator.share) {
      try { await navigator.share({ title: 'WordX', text, url: roomLink() }); } catch (e) {}
    } else {
      const ok = await copyText(text + ' ' + roomLink());
      toast(ok ? 'Invite copied!' : 'Room code: ' + state.code);
    }
  });

  $('roundsMinus').addEventListener('click', () => socket.emit('settings', { rounds: state.rounds - 1 }));
  $('roundsPlus').addEventListener('click', () => socket.emit('settings', { rounds: state.rounds + 1 }));
  $('startBtn').addEventListener('click', () => socket.emit('start'));

  function leave() {
    socket.emit('leave');
    store.clear();
    state = null;
    show('home');
  }
  $('leaveLobby').addEventListener('click', leave);
  $('leaveFinal').addEventListener('click', leave);

  function renderLobby() {
    $('roomCode').textContent = state.code;
    $('playerCount').textContent = '(' + state.players.length + '/' + state.maxPlayers + ')';
    $('lobbyPlayers').innerHTML = state.players
      .map((p) =>
        '<li class="' + (p.id === state.you ? 'me ' : '') + (p.connected ? '' : 'off') + '">' +
        '<span class="name">' + esc(p.name) + (p.id === state.you ? ' (you)' : '') + '</span>' +
        (p.isHost ? '<span class="tag">HOST</span>' : '') +
        '</li>'
      )
      .join('');
    const host = isHost();
    $('roundsValue').textContent = state.rounds;
    $('roundsMinus').disabled = !host || state.rounds <= 1;
    $('roundsPlus').disabled = !host || state.rounds >= 15;
    $('roundsNote').textContent = host ? 'Between 1 and 15 rounds.' : 'The host picks the number of rounds.';
    $('startBtn').classList.toggle('hidden', !host);
    $('waitNote').classList.toggle('hidden', host);
  }

  // ---------- game ----------
  function renderGame() {
    const m = state.me;
    const inRound = state.phase === 'round';
    const self = me();

    $('roundLabel').textContent = state.roundNum + '/' + state.rounds;
    $('myScore').textContent = self ? self.score : 0;

    // clues
    const key = state.code + ':' + state.roundNum;
    if (key !== lastKey) {
      lastKey = key;
      lastOpened = state.clues.length;
    }
    let html = '';
    for (let i = 0; i < state.cluesTotal; i++) {
      if (i < state.clues.length) {
        const pop = inRound && i >= lastOpened ? ' pop' : '';
        html += '<div class="clue open' + pop + '"><span class="n">' + (i + 1) + '</span><span>' + esc(state.clues[i]) + '</span></div>';
      } else {
        html += '<div class="clue locked"><span class="n">' + (i + 1) + '</span><span>\u{1F512} Hidden category</span></div>';
      }
    }
    $('clues').innerHTML = html;
    lastOpened = state.clues.length;

    // points
    const pill = $('pointsPill');
    if (m.done) {
      pill.textContent = m.solved ? '+' + m.points + ' pts' : '0 pts';
      pill.classList.toggle('zero', !m.solved || m.points === 0);
    } else {
      const pts = POINTS[m.opened - 1];
      pill.textContent = pts + ' pts';
      pill.classList.toggle('zero', pts === 0);
    }

    // word pattern
    $('pattern').textContent = state.word
      ? state.word.toUpperCase().split('').join(' ')
      : state.pattern.split(' ').map((w) => w.split('').join(' ')).join('   ');

    // form
    const canGuess = inRound && !m.done;
    $('guessInput').disabled = !canGuess;
    $('guessBtn').disabled = !canGuess;
    $('wrongList').innerHTML = m.wrong.map((w) => '<span>' + esc(w) + '</span>').join('');

    const banner = $('doneBanner');
    if (m.done && inRound) {
      banner.classList.remove('hidden');
      banner.className = 'banner ' + (m.solved ? 'good' : 'bad');
      banner.textContent = m.solved
        ? 'Correct! +' + m.points + ' points. Waiting for the other players...'
        : 'Out of guesses. The word was ' + state.word + '. Waiting for others...';
    } else {
      banner.className = 'banner hidden';
    }

    // players
    $('gamePlayers').innerHTML = state.players
      .map((p) => {
        const icon = p.status === 'solved' ? '✅' : p.status === 'failed' ? '❌' : '✍️';
        let dots = '';
        if (p.status === 'guessing') {
          dots = '<span class="dots">';
          for (let i = 1; i <= 5; i++) dots += '<i class="' + (i <= p.opened ? 'on' : '') + '"></i>';
          dots += '</span>';
        }
        return '<li class="' + (p.id === state.you ? 'me ' : '') + (p.connected ? '' : 'off') + '">' +
          '<span class="status">' + icon + '</span>' +
          '<span class="name">' + esc(p.name) + (p.id === state.you ? ' (you)' : '') + '</span>' +
          dots +
          '<span class="score">' + p.score + '</span></li>';
      })
      .join('');

    // round result overlay
    const reveal = $('reveal');
    if (state.phase === 'between') {
      reveal.classList.remove('hidden');
      $('revealWord').textContent = state.word;
      $('revealList').innerHTML = state.results
        .map((r) => {
          const gain = r.solved
            ? '<span class="gain plus">+' + r.points + '</span>'
            : '<span class="gain zero">0</span>';
          return '<li class="' + (r.id === state.you ? 'me' : '') + '"><span class="name">' + esc(r.name) + '</span>' + gain + '</li>';
        })
        .join('');
      $('skipBtn').classList.toggle('hidden', !isHost());
    } else {
      reveal.classList.add('hidden');
    }

    if (inRound && key !== renderGame.focusKey) {
      renderGame.focusKey = key;
      $('guessInput').value = '';
      if (!('ontouchstart' in window)) $('guessInput').focus();
    }
  }

  $('guessForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('guessInput');
    const text = input.value.trim();
    if (!text || input.disabled) return;
    socket.emit('guess', { text }, (res) => {
      if (res && res.ok && !res.correct) {
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
      }
      if (res && res.ok && res.correct) toast('Correct! +' + res.points);
    });
    input.value = '';
    input.focus();
  });

  $('skipBtn').addEventListener('click', () => socket.emit('skip'));

  // ---------- final ----------
  function renderFinal() {
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    $('podium').innerHTML = state.ranking
      .map((p, i) =>
        '<div class="podium-row' + (i === 0 ? ' first' : '') + '">' +
        '<span class="pos">' + (medals[i] || i + 1) + '</span>' +
        '<span class="pname">' + esc(p.name) + (p.id === state.you ? ' (you)' : '') + '</span>' +
        '<span class="pscore">' + p.score + '</span></div>'
      )
      .join('');
    const host = isHost();
    $('againBtn').classList.toggle('hidden', !host);
    $('againNote').classList.toggle('hidden', host);
  }
  $('againBtn').addEventListener('click', () => socket.emit('playAgain'));

  // ---------- render switch ----------
  function render() {
    if (!state) return;
    if (state.phase === 'lobby') { show('lobby'); renderLobby(); }
    else if (state.phase === 'final') { show('final'); renderFinal(); }
    else { show('game'); renderGame(); }
    tick();
  }

  // ---------- timer ----------
  function tick() {
    if (!state) return;
    if (state.phase === 'round' && state.endsAt) {
      const left = Math.max(0, (state.endsAt - nowServer()) / 1000);
      $('timerText').textContent = Math.ceil(left);
      $('timerText').classList.toggle('low', left <= 10);
      const bar = $('timerBar');
      bar.style.width = Math.min(100, (left / (state.roundSeconds || 60)) * 100) + '%';
      bar.classList.toggle('low', left <= 10);
    } else if (state.phase === 'between' && state.nextAt) {
      const left = Math.max(0, Math.ceil((state.nextAt - nowServer()) / 1000));
      $('timerText').textContent = '-';
      $('revealCount').textContent = (state.isLastRound ? 'Final results in ' : 'Next round in ') + left + 's';
    }
  }
  setInterval(tick, 250);

  // ---------- socket events ----------
  socket.on('state', (s) => {
    state = s;
    offset = s.serverNow - Date.now();
    render();
  });

  socket.on('connect', () => {
    const saved = store.get();
    if (!saved) return;
    socket.emit('rejoin', saved, (res) => {
      if (!res || !res.ok) {
        store.clear();
        state = null;
        show('home');
        toast('That game has ended.');
      }
    });
  });

  socket.on('disconnect', () => toast('Connection lost. Reconnecting...'));

  show('home');
})();
