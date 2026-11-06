(function () {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);
  const POINTS = [20, 15, 10, 5, 0];

  let state = null;
  let offset = 0; // server time minus client time
  let lastKey = '';
  let lastOpened = 0;
  let user = null; // logged-in account, or null for a guest
  let board = null; // latest daily leaderboard

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
    if (user) return user.username;
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

  function ensureAuth() {
    if (!user) return Promise.resolve();
    return new Promise((resolve) => socket.emit('auth', { token: getToken() }, resolve));
  }

  $('createBtn').addEventListener('click', async () => {
    const name = getName();
    if (!name) return;
    await ensureAuth();
    socket.emit('create', { name }, handleEntry);
  });

  $('joinBtn').addEventListener('click', async () => {
    const name = getName();
    if (!name) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) {
      $('homeError').textContent = 'Enter the 4-letter room code.';
      return;
    }
    await ensureAuth();
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
    updateReset();
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

  // ---------- accounts ----------
  const getToken = () => { try { return localStorage.getItem('wordx_token'); } catch (e) { return null; } };
  const setToken = (t) => {
    try { if (t) localStorage.setItem('wordx_token', t); else localStorage.removeItem('wordx_token'); } catch (e) {}
  };

  async function api(path, method, body) {
    const t = getToken();
    try {
      const res = await fetch(path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      data.status = res.status;
      return data;
    } catch (e) {
      return { ok: false, status: 0, error: 'Network problem. Check your connection.' };
    }
  }

  function applyAuth() {
    const named = !!(user && user.username);
    $('authGuest').classList.toggle('hidden', !!user);
    $('authUser').classList.toggle('hidden', !named);
    $('nameWrap').classList.toggle('hidden', named);
    if (named) $('authName').textContent = user.username;
    $('nameModal').classList.toggle('hidden', !(user && !user.username));
    renderBoards();
  }

  // ---- Google sign-in ----
  let googleReady = false;
  function inAppBrowser() {
    return /FBAN|FBAV|Instagram|musical_ly|TikTok|BytedanceWebview|Line\//i.test(navigator.userAgent);
  }
  async function initGoogle() {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
    const note = $('googleNote');
    if (!cfg.googleClientId) {
      note.textContent = 'Sign-in is not available yet. You can still play as a guest.';
      note.classList.remove('hidden');
      return;
    }
    if (inAppBrowser()) {
      note.textContent = 'Google sign-in may not work inside this app. If it fails, open WordX in Chrome or Safari.';
      note.classList.remove('hidden');
    }
    const start = () => {
      if (!window.google || !google.accounts) return setTimeout(start, 300);
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogle });
      google.accounts.id.renderButton($('googleBtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill' });
      googleReady = true;
    };
    start();
  }
  async function onGoogle(resp) {
    const res = await api('/api/google', 'POST', { credential: resp.credential });
    if (!res.ok) {
      toast(res.error || 'Sign-in failed. Please try again.');
      return;
    }
    setToken(res.token);
    user = res.user;
    socket.emit('auth', { token: res.token });
    applyAuth();
    if (user.username) toast('Welcome back, ' + user.username + '!');
    else setTimeout(() => $('usernameInput').focus(), 100);
  }

  $('nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('nameSubmit').disabled = true;
    const res = await api('/api/username', 'POST', { username: $('usernameInput').value.trim() });
    $('nameSubmit').disabled = false;
    if (!res.ok) {
      if (res.status === 401) {
        setToken(null);
        user = null;
        applyAuth();
        toast('Please sign in again.');
        return;
      }
      $('nameError').textContent = res.error || 'Something went wrong.';
      return;
    }
    user = res.user;
    $('nameError').textContent = '';
    socket.emit('auth', { token: getToken() });
    applyAuth();
    toast('Welcome, ' + user.username + '!');
  });

  async function logout() {
    await api('/api/logout', 'POST');
    setToken(null);
    user = null;
    socket.emit('auth', { token: null });
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    applyAuth();
  }
  $('logoutBtn').addEventListener('click', logout);

  initGoogle();
  if (getToken()) {
    api('/api/me', 'GET').then((res) => {
      if (res.ok) { user = res.user; applyAuth(); } else { setToken(null); }
    });
  }

  // ---------- leaderboard ----------
  const fmt = (n) => Number(n).toLocaleString('en-NG');

  function boardHtml() {
    const b = board;
    const mine = user ? user.username : null;
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    const rows = b.top.length
      ? b.top.map((r) =>
          '<li class="' + (r.username === mine ? 'me' : '') + '"><span class="rank">' + (medals[r.rank - 1] || r.rank) + '</span>' +
          '<span class="name">' + esc(r.username) + '</span><span class="score">' + r.points + '</span></li>').join('')
      : '<li class="empty muted">No scores yet today. Be the first!</li>';
    const need = 'play at least ' + b.minRounds + ' rounds with 2 or more players to qualify.';
    return '<div class="lb-head"><div><b>\u{1F3C6} Today\'s leaderboard</b><div class="muted">Top player wins \u20A6' + fmt(b.prize) + '</div></div>' +
      '<div class="lb-reset"><span class="muted">Resets in</span><b class="lbReset">--:--:--</b></div></div>' +
      '<ul class="plist lb-list">' + rows + '</ul>' +
      '<div class="muted lb-note">' + (user ? 'Play' : 'Log in, then play') + ' ' + need.replace(/^play /, '') + '</div>' +
      (b.lastWinner ? '<div class="lb-last">Yesterday\'s winner: <b>' + esc(b.lastWinner.username) + '</b> (' + b.lastWinner.points + ' pts)</div>' : '');
  }

  function renderBoards() {
    if (!board) return;
    const html = boardHtml();
    document.querySelectorAll('.lb').forEach((el) => { el.innerHTML = html; });
    updateReset();
  }

  function updateReset() {
    if (!board) return;
    const left = Math.max(0, Math.floor((board.resetsAt - nowServer()) / 1000));
    const t = [Math.floor(left / 3600), Math.floor((left % 3600) / 60), left % 60]
      .map((n) => String(n).padStart(2, '0')).join(':');
    document.querySelectorAll('.lbReset').forEach((el) => { el.textContent = t; });
  }

  // ---------- prize claim (cannot be closed until the details are sent) ----------
  const BANKS = ['Access Bank', 'GTBank', 'First Bank', 'UBA', 'Zenith Bank', 'Opay', 'PalmPay', 'Kuda', 'Moniepoint',
    'Wema Bank', 'Sterling Bank', 'Fidelity Bank', 'Union Bank', 'Stanbic IBTC', 'Polaris Bank', 'FCMB', 'Ecobank',
    'Keystone Bank', 'Providus Bank'];
  $('bankList').innerHTML = BANKS.map((b) => '<option value="' + b + '"></option>').join('');

  function openClaim(info) {
    $('claimTitle').textContent = 'You won \u20A6' + fmt(info.prize) + '!';
    $('claimSub').textContent = 'You were top of the leaderboard on ' + info.day + ' with ' + info.points +
      ' points. Send your bank details to get paid.';
    $('claimError').textContent = '';
    $('claimModal').classList.remove('hidden');
  }

  $('claimForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('claimSubmit').disabled = true;
    const res = await api('/api/claim', 'POST', {
      bank: $('claimBank').value.trim(),
      accountNumber: $('claimNumber').value,
      accountName: $('claimName').value.trim()
    });
    $('claimSubmit').disabled = false;
    if (res.ok) {
      $('claimModal').classList.add('hidden');
      $('claimNumber').value = '';
      $('claimName').value = '';
      toast('Sent! You will be paid soon.');
      return;
    }
    if (res.status === 401) {
      // login expired: ask them to log in again, then the prompt comes back
      $('claimModal').classList.add('hidden');
      setToken(null);
      user = null;
      applyAuth();
      toast('Please sign in again to claim your prize.');
      return;
    }
    $('claimError').textContent = res.error || 'Something went wrong.';
  });

  // ---------- socket events ----------
  socket.on('leaderboard', (b) => {
    board = b;
    offset = b.serverNow - Date.now();
    renderBoards();
  });

  socket.on('claim', openClaim);

  socket.on('state', (s) => {
    state = s;
    offset = s.serverNow - Date.now();
    render();
  });

  socket.on('connect', () => {
    const token = getToken();
    if (token) socket.emit('auth', { token });
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
