// GA4 Inspector — painel principal
// Intercepta hits GA4 via rede (XHR + fetch) — captura 100% dos eventos
(function () {
  'use strict';

  if (document.getElementById('__ga4ins__')) {
    document.getElementById('__ga4ins__').remove();
    var os = document.getElementById('__ga4ins_style__');
    if (os) os.remove();
    window.__ga4ins_active__ = false;
    return;
  }

  window.__ga4ins_active__ = true;

  // ── ESTADO ────────────────────────────────────────────────────────────────
  var state = {
    events: [],
    counts: {},
    sessionData: {},
    pageStart: Date.now()
  };

  // ── EXTRAIR DADOS DE UM HIT GA4 ───────────────────────────────────────────
  // GA4 envia hits para https://www.google-analytics.com/g/collect
  // Os parâmetros vêm na query string ou no body (POST)
  function parseGA4Hit(url, body) {
    var params = {};
    var fullStr = '';

    try {
      var u = new URL(url);
      u.searchParams.forEach(function(v, k) { params[k] = v; });
      fullStr = u.search + (body || '');
    } catch(e) {
      fullStr = url + (body || '');
    }

    // Body pode ter múltiplos hits separados por \n
    var hits = (body || '').split('\n').filter(Boolean);
    if (!hits.length) hits = [''];

    return hits.map(function(hitBody) {
      var hitParams = Object.assign({}, params);
      if (hitBody) {
        hitBody.split('&').forEach(function(pair) {
          var idx = pair.indexOf('=');
          if (idx > -1) {
            try {
              hitParams[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
            } catch(e) {}
          }
        });
      }
      return hitParams;
    });
  }

  function buildEvent(hitParams) {
    var name = hitParams['en'] || hitParams['t'] || 'unknown';

    // Parâmetros de evento (prefixo "ep." ou "epn.")
    var eventParams = {};
    Object.keys(hitParams).forEach(function(k) {
      if (k.startsWith('ep.'))  eventParams[k.slice(3)]  = hitParams[k];
      if (k.startsWith('epn.')) eventParams[k.slice(4)]  = hitParams[k]; // numérico
      if (k.startsWith('pr'))   eventParams[k]           = hitParams[k]; // produto
    });

    // Dados de usuário / sessão
    var user = {
      client_id:     hitParams['cid'] || '—',
      user_id:       hitParams['uid'] || '—',
      consent:       hitParams['gcs'] || '—',
      dma:           hitParams['dma'] || '—',
    };

    var session = {
      session_id:    hitParams['sid'] || '—',
      session_count: hitParams['sct'] || '—',
      session_engaged: hitParams['seg'] || '—',
      engagement_time: hitParams['_et'] || '—',
      hit_counter:   hitParams['_s']  || '—',
    };

    var settings = {
      measurement_id: hitParams['tid'] || '—',
      gtm_hash:       hitParams['gtm'] || '—',
      protocol:       hitParams['v']   || '—',
      debug_mode:     hitParams['_dbg'] ? 'sim' : 'não',
    };

    return {
      name: name,
      params: eventParams,
      rawParams: hitParams,
      user: user,
      session: session,
      settings: settings,
      time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      ms: Date.now(),
      status: 'fired',
      issues: [],
      trigger: guessTrigger(name),
      type: guessType(name)
    };
  }

  function processHit(url, body) {
    if (!url || url.indexOf('google-analytics.com') === -1) return;
    if (url.indexOf('/g/collect') === -1 && url.indexOf('/collect') === -1) return;

    var hits = parseGA4Hit(url, body);
    hits.forEach(function(hitParams) {
      if (!hitParams['en'] && !hitParams['t']) return;
      var ev = buildEvent(hitParams);
      ev.issues = validateEvent(ev);
      if (ev.issues.length > 0) ev.status = 'error';
      var prev = state.counts[ev.name] || 0;
      if (prev > 0) ev.status = ev.status === 'error' ? 'error' : 'dupe';
      state.counts[ev.name] = prev + 1;
      state.events.push(ev);
      // Salva dados de sessão do último hit
      if (ev.user.client_id !== '—') state.sessionData = { user: ev.user, session: ev.session, settings: ev.settings };
      renderIfActive();
    });
  }

  // ── INTERCEPTAR XHR ───────────────────────────────────────────────────────
  if (!window.__ga4ins_xhr_hooked__) {
    var OrigXHR = window.XMLHttpRequest;
    function HookedXHR() {
      var xhr = new OrigXHR();
      var _url = '';
      var _open = xhr.open.bind(xhr);
      var _send = xhr.send.bind(xhr);
      xhr.open = function(method, url) {
        _url = url;
        return _open.apply(this, arguments);
      };
      xhr.send = function(body) {
        processHit(_url, typeof body === 'string' ? body : '');
        return _send.apply(this, arguments);
      };
      return xhr;
    }
    HookedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = HookedXHR;
    window.__ga4ins_xhr_hooked__ = true;
  }

  // ── INTERCEPTAR FETCH ─────────────────────────────────────────────────────
  if (!window.__ga4ins_fetch_hooked__) {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var body = (init && init.body) ? init.body : '';
      processHit(url, typeof body === 'string' ? body : '');
      return origFetch.apply(this, arguments);
    };
    window.__ga4ins_fetch_hooked__ = true;
  }

  // ── INTERCEPTAR GTAG E DATALAYER (camada extra) ───────────────────────────
  if (typeof window.gtag === 'function' && !window.__ga4ins_gtag__) {
    var _gtag = window.gtag;
    window.gtag = function() {
      if (arguments[0] === 'event') {
        var name = arguments[1];
        var params = arguments[2] || {};
        // Cria evento sintético para eventos que ainda não foram ao servidor
        var synth = {
          name: name, params: params, rawParams: params,
          user: { client_id: '(gtag)', user_id: '—', consent: '—', dma: '—' },
          session: { session_id: '—', session_count: '—', session_engaged: '—', engagement_time: '—', hit_counter: '—' },
          settings: { measurement_id: '—', gtm_hash: '—', protocol: '—', debug_mode: '—' },
          time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
          ms: Date.now(), status: 'fired', issues: [], trigger: guessTrigger(name), type: guessType(name),
          source: 'gtag'
        };
        synth.issues = validateEvent(synth);
        if (synth.issues.length) synth.status = 'error';
        var prev = state.counts[name] || 0;
        if (prev > 0) synth.status = synth.status === 'error' ? 'error' : 'dupe';
        state.counts[name] = prev + 1;
        state.events.push(synth);
        renderIfActive();
      }
      return _gtag.apply(this, arguments);
    };
    window.__ga4ins_gtag__ = true;
  }

  if (Array.isArray(window.dataLayer) && !window.__ga4ins_dl__) {
    var _dlPush = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function() {
      for (var i = 0; i < arguments.length; i++) {
        var item = arguments[i];
        if (item && typeof item === 'object' && item.event && !/^gtm\./.test(item.event)) {
          var name = item.event;
          var params = Object.assign({}, item);
          delete params.event;
          var synth = {
            name: name, params: params, rawParams: params,
            user: { client_id: '(dataLayer)', user_id: '—', consent: '—', dma: '—' },
            session: { session_id: '—', session_count: '—', session_engaged: '—', engagement_time: '—', hit_counter: '—' },
            settings: { measurement_id: '—', gtm_hash: '—', protocol: '—', debug_mode: '—' },
            time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
            ms: Date.now(), status: 'fired', issues: [], trigger: guessTrigger(name), type: guessType(name),
            source: 'dataLayer'
          };
          synth.issues = validateEvent(synth);
          if (synth.issues.length) synth.status = 'error';
          var prev = state.counts[name] || 0;
          if (prev > 0) synth.status = synth.status === 'error' ? 'error' : 'dupe';
          state.counts[name] = prev + 1;
          state.events.push(synth);
          renderIfActive();
        }
      }
      return _dlPush.apply(this, arguments);
    };
    window.__ga4ins_dl__ = true;
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  var REQUIRED = {
    purchase: ['transaction_id','value','currency'],
    add_to_cart: ['currency','value'],
    begin_checkout: ['currency','value'],
    view_item: ['currency','value'],
    login: ['method'], sign_up: ['method'],
    search: ['search_term']
  };

  function validateEvent(ev) {
    var issues = [];
    var req = REQUIRED[ev.name] || [];
    req.forEach(function(p) {
      if (ev.params[p] === undefined || ev.params[p] === '') issues.push('Parâmetro obrigatório ausente: ' + p);
    });
    if (ev.params.value !== undefined && isNaN(Number(ev.params.value))) issues.push('"value" deve ser número');
    if (ev.params.currency !== undefined && !/^[A-Z]{3}$/.test(String(ev.params.currency))) issues.push('"currency" deve ser código ISO (ex: BRL)');
    return issues;
  }

  function guessType(name) {
    if (/page_view|screen_view|first_visit/.test(name)) return 'pageview';
    if (/click|select/.test(name)) return 'click';
    if (/scroll/.test(name)) return 'scroll';
    if (/video/.test(name)) return 'video';
    if (/form|submit/.test(name)) return 'form';
    if (/purchase|add_to_cart|begin_checkout|view_item|view_item_list/.test(name)) return 'ecom';
    if (/ad_impression|ad_click/.test(name)) return 'ad';
    if (/user_engagement|session_start|first_open/.test(name)) return 'auto';
    return 'custom';
  }

  function guessTrigger(name) {
    if (/page_view|first_visit|session_start/.test(name)) return 'Pageview automático';
    if (/scroll/.test(name)) return 'Scroll depth';
    if (/video/.test(name)) return 'Interação com vídeo';
    if (/click/.test(name)) return 'Clique';
    if (/form|submit/.test(name)) return 'Envio de formulário';
    if (/search/.test(name)) return 'Busca';
    if (/purchase|checkout/.test(name)) return 'E-commerce';
    if (/user_engagement/.test(name)) return 'Engajamento (timer)';
    if (/ad_impression/.test(name)) return 'Impressão de anúncio';
    if (/exception|error/.test(name)) return 'Erro/exceção';
    if (/first_open|app_open/.test(name)) return 'Abertura de app';
    return 'Evento customizado / GTM';
  }

  var TYPE_LABELS = {
    pageview: 'Pageview', click: 'Click', scroll: 'Scroll',
    video: 'Video', form: 'Form', ecom: 'E-com',
    ad: 'Ad', auto: 'Auto', custom: 'Custom'
  };

  var TYPE_COLORS = {
    pageview: '#34d399', click: '#00e5ff', scroll: '#fcd34d',
    video: '#fb7185', form: '#a78bfa', ecom: '#fb923c',
    ad: '#f472b6', auto: '#94a3b8', custom: '#cbd5e1'
  };

  var STATUS_LABELS = { fired: 'OK', error: 'ERRO', dupe: 'DUPLICATA' };
  var STATUS_COLORS = { fired: '#34d399', error: '#fb7185', dupe: '#fcd34d' };

  // ── ESTILOS ───────────────────────────────────────────────────────────────
  var MONO = "'Consolas','Courier New',monospace";
  var SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";

  var style = document.createElement('style');
  style.id = '__ga4ins_style__';
  style.textContent = [
    '#__ga4ins__{all:initial;position:fixed;top:14px;right:14px;width:500px;max-height:92vh;',
    'background:#13151f;border:1px solid #2a2d3e;border-radius:10px;',
    'z-index:2147483647;font-family:' + SANS + ';font-size:13px;color:#e8eaf2;',
    'box-shadow:0 20px 60px rgba(0,0,0,.7);display:flex;flex-direction:column;',
    'overflow:hidden;resize:both;min-width:320px;min-height:200px}',

    '#__ga4ins__ *{box-sizing:border-box;margin:0;padding:0}',

    // Header
    '#gi-hdr{display:flex;align-items:center;justify-content:space-between;',
    'padding:10px 14px;background:#0d0f18;border-bottom:1px solid #2a2d3e;',
    'cursor:move;user-select:none;flex-shrink:0}',
    '.gi-logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:#fff;font-family:' + SANS + '}',
    '.gi-dot{width:7px;height:7px;border-radius:50%;background:#10b981;',
    'box-shadow:0 0 6px #10b981;animation:gi-pulse 1.5s ease-in-out infinite}',
    '@keyframes gi-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
    '.gi-hdr-right{display:flex;align-items:center;gap:6px}',
    '.gi-counter{font-family:' + MONO + ';font-size:11px;color:#4a5270;padding:2px 8px;',
    'background:#1a1d2e;border:1px solid #2a2d3e;border-radius:3px}',
    '.gi-hbtn{background:#1a1d2e;border:1px solid #2a2d3e;color:#8892b0;font-size:11px;',
    'padding:4px 10px;border-radius:4px;cursor:pointer;transition:all .15s;font-family:' + MONO + '}',
    '.gi-hbtn:hover{background:#252840;color:#e8eaf2;border-color:#4a5270}',

    // Tabs
    '#gi-tabs{display:flex;background:#0d0f18;border-bottom:1px solid #1e2030;flex-shrink:0}',
    '.gi-tab{flex:1;padding:9px 4px;text-align:center;font-size:10px;font-weight:700;',
    'letter-spacing:.5px;color:#4a5270;cursor:pointer;border:none;background:transparent;',
    'border-bottom:2px solid transparent;transition:all .15s;text-transform:uppercase;',
    'font-family:' + MONO + ';white-space:nowrap;position:relative}',
    '.gi-tab:hover:not(.on){color:#8892b0}',
    '.gi-tab.on{color:#00e5ff;border-bottom-color:#00e5ff}',
    '.gi-tab-badge{position:absolute;top:3px;right:3px;background:#fb7185;color:#000;',
    'font-size:8px;font-weight:800;min-width:14px;height:14px;border-radius:7px;',
    'display:none;align-items:center;justify-content:center;padding:0 3px}',

    // Filter bar
    '#gi-filterbar{padding:8px 12px;background:#13151f;border-bottom:1px solid #1e2030;',
    'display:flex;gap:6px;align-items:center;flex-shrink:0}',
    '#gi-filterbar input{flex:1;background:#1a1d2e;border:1px solid #2a2d3e;color:#e8eaf2;',
    'padding:6px 10px;border-radius:4px;font-size:12px;outline:none;font-family:' + MONO + '}',
    '#gi-filterbar input::placeholder{color:#3a3d52}',
    '#gi-filterbar input:focus{border-color:#00e5ff}',
    '.gi-fchip{font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;cursor:pointer;',
    'border:1px solid transparent;font-family:' + MONO + ';transition:all .15s;user-select:none}',
    '.gi-fchip.active{border-color:currentColor;opacity:1}',
    '.gi-fchip:not(.active){opacity:.35;border-color:transparent}',

    // Body / scroll
    '#gi-body{flex:1;overflow-y:auto;min-height:0}',
    '#gi-body::-webkit-scrollbar{width:4px}',
    '#gi-body::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:2px}',
    '.gi-panel{display:none}',
    '.gi-panel.on{display:block}',

    // Empty
    '.gi-empty{padding:48px 20px;text-align:center;color:#3a3d52;font-family:' + MONO + ';font-size:12px;line-height:2.2}',
    '.gi-empty-icon{font-size:36px;margin-bottom:8px;display:block}',

    // Event card
    '.gi-ev{border-bottom:1px solid #1a1d2e;cursor:default;animation:gi-in .15s ease}',
    '@keyframes gi-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}',
    '.gi-ev:hover{background:#161828}',
    '.gi-ev-top{display:flex;align-items:center;gap:7px;padding:9px 12px 5px}',
    '.gi-ev-name{flex:1;font-weight:700;font-size:13px;color:#fff;font-family:' + MONO + ';word-break:break-all}',
    '.gi-ev-time{font-family:' + MONO + ';font-size:10px;color:#3a3d52;flex-shrink:0}',
    '.gi-ev-trigger{padding:0 12px 6px;font-size:11px;color:#4a5270;font-family:' + MONO + '}',
    '.gi-ev-issues{padding:3px 12px 6px;font-size:11px;color:#fb7185;font-family:' + MONO + '}',

    // Tag / badge
    '.gi-tag{font-family:' + MONO + ';font-size:9px;font-weight:700;padding:2px 7px;',
    'border-radius:3px;flex-shrink:0;letter-spacing:.3px;text-transform:uppercase}',

    // Expand / params
    '.gi-expand-btn{padding:3px 12px 7px;font-size:11px;color:#4a5270;cursor:pointer;',
    'font-family:' + MONO + ';transition:color .15s}',
    '.gi-expand-btn:hover{color:#8892b0}',
    '.gi-params{display:none;padding:0 12px 10px}',
    '.gi-params.open{display:block}',

    // Tabs dentro do card expandido
    '.gi-ev-tabs{display:flex;gap:2px;margin-bottom:8px;border-bottom:1px solid #1e2030;padding-bottom:6px}',
    '.gi-ev-tab{font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;cursor:pointer;',
    'font-family:' + MONO + ';color:#4a5270;transition:all .15s;border:1px solid transparent}',
    '.gi-ev-tab.on{background:#1e2030;color:#00e5ff;border-color:#2a2d3e}',
    '.gi-ev-tab:hover:not(.on){color:#8892b0}',
    '.gi-ev-section{display:none}',
    '.gi-ev-section.on{display:block}',

    // Tabela de parâmetros
    '.gi-ptable{width:100%;border-collapse:collapse;font-family:' + MONO + ';font-size:11px}',
    '.gi-ptable tr{border-bottom:1px solid #1a1d2e}',
    '.gi-ptable tr:last-child{border:none}',
    '.gi-ptable td{padding:4px 6px;vertical-align:top}',
    '.gi-ptable td:first-child{color:#8b9fd4;white-space:nowrap;width:45%;padding-right:12px}',
    '.gi-ptable td:last-child{color:#c8d0e8;word-break:break-all}',
    '.gi-ptable tr.missing td{color:#fb7185}',
    '.gi-ptable tr.invalid td:last-child{color:#fcd34d}',

    // Aba Resumo
    '.gi-sum{padding:14px}',
    '.gi-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}',
    '.gi-stat{background:#1a1d2e;border:1px solid #2a2d3e;border-radius:6px;padding:12px 8px;text-align:center}',
    '.gi-stat-val{font-size:26px;font-weight:800;font-family:' + MONO + ';line-height:1}',
    '.gi-stat-lbl{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:#4a5270;margin-top:5px;font-family:' + MONO + '}',
    '.gi-section-hd{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;',
    'color:#3a3d52;font-family:' + MONO + ';margin-bottom:10px}',
    '.gi-rank-item{padding:6px 0;border-bottom:1px solid #1a1d2e}',
    '.gi-rank-row{display:flex;align-items:center;gap:8px;margin-bottom:3px}',
    '.gi-rank-n{font-family:' + MONO + ';font-size:10px;color:#3a3d52;width:16px;flex-shrink:0}',
    '.gi-rank-name{flex:1;font-size:11px;font-family:' + MONO + ';color:#c8d0e8}',
    '.gi-rank-count{font-family:' + MONO + ';font-size:11px;font-weight:700;color:#a78bfa}',
    '.gi-rank-pct{font-size:10px;color:#3a3d52;font-family:' + MONO + ';min-width:32px;text-align:right}',
    '.gi-bar-bg{height:3px;background:#1e2030;border-radius:2px}',
    '.gi-bar-fg{height:3px;background:linear-gradient(90deg,#7c3aed,#00e5ff);border-radius:2px;transition:width .4s}',

    // Aba QA
    '.gi-qa{padding:14px}',
    '.gi-qa-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}',
    '.gi-issue-card{background:#1a1d2e;border:1px solid #2a2d3e;border-radius:6px;padding:10px 12px;margin-bottom:8px}',
    '.gi-issue-hd{display:flex;align-items:center;gap:7px;margin-bottom:5px}',
    '.gi-issue-name{flex:1;font-weight:700;font-size:12px;font-family:' + MONO + ';color:#fff}',
    '.gi-issue-body{font-size:11px;color:#8892b0;font-family:' + MONO + ';line-height:1.6}',

    // Aba Timeline
    '.gi-tl{padding:14px}',
    '.gi-tl-track{position:relative;padding-left:24px}',
    '.gi-tl-spine{position:absolute;left:7px;top:8px;bottom:0;width:2px;background:#1e2030;border-radius:1px}',
    '.gi-tl-row{position:relative;padding:5px 0 5px 0;display:flex;align-items:flex-start;gap:10px}',
    '.gi-tl-node{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:2px;',
    'position:absolute;left:-17px}',
    '.gi-tl-content{flex:1}',
    '.gi-tl-name{font-size:12px;font-weight:700;color:#e8eaf2;font-family:' + MONO + '}',
    '.gi-tl-meta{font-size:10px;color:#4a5270;font-family:' + MONO + ';margin-top:2px}',
    '.gi-tl-err{font-size:10px;color:#fb7185;font-family:' + MONO + ';margin-top:2px}',

    // Aba Página
    '.gi-page{padding:14px}',
    '.gi-info-card{background:#1a1d2e;border:1px solid #2a2d3e;border-radius:6px;padding:12px;margin-bottom:10px}',
    '.gi-info-card h3{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;',
    'color:#00e5ff;font-family:' + MONO + ';margin-bottom:10px}',
    '.gi-info-row{display:flex;justify-content:space-between;align-items:center;',
    'padding:4px 0;border-bottom:1px solid #1e2030;font-size:11px}',
    '.gi-info-row:last-child{border:none}',
    '.gi-info-k{color:#4a5270;font-family:' + MONO + ';flex-shrink:0;margin-right:12px}',
    '.gi-info-v{color:#c8d0e8;font-family:' + MONO + ';text-align:right;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px}',
    '.ok{color:#34d399!important}',
    '.warn{color:#fcd34d!important}',
    '.err{color:#fb7185!important}',
  ].join('');

  document.head.appendChild(style);

  // ── HTML ──────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = '__ga4ins__';
  panel.innerHTML = [
    '<div id="gi-hdr">',
      '<div class="gi-logo"><span class="gi-dot"></span>GA4 Inspector</div>',
      '<div class="gi-hdr-right">',
        '<span class="gi-counter" id="gi-counter">0 eventos</span>',
        '<button class="gi-hbtn" id="gi-clear">limpar</button>',
        '<button class="gi-hbtn" id="gi-export">exportar</button>',
        '<button class="gi-hbtn" id="gi-close">✕</button>',
      '</div>',
    '</div>',
    '<div id="gi-tabs">',
      '<button class="gi-tab on" data-t="feed">📡 Feed</button>',
      '<button class="gi-tab" data-t="sum">📊 Resumo</button>',
      '<button class="gi-tab" data-t="qa">🔬 QA<span class="gi-tab-badge" id="qa-badge">0</span></button>',
      '<button class="gi-tab" data-t="tl">⏱ Timeline</button>',
      '<button class="gi-tab" data-t="page">🔎 Página</button>',
    '</div>',
    '<div id="gi-filterbar">',
      '<input type="text" id="gi-search" placeholder="filtrar eventos..." />',
    '</div>',
    '<div id="gi-body">',
      '<div class="gi-panel on" id="gp-feed">',
        '<div class="gi-empty" id="gi-empty">',
          '<span class="gi-empty-icon">📡</span>',
          'Aguardando eventos GA4...<br>Interaja com a página.',
        '</div>',
      '</div>',
      '<div class="gi-panel" id="gp-sum"></div>',
      '<div class="gi-panel" id="gp-qa"></div>',
      '<div class="gi-panel" id="gp-tl"></div>',
      '<div class="gi-panel" id="gp-page"></div>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  // ── LÓGICA DE TABS ────────────────────────────────────────────────────────
  var filterActive = { feed: true };

  panel.querySelectorAll('.gi-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      panel.querySelectorAll('.gi-tab').forEach(function(t) { t.classList.remove('on'); });
      panel.querySelectorAll('.gi-panel').forEach(function(p) { p.classList.remove('on'); });
      tab.classList.add('on');
      var t = tab.dataset.t;
      document.getElementById('gp-' + t).classList.add('on');
      document.getElementById('gi-filterbar').style.display = t === 'feed' ? 'flex' : 'none';
      if (t === 'sum')  renderSummary();
      if (t === 'qa')   renderQA();
      if (t === 'tl')   renderTimeline();
      if (t === 'page') renderPage();
    });
  });

  document.getElementById('gi-search').addEventListener('input', function(e) {
    filterActive.text = e.target.value.toLowerCase();
    renderFeed();
  });

  document.getElementById('gi-close').addEventListener('click', function() {
    panel.remove(); style.remove();
    window.__ga4ins_active__ = false;
  });

  document.getElementById('gi-clear').addEventListener('click', function() {
    state.events = []; state.counts = {};
    document.getElementById('qa-badge').style.display = 'none';
    document.getElementById('gi-counter').textContent = '0 eventos';
    renderFeed(); renderSummary();
  });

  document.getElementById('gi-export').addEventListener('click', function() {
    var blob = new Blob([JSON.stringify(state.events, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ga4-events-' + Date.now() + '.json';
    a.click();
  });

  // Drag
  var drag = false, ox = 0, oy = 0;
  document.getElementById('gi-hdr').addEventListener('mousedown', function(e) {
    drag = true;
    ox = e.clientX - panel.getBoundingClientRect().left;
    oy = e.clientY - panel.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', function(e) {
    if (!drag) return;
    panel.style.left  = (e.clientX - ox) + 'px';
    panel.style.top   = (e.clientY - oy) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', function() { drag = false; });

  // ── RENDER ────────────────────────────────────────────────────────────────
  function activeTab() {
    var t = panel.querySelector('.gi-tab.on');
    return t ? t.dataset.t : 'feed';
  }

  function renderIfActive() {
    var t = activeTab();
    updateCounter();
    updateQABadge();
    if (t === 'feed') renderFeed();
    if (t === 'sum')  renderSummary();
    if (t === 'qa')   renderQA();
    if (t === 'tl')   renderTimeline();
  }

  function updateCounter() {
    document.getElementById('gi-counter').textContent = state.events.length + ' evento' + (state.events.length !== 1 ? 's' : '');
  }

  function updateQABadge() {
    var n = state.events.filter(function(e) { return e.status === 'error' || e.status === 'dupe'; }).length;
    var badge = document.getElementById('qa-badge');
    if (n > 0) { badge.style.display = 'flex'; badge.textContent = n; }
    else badge.style.display = 'none';
  }

  function tagHTML(label, color) {
    return '<span class="gi-tag" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55">' + label + '</span>';
  }

  // FEED
  function renderFeed() {
    var feed = document.getElementById('gp-feed');
    var empty = document.getElementById('gi-empty');
    feed.querySelectorAll('.gi-ev').forEach(function(el) { el.remove(); });

    var txt = (filterActive.text || '').toLowerCase();
    var filtered = state.events.filter(function(e) {
      return !txt || e.name.toLowerCase().indexOf(txt) !== -1;
    });

    if (!filtered.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    var frag = document.createDocumentFragment();
    var reversed = filtered.slice().reverse();

    reversed.forEach(function(ev) {
      var div = document.createElement('div');
      div.className = 'gi-ev';

      var typeColor  = TYPE_COLORS[ev.type]  || '#94a3b8';
      var typeLabel  = TYPE_LABELS[ev.type]  || ev.type;
      var statColor  = STATUS_COLORS[ev.status] || '#94a3b8';
      var statLabel  = STATUS_LABELS[ev.status] || ev.status;

      var paramCount = Object.keys(ev.params).length;
      var issueHTML  = ev.issues.length ? '<div class="gi-ev-issues">⚠ ' + ev.issues.join(' · ') + '</div>' : '';

      div.innerHTML = [
        '<div class="gi-ev-top">',
          tagHTML(typeLabel, typeColor),
          '<span class="gi-ev-name">' + ev.name + (ev.source ? ' <span style="font-size:9px;color:#3a3d52">(' + ev.source + ')</span>' : '') + '</span>',
          tagHTML(statLabel, statColor),
          '<span class="gi-ev-time">' + ev.time + '</span>',
        '</div>',
        '<div class="gi-ev-trigger">⚡ ' + ev.trigger + '</div>',
        issueHTML,
        paramCount > 0 || true ? [
          '<div class="gi-expand-btn" data-open="0">▶ detalhes</div>',
          '<div class="gi-params">',
            '<div class="gi-ev-tabs">',
              '<span class="gi-ev-tab on" data-s="params">Parâmetros (' + paramCount + ')</span>',
              '<span class="gi-ev-tab" data-s="user">Usuário</span>',
              '<span class="gi-ev-tab" data-s="session">Sessão</span>',
              '<span class="gi-ev-tab" data-s="settings">Settings</span>',
            '</div>',
            renderParamTable(ev.params, ev.issues, 'params'),
            renderInfoTable(ev.user, 'user'),
            renderInfoTable(ev.session, 'session'),
            renderInfoTable(ev.settings, 'settings'),
          '</div>',
        ].join('') : '',
      ].join('');

      // Expand toggle
      var btn = div.querySelector('.gi-expand-btn');
      var params = div.querySelector('.gi-params');
      if (btn && params) {
        btn.addEventListener('click', function() {
          var open = btn.getAttribute('data-open') === '1';
          if (open) {
            params.classList.remove('open');
            btn.textContent = '▶ detalhes';
            btn.setAttribute('data-open', '0');
          } else {
            params.classList.add('open');
            btn.textContent = '▼ ocultar';
            btn.setAttribute('data-open', '1');
          }
        });

        // Sub-tabs
        params.querySelectorAll('.gi-ev-tab').forEach(function(t) {
          t.addEventListener('click', function() {
            params.querySelectorAll('.gi-ev-tab').forEach(function(x) { x.classList.remove('on'); });
            params.querySelectorAll('.gi-ev-section').forEach(function(x) { x.classList.remove('on'); });
            t.classList.add('on');
            var sec = params.querySelector('.gi-ev-section[data-s="' + t.dataset.s + '"]');
            if (sec) sec.classList.add('on');
          });
        });
      }

      frag.appendChild(div);
    });
    feed.appendChild(frag);
  }

  function renderParamTable(params, issues, sectionId) {
    var missingParams = (issues || []).filter(function(i) { return i.indexOf('ausente:') !== -1; })
      .map(function(i) { return i.split(': ')[1]; });
    var rows = '';
    Object.keys(params).forEach(function(k) {
      var v = String(params[k]).substring(0, 200);
      var cls = missingParams.indexOf(k) !== -1 ? ' class="missing"' : '';
      rows += '<tr' + cls + '><td>' + escHTML(k) + '</td><td>' + escHTML(v) + '</td></tr>';
    });
    if (!rows) rows = '<tr><td colspan="2" style="color:#3a3d52;padding:8px 0">Sem parâmetros</td></tr>';
    return '<div class="gi-ev-section on" data-s="' + sectionId + '"><table class="gi-ptable">' + rows + '</table></div>';
  }

  function renderInfoTable(obj, sectionId) {
    var rows = '';
    Object.keys(obj).forEach(function(k) {
      rows += '<tr><td>' + escHTML(k) + '</td><td>' + escHTML(String(obj[k])) + '</td></tr>';
    });
    return '<div class="gi-ev-section" data-s="' + sectionId + '"><table class="gi-ptable">' + rows + '</table></div>';
  }

  function escHTML(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // SUMMARY
  function renderSummary() {
    var c = document.getElementById('gp-sum');
    c.innerHTML = '';
    var total = state.events.length;
    var types = Object.keys(state.counts).length;
    var ok    = state.events.filter(function(e) { return e.status === 'fired'; }).length;
    var bad   = state.events.filter(function(e) { return e.status !== 'fired'; }).length;

    var html = [
      '<div class="gi-sum">',
      '<div class="gi-stat-grid">',
        stat(total, 'Total', '#00e5ff'),
        stat(types, 'Tipos', '#a78bfa'),
        stat(ok,   'OK', '#34d399'),
        stat(bad,  'Problemas', '#fb7185'),
      '</div>',
      '<div class="gi-section-hd">// ranking de eventos</div>',
    ].join('');

    var sorted = Object.entries(state.counts).sort(function(a,b) { return b[1]-a[1]; });
    var max = sorted.length ? sorted[0][1] : 1;
    sorted.forEach(function(item, i) {
      var name = item[0], count = item[1];
      var pct = total ? Math.round(count/total*100) : 0;
      var bar = Math.round(count/max*100);
      var tc  = TYPE_COLORS[guessType(name)] || '#94a3b8';
      var tl  = TYPE_LABELS[guessType(name)] || 'custom';
      html += [
        '<div class="gi-rank-item">',
          '<div class="gi-rank-row">',
            '<span class="gi-rank-n">' + (i+1) + '</span>',
            tagHTML(tl, tc),
            '<span class="gi-rank-name">' + escHTML(name) + '</span>',
            '<span class="gi-rank-count">' + count + '×</span>',
            '<span class="gi-rank-pct">' + pct + '%</span>',
          '</div>',
          '<div class="gi-bar-bg"><div class="gi-bar-fg" style="width:' + bar + '%"></div></div>',
        '</div>',
      ].join('');
    });

    html += '</div>';
    c.innerHTML = html;
  }

  function stat(val, lbl, color) {
    return '<div class="gi-stat"><div class="gi-stat-val" style="color:' + color + '">' + val + '</div><div class="gi-stat-lbl">' + lbl + '</div></div>';
  }

  // QA
  function renderQA() {
    var c = document.getElementById('gp-qa');
    var errors = state.events.filter(function(e) { return e.issues.length > 0; });
    var dupes  = state.events.filter(function(e) { return e.status === 'dupe'; });
    var ok     = state.events.filter(function(e) { return e.status === 'fired' && !e.issues.length; });

    var html = [
      '<div class="gi-qa">',
      '<div class="gi-qa-grid">',
        stat(ok.length,     'OK',        '#34d399'),
        stat(errors.length, 'Erros',     '#fb7185'),
        stat(dupes.length,  'Duplicatas','#fcd34d'),
      '</div>',
    ].join('');

    var issues = errors.concat(dupes.filter(function(d) { return errors.indexOf(d) === -1; }));

    if (!issues.length) {
      html += '<div class="gi-empty" style="padding:24px"><span class="gi-empty-icon">✅</span>Nenhum problema detectado.</div>';
    } else {
      issues.forEach(function(ev) {
        var statColor = STATUS_COLORS[ev.status] || '#94a3b8';
        var statLabel = STATUS_LABELS[ev.status] || ev.status;
        var tc = TYPE_COLORS[ev.type] || '#94a3b8';
        var tl = TYPE_LABELS[ev.type] || ev.type;
        html += [
          '<div class="gi-issue-card">',
            '<div class="gi-issue-hd">',
              tagHTML(tl, tc),
              '<span class="gi-issue-name">' + escHTML(ev.name) + '</span>',
              tagHTML(statLabel, statColor),
              '<span style="font-size:10px;color:#3a3d52;font-family:' + MONO + '">' + ev.time + '</span>',
            '</div>',
            '<div class="gi-issue-body">',
              ev.status === 'dupe'
                ? '⚠ Disparou ' + state.counts[ev.name] + '× na sessão — verifique disparo duplo.'
                : ev.issues.map(function(i) { return '• ' + i; }).join('<br>'),
            '</div>',
          '</div>',
        ].join('');
      });
    }

    html += '</div>';
    c.innerHTML = html;
  }

  // TIMELINE
  function renderTimeline() {
    var c = document.getElementById('gp-tl');
    var live = state.events.filter(function(e) { return !e.fromHistory; });
    if (!live.length) {
      c.innerHTML = '<div class="gi-empty"><span class="gi-empty-icon">⏱</span>Nenhum evento capturado ainda.</div>';
      return;
    }
    var html = '<div class="gi-tl"><div class="gi-tl-track"><div class="gi-tl-spine"></div>';
    live.forEach(function(ev) {
      var nc = STATUS_COLORS[ev.status] || '#34d399';
      var elapsed = '+' + ((ev.ms - state.pageStart) / 1000).toFixed(1) + 's';
      var tc = TYPE_COLORS[ev.type] || '#94a3b8';
      var tl = TYPE_LABELS[ev.type] || ev.type;
      html += [
        '<div class="gi-tl-row">',
          '<div class="gi-tl-node" style="background:' + nc + ';box-shadow:0 0 5px ' + nc + '"></div>',
          '<div class="gi-tl-content">',
            '<div style="display:flex;align-items:center;gap:6px">',
              '<span class="gi-tl-name">' + escHTML(ev.name) + '</span>',
              tagHTML(tl, tc),
            '</div>',
            '<div class="gi-tl-meta">' + ev.time + ' · ' + elapsed + ' · ' + ev.trigger + '</div>',
            ev.issues.length ? '<div class="gi-tl-err">⚠ ' + ev.issues.join(' · ') + '</div>' : '',
          '</div>',
        '</div>',
      ].join('');
    });
    html += '</div></div>';
    c.innerHTML = html;
  }

  // PAGE
  function renderPage() {
    var c = document.getElementById('gp-page');
    var hasGtag = typeof window.gtag === 'function';
    var hasDL   = Array.isArray(window.dataLayer);
    var mids    = [];
    try {
      document.querySelectorAll('script[src]').forEach(function(s) {
        var m = s.src.match(/id=(G-[A-Z0-9]+)/);
        if (m && mids.indexOf(m[1]) === -1) mids.push(m[1]);
      });
      if (hasDL) window.dataLayer.forEach(function(item) {
        if (!item) return;
        Object.values(item).forEach(function(v) {
          if (typeof v === 'string' && /^G-[A-Z0-9]+$/.test(v) && mids.indexOf(v) === -1) mids.push(v);
        });
      });
    } catch(e) {}
    var gtmId = '';
    try { document.querySelectorAll('script').forEach(function(s) { var m = s.textContent.match(/GTM-[A-Z0-9]+/); if (m) gtmId = m[0]; }); } catch(e) {}

    var sd = state.sessionData;
    var score = [hasGtag, hasDL, mids.length > 0].filter(Boolean).length;
    var scoreLabel = score === 3 ? 'Implementação completa' : score >= 2 ? 'Implementação parcial' : 'Problemas detectados';
    var scoreClass = score === 3 ? 'ok' : score >= 2 ? 'warn' : 'err';

    c.innerHTML = [
      '<div class="gi-page">',

      '<div class="gi-info-card"><h3>Diagnóstico GA4</h3>',
        row('Status', '<span class="' + scoreClass + '">' + scoreLabel + ' (' + score + '/3)</span>'),
        row('gtag()', hasGtag ? '<span class="ok">✓ presente</span>' : '<span class="err">✗ ausente</span>'),
        row('dataLayer', hasDL ? '<span class="ok">✓ ' + window.dataLayer.length + ' itens</span>' : '<span class="err">✗ ausente</span>'),
        row('Measurement ID', mids.length ? '<span class="ok">' + escHTML(mids.join(', ')) + '</span>' : '<span class="warn">—</span>'),
        row('GTM Container', gtmId ? '<span class="ok">' + gtmId + '</span>' : '<span class="warn">não detectado</span>'),
        row('Interceptação', '<span class="ok">✓ XHR + fetch ativos</span>'),
      '</div>',

      sd && sd.user ? [
        '<div class="gi-info-card"><h3>Último hit — Usuário</h3>',
          row('Client ID', escHTML(sd.user.client_id)),
          row('User ID', escHTML(sd.user.user_id)),
          row('Consent Status', escHTML(sd.user.consent)),
          row('DMA', escHTML(sd.user.dma)),
        '</div>',
        '<div class="gi-info-card"><h3>Último hit — Sessão</h3>',
          row('Session ID', escHTML(sd.session.session_id)),
          row('Session Count', escHTML(sd.session.session_count)),
          row('Session Engaged', escHTML(sd.session.session_engaged)),
          row('Engagement Time', escHTML(sd.session.engagement_time)),
          row('Hit Counter', escHTML(sd.session.hit_counter)),
        '</div>',
        '<div class="gi-info-card"><h3>Último hit — Settings</h3>',
          row('Measurement ID', escHTML(sd.settings.measurement_id)),
          row('GTM Hash', escHTML(sd.settings.gtm_hash)),
          row('Protocol', escHTML(sd.settings.protocol)),
          row('Debug Mode', escHTML(sd.settings.debug_mode)),
        '</div>',
      ].join('') : '',

      '<div class="gi-info-card"><h3>Página</h3>',
        row('URL', escHTML(location.href.substring(0, 60)) + (location.href.length > 60 ? '…' : '')),
        row('Título', escHTML(document.title.substring(0, 50))),
        row('Referrer', escHTML(document.referrer || '(direto)')),
        row('Canonical', escHTML((document.querySelector('link[rel=canonical]') || {}).href || '—')),
      '</div>',

      '<div class="gi-info-card"><h3>Ambiente</h3>',
        row('Viewport', window.innerWidth + '×' + window.innerHeight),
        row('Tela', screen.width + '×' + screen.height),
        row('Idioma', navigator.language),
        row('Conexão', ((navigator.connection || {}).effectiveType || '—')),
        row('Cookies', navigator.cookieEnabled ? '<span class="ok">habilitados</span>' : '<span class="err">bloqueados</span>'),
      '</div>',

      '</div>',
    ].join('');
  }

  function row(k, v) {
    return '<div class="gi-info-row"><span class="gi-info-k">' + k + '</span><span class="gi-info-v">' + v + '</span></div>';
  }

  // Render inicial
  renderFeed();
  renderPage();

})();
