// Multiplayer WebSocket client — loaded as a browser <script>
'use strict';
window.MP = (() => {
  let _ws   = null;
  let _role = null;
  const _handlers = {};

  const on  = (type, fn) => { _handlers[type] = fn; };
  const off = (type)     => { delete _handlers[type]; };

  function send(msg) {
    if (_ws && _ws.readyState === WebSocket.OPEN)
      _ws.send(JSON.stringify(msg));
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connect(url, role) {
    return new Promise((resolve, reject) => {
      _ws = new WebSocket(url);
      _ws.onopen = () => send({ type: 'register', role });
      _ws.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'registered') { _role = role; resolve(); return; }
        const fn = _handlers[msg.type] ?? _handlers['*'];
        if (fn) fn(msg);
      };
      _ws.onerror = err => reject(err);
      _ws.onclose = ()  => { _handlers.close?.(); };
    });
  }

  function disconnect() { _ws?.close(); _ws = null; _role = null; }

  return {
    on, off, send, connect, disconnect, wsUrl,
    get role()      { return _role; },
    get connected() { return _ws != null && _ws.readyState === WebSocket.OPEN; },
  };
})();
