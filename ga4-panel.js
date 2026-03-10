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

  var STORAGE_KEY = '__ga4ins_events__';
  var MONO = "'Consolas','Courier New',monospace";
  var SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";

  // ── ESTADO ────────────────────────────────────────────────────────────────
  var state = { events: [], counts: {}, sessionData: {}, pageStart: Date.now() };

  try {
    var stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      var parsed = JSON.parse(stored);
      state.events      = parsed.events      || [];
      state.counts      = parsed.counts      || {};
      state.sessionData = parsed.sessionData || {};
    }
  } catch(e) {}

  function saveToStorage() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ events: state.events.slice(-500), counts: state.counts, sessionData: state.sessionData })); } catch(e) {}
  }
  window.addEventListener('beforeunload', saveToStorage);

  // ── PARSE ─────────────────────────────────────────────────────────────────
  function parseGA4Hit(url, body) {
    var params = {};
    try { new URL(url).searchParams.forEach(function(v,k){ params[k]=v; }); } catch(e) {}
    var hits = (body ? String(body) : '').split('\n').filter(Boolean);
    if (!hits.length) hits = [''];
    return hits.map(function(hitBody) {
      var hp = Object.assign({}, params);
      hitBody.split('&').forEach(function(pair) {
        var idx = pair.indexOf('=');
        if (idx > -1) { try { hp[decodeURIComponent(pair.slice(0,idx))] = decodeURIComponent(pair.slice(idx+1).replace(/\+/g,' ')); } catch(e) {} }
      });
      return hp;
    });
  }

  // ── BUILD EVENT ───────────────────────────────────────────────────────────
  function buildEvent(hp) {
    var name = hp['en'] || hp['t'] || 'unknown';

    // Parâmetros de evento (ep.* e epn.*) + quaisquer outros não-sistema
    var systemKeys = /^(v|tid|gtm|cid|uid|gcs|dcs|dma|sid|sct|seg|_et|_s|_dbg|en|t|dl|dt|dr|ul|sr|vp|je|sd|fl|de|_p|_fv|_nsi|ecid|pscdl|are|frm|npa|tfd|tcfd|tag_exp|_eu|epv|gcs|dcs)$/;
    var eventParams = {};
    Object.keys(hp).forEach(function(k) {
      if (k.indexOf('ep.')  === 0) eventParams[k.slice(3)]  = hp[k];
      if (k.indexOf('epn.') === 0) eventParams[k.slice(4)]  = hp[k];
      // parâmetros avulsos do evento que não são sistema (ex: query_id vem solto em ad_impression)
      if (!systemKeys.test(k) && k.indexOf('ep.') !== 0 && k.indexOf('epn.') !== 0 && k.indexOf('pr') !== 0) {
        // só adiciona se não for já coberto
        if (k !== 'en' && k !== 't') eventParams[k] = hp[k];
      }
    });

    var ev = {
      name: name,
      params: eventParams,
      rawParams: hp,

      // Aba "Evento"
      eventInfo: {
        name:           name,
        type:           guessType(name),
        trigger:        guessTrigger(name),
        doc_location:   hp['dl']  || location.href,
        doc_title:      hp['dt']  || document.title,
        page:           location.pathname,
        page_full:      location.href,
        random_page_hash: hp['_p'] || '—',
        event_usage:    hp['_eu'] || hp['epv'] || '—',
      },

      // Aba "Usuário"
      user: {
        client_id:        hp['cid']   || '—',
        user_id:          hp['uid']   || '—',
        consent_status:   hp['gcs']   || '—',
        consent_default:  hp['dcs']   || '—',
        dma:              hp['dma']   || '—',
        ecid:             hp['ecid']  || '—',
        pscdl:            hp['pscdl'] || '—',
      },

      // Aba "Sessão"
      session: {
        session_id:       hp['sid']  || '—',
        session_count:    hp['sct']  || '—',
        session_engaged:  hp['seg']  || '—',
        engagement_time:  hp['_et']  || '—',
        hit_counter:      hp['_s']   || '—',
      },

      // Aba "Settings"
      settings: {
        measurement_id:   hp['tid']      || '—',
        gtm_hash:         hp['gtm']      || '—',
        protocol:         hp['v']        || '—',
        event_usage:      hp['_eu']      || '—',
        random_page_hash: hp['_p']       || '—',
        user_language:    hp['ul']       || navigator.language || '—',
        screen_res:       hp['sr']       || '—',
        viewport:         hp['vp']       || '—',
        debug_mode:       hp['_dbg']     ? 'sim' : 'não',
        are:              hp['are']      || '—',
        frm:              hp['frm']      || '—',
        npa:              hp['npa']      || '—',
        tag_exp:          hp['tag_exp']  || '—',
        tfd:              hp['tfd']      || '—',
        tcfd:             hp['tcfd']     || '—',
      },

      time:    new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      ms:      Date.now(),
      status:  'fired',
      issues:  [],
      type:    guessType(name),
      trigger: guessTrigger(name),
      page:    location.pathname,
      source:  'network',
    };

    ev.issues = validateEvent(ev);
    if (ev.issues.length) ev.status = 'error';
    return ev;
  }

  function ingestHit(url, body) {
    if (!url) return;
    if (url.indexOf('google-analytics.com') === -1 && url.indexOf('analytics.google.com') === -1) return;
    if (url.indexOf('/collect') === -1) return;
    parseGA4Hit(url, body).forEach(function(hp) {
      if (!hp['en'] && !hp['t']) return;
      var ev = buildEvent(hp);
      var prev = state.counts[ev.name] || 0;
      if (prev > 0 && ev.status !== 'error') ev.status = 'dupe';
      state.counts[ev.name] = prev + 1;
      if (ev.user.client_id !== '—') state.sessionData = { user: ev.user, session: ev.session, settings: ev.settings };
      state.events.push(ev);
      renderIfActive();
    });
  }

  // ── INTERCEPTADORES ───────────────────────────────────────────────────────
  if (!window.__ga4ins_xhr__) {
    var OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      var xhr = new OrigXHR(), _url = '';
      var oo = xhr.open, os2 = xhr.send;
      xhr.open = function(m,u){ _url=u; return oo.apply(xhr,arguments); };
      xhr.send = function(b){ ingestHit(_url,b); return os2.apply(xhr,arguments); };
      return xhr;
    };
    window.__ga4ins_xhr__ = true;
  }

  if (!window.__ga4ins_fetch__) {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input==='string' ? input : (input&&input.url)||'';
      ingestHit(url, init&&init.body ? init.body : '');
      return origFetch.apply(this, arguments);
    };
    window.__ga4ins_fetch__ = true;
  }

  if (!window.__ga4ins_beacon__ && navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      var body = '';
      if (data) {
        if (typeof data === 'string') body = data;
        else if (data instanceof URLSearchParams) body = data.toString();
      }
      ingestHit(url, body);
      return origBeacon(url, data);
    };
    window.__ga4ins_beacon__ = true;
  }

  if (typeof window.gtag === 'function' && !window.__ga4ins_gtag__) {
    var _gtag = window.gtag;
    window.gtag = function() {
      if (arguments[0]==='event') addSyntheticEvent(arguments[1], arguments[2]||{}, 'gtag');
      return _gtag.apply(this, arguments);
    };
    window.__ga4ins_gtag__ = true;
  }

  if (Array.isArray(window.dataLayer) && !window.__ga4ins_dl__) {
    var _dlPush = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function() {
      for (var i=0;i<arguments.length;i++) {
        var item=arguments[i];
        if (item&&typeof item==='object'&&item.event&&!/^gtm\./.test(item.event)) {
          var p=Object.assign({},item); delete p.event;
          addSyntheticEvent(item.event, p, 'dataLayer');
        }
      }
      return _dlPush.apply(this, arguments);
    };
    window.__ga4ins_dl__ = true;
  }

  function addSyntheticEvent(name, params, source) {
    var recent = state.events.filter(function(e){ return e.name===name&&e.source==='network'&&(Date.now()-e.ms)<2000; });
    if (recent.length) return;
    var ev = {
      name: name, params: params||{}, rawParams: params||{},
      eventInfo: { name:name, type:guessType(name), trigger:guessTrigger(name), doc_location:location.href, doc_title:document.title, page:location.pathname, page_full:location.href, random_page_hash:'—', event_usage:'—' },
      user:    { client_id:'('+source+')', user_id:'—', consent_status:'—', consent_default:'—', dma:'—', ecid:'—', pscdl:'—' },
      session: { session_id:'—', session_count:'—', session_engaged:'—', engagement_time:'—', hit_counter:'—' },
      settings:{ measurement_id:'—', gtm_hash:'—', protocol:'—', event_usage:'—', random_page_hash:'—', user_language:'—', screen_res:'—', viewport:'—', debug_mode:'—', are:'—', frm:'—', npa:'—', tag_exp:'—', tfd:'—', tcfd:'—' },
      time: new Date().toLocaleTimeString('pt-BR',{hour12:false}), ms:Date.now(), status:'fired', issues:[],
      type:guessType(name), trigger:guessTrigger(name), page:location.pathname, source:source,
    };
    ev.issues = validateEvent(ev);
    if (ev.issues.length) ev.status = 'error';
    var prev = state.counts[name]||0;
    if (prev>0&&ev.status!=='error') ev.status='dupe';
    state.counts[name]=prev+1;
    state.events.push(ev);
    renderIfActive();
  }

  // ── AUDITORIA ─────────────────────────────────────────────────────────────
  function runAudit() {
    var found = {};
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach(function(item) {
        if (item&&item.event&&!/^gtm\./.test(item.event)) {
          found[item.event]=found[item.event]||{sources:[]};
          if (found[item.event].sources.indexOf('dataLayer')===-1) found[item.event].sources.push('dataLayer');
        }
      });
    }
    Array.from(document.querySelectorAll('script:not([src])')).forEach(function(s) {
      var text=s.textContent||'';
      var re1=/gtag\s*\(\s*['"]event['"]\s*,\s*['"]([^'"]+)['"]/g, m;
      while((m=re1.exec(text))!==null){ found[m[1]]=found[m[1]]||{sources:[]}; if(found[m[1]].sources.indexOf('script')===-1) found[m[1]].sources.push('script'); }
      var re2=/['"]event['"]\s*:\s*['"]([^'"]+)['"]/g;
      while((m=re2.exec(text))!==null){ if(/^gtm\./.test(m[1]))continue; found[m[1]]=found[m[1]]||{sources:[]}; if(found[m[1]].sources.indexOf('script')===-1) found[m[1]].sources.push('script'); }
    });
    var knownEvents=['page_view','scroll','click','view_item','purchase','add_to_cart','begin_checkout','search','login','sign_up','user_engagement','session_start','first_visit','video_start','video_complete','file_download','form_submit','ad_impression'];
    try {
      if (window.google_tag_manager) {
        var str=JSON.stringify(window.google_tag_manager);
        knownEvents.forEach(function(n){ if(str.indexOf('"'+n+'"')!==-1){ found[n]=found[n]||{sources:[]}; if(found[n].sources.indexOf('GTM')===-1) found[n].sources.push('GTM'); } });
      }
    } catch(e) {}
    var mids=[],gtmIds=[];
    try {
      document.querySelectorAll('script[src]').forEach(function(s){ var m=s.src.match(/id=(G-[A-Z0-9]+)/); if(m&&mids.indexOf(m[1])===-1) mids.push(m[1]); var g=s.src.match(/GTM-[A-Z0-9]+/); if(g&&gtmIds.indexOf(g[0])===-1) gtmIds.push(g[0]); });
      document.querySelectorAll('script').forEach(function(s){ var m=s.textContent.match(/GTM-[A-Z0-9]+/g); if(m) m.forEach(function(id){ if(gtmIds.indexOf(id)===-1) gtmIds.push(id); }); });
    } catch(e) {}
    return { events:found, mids:mids, gtmIds:gtmIds };
  }

  // ── VALIDATORS / CLASSIFIERS ──────────────────────────────────────────────
  var REQUIRED = {
    purchase:['transaction_id','value','currency'], add_to_cart:['currency','value'],
    begin_checkout:['currency','value'], view_item:['currency','value'],
    login:['method'], sign_up:['method'], search:['search_term']
  };
  function validateEvent(ev) {
    var issues=[];
    (REQUIRED[ev.name]||[]).forEach(function(p){ if(ev.params[p]===undefined||ev.params[p]==='') issues.push('Parâmetro obrigatório ausente: '+p); });
    if(ev.params.value!==undefined&&isNaN(Number(ev.params.value))) issues.push('"value" deve ser número');
    if(ev.params.currency!==undefined&&!/^[A-Z]{3}$/.test(String(ev.params.currency))) issues.push('"currency" deve ser código ISO (ex: BRL)');
    return issues;
  }
  function guessType(name) {
    if(/page_view|screen_view|first_visit/.test(name)) return 'pageview';
    if(/click|select/.test(name)) return 'click';
    if(/scroll/.test(name)) return 'scroll';
    if(/video/.test(name)) return 'video';
    if(/form|submit/.test(name)) return 'form';
    if(/purchase|add_to_cart|begin_checkout|view_item/.test(name)) return 'ecom';
    if(/ad_impression|ad_click/.test(name)) return 'ad';
    if(/user_engagement|session_start|first_open/.test(name)) return 'auto';
    return 'custom';
  }
  function guessTrigger(name) {
    if(/page_view|first_visit|session_start/.test(name)) return 'Pageview automático';
    if(/scroll/.test(name)) return 'Scroll depth';
    if(/video/.test(name)) return 'Interação com vídeo';
    if(/click/.test(name)) return 'Clique';
    if(/form|submit/.test(name)) return 'Envio de formulário';
    if(/search/.test(name)) return 'Busca';
    if(/purchase|checkout/.test(name)) return 'E-commerce';
    if(/user_engagement/.test(name)) return 'Engajamento (timer automático)';
    if(/ad_impression/.test(name)) return 'Impressão de anúncio (passivo / sendBeacon)';
    if(/exception|error/.test(name)) return 'Erro / exceção';
    return 'Evento customizado / GTM';
  }

  var TYPE_COLORS = { pageview:'#166534', click:'#1e40af', scroll:'#92400e', video:'#9f1239', form:'#5b21b6', ecom:'#7c2d12', ad:'#831843', auto:'#374151', custom:'#1f2937' };
  var TYPE_BG     = { pageview:'#dcfce7', click:'#dbeafe', scroll:'#fef3c7', video:'#ffe4e6', form:'#ede9fe', ecom:'#ffedd5', ad:'#fce7f3', auto:'#f1f5f9', custom:'#f3f4f6' };
  var TYPE_LABELS = { pageview:'Pageview', click:'Click', scroll:'Scroll', video:'Video', form:'Form', ecom:'E-com', ad:'Ad', auto:'Auto', custom:'Custom' };
  var STATUS_COLORS = { fired:'#166534', error:'#991b1b', dupe:'#92400e' };
  var STATUS_BG     = { fired:'#dcfce7', error:'#fee2e2', dupe:'#fef3c7' };
  var STATUS_LABELS = { fired:'OK', error:'ERRO', dupe:'DUPLICATA' };

  // ── CSS ───────────────────────────────────────────────────────────────────
  var styleEl = document.createElement('style');
  styleEl.id  = '__ga4ins_style__';
  styleEl.textContent = [
    '#__ga4ins__{all:initial;position:fixed;top:14px;right:14px;width:540px;max-height:92vh;',
    'background:#374151;border:1px solid #4b5563;border-radius:10px;z-index:2147483647;',
    'font-family:'+SANS+';font-size:13px;color:#111827;',
    'box-shadow:0 20px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;',
    'overflow:hidden;resize:both;min-width:360px;min-height:200px}',
    '#__ga4ins__ *{box-sizing:border-box;margin:0;padding:0}',

    '#gi-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;',
    'background:#1f2937;border-bottom:1px solid #4b5563;cursor:move;user-select:none;flex-shrink:0}',
    '.gi-logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:#f9fafb}',
    '.gi-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;animation:gi-p 1.5s ease-in-out infinite}',
    '@keyframes gi-p{0%,100%{opacity:1}50%{opacity:.3}}',
    '.gi-hdr-r{display:flex;align-items:center;gap:6px}',
    '.gi-counter{font-family:'+MONO+';font-size:11px;color:#9ca3af;padding:3px 8px;background:#374151;border:1px solid #4b5563;border-radius:3px}',
    '.gi-hbtn{background:#374151;border:1px solid #4b5563;color:#e5e7eb;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:'+MONO+';transition:background .15s}',
    '.gi-hbtn:hover{background:#4b5563}',

    '#gi-tabs{display:flex;background:#1f2937;border-bottom:1px solid #374151;flex-shrink:0}',
    '.gi-tab{flex:1;padding:9px 2px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.4px;',
    'color:#6b7280;cursor:pointer;border:none;background:transparent;border-bottom:2px solid transparent;',
    'transition:all .15s;text-transform:uppercase;font-family:'+MONO+';white-space:nowrap;position:relative}',
    '.gi-tab:hover:not(.on){color:#9ca3af}',
    '.gi-tab.on{color:#60a5fa;border-bottom-color:#60a5fa}',
    '.gi-tab-badge{position:absolute;top:3px;right:2px;background:#f87171;color:#fff;font-size:8px;font-weight:800;min-width:14px;height:14px;border-radius:7px;display:none;align-items:center;justify-content:center;padding:0 3px}',

    '#gi-filter{padding:8px 12px;background:#374151;border-bottom:1px solid #4b5563;display:flex;gap:6px;align-items:center;flex-shrink:0}',
    '#gi-filter input{flex:1;background:#fff;border:1px solid #d1d5db;color:#111827;padding:6px 10px;border-radius:4px;font-size:12px;outline:none;font-family:'+MONO+'}',
    '#gi-filter input::placeholder{color:#9ca3af}',
    '#gi-filter input:focus{border-color:#60a5fa;box-shadow:0 0 0 2px rgba(96,165,250,.25)}',

    '#gi-body{flex:1;overflow-y:auto;min-height:0;background:#f9fafb}',
    '#gi-body::-webkit-scrollbar{width:5px}',
    '#gi-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}',
    '.gi-panel{display:none}.gi-panel.on{display:block}',

    '.gi-empty{padding:48px 20px;text-align:center;color:#9ca3af;font-family:'+MONO+';font-size:12px;line-height:2.4}',
    '.gi-empty-icon{font-size:36px;margin-bottom:10px;display:block}',

    // Event card
    '.gi-ev{border-bottom:1px solid #e5e7eb;background:#fff;animation:gi-in .15s ease}',
    '.gi-ev:hover{background:#f9fafb}',
    '@keyframes gi-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}',
    '.gi-ev-top{display:flex;align-items:center;gap:6px;padding:9px 12px 4px}',
    '.gi-ev-name{flex:1;font-weight:700;font-size:13px;color:#111827;font-family:'+MONO+';word-break:break-all}',
    '.gi-ev-time{font-family:'+MONO+';font-size:10px;color:#9ca3af;flex-shrink:0}',
    '.gi-ev-trigger{padding:0 12px 4px;font-size:11px;color:#6b7280;font-family:'+MONO+'}',
    '.gi-ev-issues{padding:2px 12px 5px;font-size:11px;color:#b91c1c;font-family:'+MONO+'}',
    '.gi-tag{font-family:'+MONO+';font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;flex-shrink:0;letter-spacing:.3px;text-transform:uppercase;border:1px solid transparent}',

    // Expand
    '.gi-expand-btn{padding:3px 12px 8px;font-size:11px;color:#6b7280;cursor:pointer;font-family:'+MONO+';transition:color .15s}',
    '.gi-expand-btn:hover{color:#1d4ed8}',
    '.gi-params{display:none;background:#f9fafb;border-top:1px solid #e5e7eb}',
    '.gi-params.open{display:block}',

    // Sub-tabs do card
    '.gi-ev-tabs{display:flex;gap:0;border-bottom:1px solid #e5e7eb;background:#f3f4f6;overflow-x:auto}',
    '.gi-ev-tab{font-size:10px;font-weight:700;padding:7px 10px;cursor:pointer;font-family:'+MONO+';',
    'color:#6b7280;border:none;background:transparent;border-bottom:2px solid transparent;',
    'transition:all .15s;white-space:nowrap}',
    '.gi-ev-tab.on{color:#1d4ed8;border-bottom-color:#1d4ed8;background:#fff}',
    '.gi-ev-tab:hover:not(.on){color:#374151;background:#e5e7eb}',
    '.gi-ev-section{display:none;padding:10px 12px}',
    '.gi-ev-section.on{display:block}',

    // Tabela
    '.gi-ptable{width:100%;border-collapse:collapse;font-family:'+MONO+';font-size:11px}',
    '.gi-ptable tr{border-bottom:1px solid #f3f4f6}',
    '.gi-ptable tr:last-child{border:none}',
    '.gi-ptable td{padding:5px 6px;vertical-align:top;color:#111827}',
    '.gi-ptable td:first-child{color:#6d28d9;white-space:nowrap;width:42%;font-weight:600;padding-right:10px}',
    '.gi-ptable td:last-child{color:#1f2937;word-break:break-all}',
    '.gi-ptable tr.missing td{color:#b91c1c}',
    '.gi-ptable .empty-row td{color:#9ca3af;font-style:italic}',
    '.gi-ptable tr.dim td{color:#9ca3af}',
    '.gi-ptable td.mono{font-family:'+MONO+'}',

    // Seção de evento (aba Evento)
    '.gi-ev-info-table{width:100%;border-collapse:collapse;font-family:'+MONO+';font-size:11px}',
    '.gi-ev-info-table tr{border-bottom:1px solid #f3f4f6}',
    '.gi-ev-info-table tr:last-child{border:none}',
    '.gi-ev-info-table td{padding:5px 6px;vertical-align:top}',
    '.gi-ev-info-table td:first-child{color:#6b7280;width:38%;font-weight:600;padding-right:10px;white-space:nowrap}',
    '.gi-ev-info-table td:last-child{color:#111827;word-break:break-all;font-family:'+MONO+'}',
    '.gi-loc-val{color:#1d4ed8!important;text-decoration:none}',

    // Inner sections (resumo, qa, etc)
    '.gi-inner{padding:14px}',
    '.gi-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}',
    '.gi-stat{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px 8px;text-align:center}',
    '.gi-stat-val{font-size:26px;font-weight:800;font-family:'+MONO+';line-height:1}',
    '.gi-stat-lbl{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:#6b7280;margin-top:5px;font-family:'+MONO+'}',
    '.gi-sec-hd{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;font-family:'+MONO+';margin-bottom:10px}',

    '.gi-rank-item{padding:6px 0;border-bottom:1px solid #f3f4f6}',
    '.gi-rank-item:last-child{border:none}',
    '.gi-rank-row{display:flex;align-items:center;gap:7px;margin-bottom:3px}',
    '.gi-rank-n{font-family:'+MONO+';font-size:10px;color:#9ca3af;width:16px;flex-shrink:0}',
    '.gi-rank-name{flex:1;font-size:11px;font-family:'+MONO+';color:#1f2937;font-weight:600}',
    '.gi-rank-count{font-family:'+MONO+';font-size:11px;font-weight:700;color:#5b21b6}',
    '.gi-rank-pct{font-size:10px;color:#9ca3af;font-family:'+MONO+';min-width:32px;text-align:right}',
    '.gi-bar-bg{height:3px;background:#e5e7eb;border-radius:2px}',
    '.gi-bar-fg{height:3px;background:linear-gradient(90deg,#5b21b6,#1d4ed8);border-radius:2px}',

    '.gi-qa-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}',
    '.gi-issue-card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:8px}',
    '.gi-issue-hd{display:flex;align-items:center;gap:7px;margin-bottom:5px}',
    '.gi-issue-name{flex:1;font-weight:700;font-size:12px;font-family:'+MONO+';color:#111827}',
    '.gi-issue-body{font-size:11px;color:#4b5563;font-family:'+MONO+';line-height:1.7}',

    '.gi-tl-track{position:relative;padding-left:26px}',
    '.gi-tl-spine{position:absolute;left:7px;top:8px;bottom:0;width:2px;background:#e5e7eb}',
    '.gi-tl-row{position:relative;padding:5px 0;display:flex;align-items:flex-start;gap:10px}',
    '.gi-tl-node{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:2px;position:absolute;left:-19px;border:2px solid #f9fafb}',
    '.gi-tl-content{flex:1}',
    '.gi-tl-name{font-size:12px;font-weight:700;color:#111827;font-family:'+MONO+'}',
    '.gi-tl-meta{font-size:10px;color:#6b7280;font-family:'+MONO+';margin-top:2px}',
    '.gi-tl-page{font-size:10px;color:#1d4ed8;font-family:'+MONO+';margin-top:1px}',
    '.gi-tl-err{font-size:10px;color:#b91c1c;font-family:'+MONO+';margin-top:2px}',

    '.gi-audit-item{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;margin-bottom:7px;display:flex;align-items:center;gap:8px}',
    '.gi-audit-item.fired-item{border-left:3px solid #16a34a}',
    '.gi-audit-item.pending-item{border-left:3px solid #9ca3af}',
    '.gi-audit-name{flex:1;font-size:12px;font-weight:700;font-family:'+MONO+';color:#111827}',
    '.gi-audit-src{font-size:10px;color:#6b7280;font-family:'+MONO+'}',

    '.gi-info-card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:10px}',
    '.gi-info-card h3{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;font-family:'+MONO+';margin-bottom:10px}',
    '.gi-info-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f9fafb;font-size:11px}',
    '.gi-info-row:last-child{border:none}',
    '.gi-info-k{color:#6b7280;font-family:'+MONO+';flex-shrink:0;margin-right:12px}',
    '.gi-info-v{color:#1f2937;font-family:'+MONO+';text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;font-weight:600}',
    '.c-ok{color:#166534!important}',
    '.c-warn{color:#92400e!important}',
    '.c-err{color:#991b1b!important}',
  ].join('');
  document.head.appendChild(styleEl);

  // ── HTML ──────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = '__ga4ins__';
  panel.innerHTML = [
    '<div id="gi-hdr">',
      '<div class="gi-logo"><span class="gi-dot"></span>GA4 Inspector</div>',
      '<div class="gi-hdr-r">',
        '<span class="gi-counter" id="gi-counter">0 eventos</span>',
        '<button class="gi-hbtn" id="gi-clear">limpar</button>',
        '<button class="gi-hbtn" id="gi-export">exportar</button>',
        '<button class="gi-hbtn" id="gi-close">✕</button>',
      '</div>',
    '</div>',
    '<div id="gi-tabs">',
      '<button class="gi-tab on" data-t="feed">📡 Feed</button>',
      '<button class="gi-tab" data-t="audit">🔍 Auditoria</button>',
      '<button class="gi-tab" data-t="sum">📊 Resumo</button>',
      '<button class="gi-tab" data-t="qa">🔬 QA<span class="gi-tab-badge" id="qa-badge"></span></button>',
      '<button class="gi-tab" data-t="tl">⏱ Timeline</button>',
      '<button class="gi-tab" data-t="page">🔎 Página</button>',
    '</div>',
    '<div id="gi-filter"><input type="text" id="gi-search" placeholder="filtrar por nome de evento..." /></div>',
    '<div id="gi-body">',
      '<div class="gi-panel on" id="gp-feed"><div class="gi-empty" id="gi-empty"><span class="gi-empty-icon">📡</span>Aguardando eventos GA4...<br>Interaja com a página.</div></div>',
      '<div class="gi-panel" id="gp-audit"></div>',
      '<div class="gi-panel" id="gp-sum"></div>',
      '<div class="gi-panel" id="gp-qa"></div>',
      '<div class="gi-panel" id="gp-tl"></div>',
      '<div class="gi-panel" id="gp-page"></div>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  // ── CONTROLES ─────────────────────────────────────────────────────────────
  var filterText = '';
  panel.querySelectorAll('.gi-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      panel.querySelectorAll('.gi-tab').forEach(function(t){t.classList.remove('on');});
      panel.querySelectorAll('.gi-panel').forEach(function(p){p.classList.remove('on');});
      tab.classList.add('on');
      var t = tab.dataset.t;
      document.getElementById('gp-'+t).classList.add('on');
      document.getElementById('gi-filter').style.display = t==='feed'?'flex':'none';
      ({audit:renderAudit, sum:renderSummary, qa:renderQA, tl:renderTimeline, page:renderPage})[t] && ({audit:renderAudit, sum:renderSummary, qa:renderQA, tl:renderTimeline, page:renderPage})[t]();
    });
  });
  document.getElementById('gi-search').addEventListener('input', function(e){ filterText=e.target.value.toLowerCase(); renderFeed(); });
  document.getElementById('gi-close').addEventListener('click', function(){ saveToStorage(); panel.remove(); styleEl.remove(); window.__ga4ins_active__=false; });
  document.getElementById('gi-clear').addEventListener('click', function(){
    state.events=[]; state.counts={}; state.sessionData={};
    try{sessionStorage.removeItem(STORAGE_KEY);}catch(e){}
    document.getElementById('qa-badge').style.display='none';
    document.getElementById('gi-counter').textContent='0 eventos';
    renderFeed();
  });
  document.getElementById('gi-export').addEventListener('click', function(){
    var blob=new Blob([JSON.stringify(state.events,null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ga4-events-'+Date.now()+'.json'; a.click();
  });
  var drag=false,ox=0,oy=0;
  document.getElementById('gi-hdr').addEventListener('mousedown', function(e){ drag=true; ox=e.clientX-panel.getBoundingClientRect().left; oy=e.clientY-panel.getBoundingClientRect().top; });
  document.addEventListener('mousemove', function(e){ if(!drag)return; panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.right='auto'; });
  document.addEventListener('mouseup', function(){ drag=false; });

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function mkTag(label,color,bg){ return '<span class="gi-tag" style="background:'+bg+';color:'+color+';border-color:'+color+'55">'+label+'</span>'; }
  function typeTag(type){ return mkTag(TYPE_LABELS[type]||type, TYPE_COLORS[type]||'#1f2937', TYPE_BG[type]||'#f3f4f6'); }
  function statusTag(status){ return mkTag(STATUS_LABELS[status]||status, STATUS_COLORS[status]||'#1f2937', STATUS_BG[status]||'#f3f4f6'); }
  function statBox(val,lbl,color){ return '<div class="gi-stat"><div class="gi-stat-val" style="color:'+color+'">'+val+'</div><div class="gi-stat-lbl">'+lbl+'</div></div>'; }
  function iRow(k,v){ return '<div class="gi-info-row"><span class="gi-info-k">'+k+'</span><span class="gi-info-v">'+v+'</span></div>'; }
  function activeTab(){ var t=panel.querySelector('.gi-tab.on'); return t?t.dataset.t:'feed'; }

  function renderIfActive(){
    document.getElementById('gi-counter').textContent=state.events.length+' evento'+(state.events.length!==1?'s':'');
    var n=state.events.filter(function(e){return e.status!=='fired';}).length;
    var badge=document.getElementById('qa-badge'); badge.style.display=n>0?'flex':'none'; badge.textContent=n;
    var t=activeTab();
    if(t==='feed') renderFeed();
    else if(t==='sum') renderSummary();
    else if(t==='qa') renderQA();
    else if(t==='tl') renderTimeline();
  }

  // ── FEED ──────────────────────────────────────────────────────────────────
  function renderFeed(){
    var feed=document.getElementById('gp-feed');
    var empty=document.getElementById('gi-empty');
    feed.querySelectorAll('.gi-ev').forEach(function(el){el.remove();});
    var filtered=state.events.filter(function(e){ return !filterText||e.name.toLowerCase().indexOf(filterText)!==-1; });
    if(!filtered.length){empty.style.display='block';return;}
    empty.style.display='none';
    var frag=document.createDocumentFragment();
    filtered.slice().reverse().forEach(function(ev){
      var div=document.createElement('div'); div.className='gi-ev';
      var pc=Object.keys(ev.params).length;
      var issueHTML=ev.issues.length?'<div class="gi-ev-issues">⚠ '+ev.issues.map(esc).join(' · ')+'</div>':'';
      var srcLabel=(ev.source&&ev.source!=='network')?' <span style="font-size:9px;color:#9ca3af;font-family:'+MONO+'">('+ev.source+')</span>':'';
      div.innerHTML=[
        '<div class="gi-ev-top">',
          typeTag(ev.type),
          '<span class="gi-ev-name">'+esc(ev.name)+srcLabel+'</span>',
          statusTag(ev.status),
          '<span class="gi-ev-time">'+ev.time+'</span>',
        '</div>',
        '<div class="gi-ev-trigger">⚡ '+esc(ev.trigger)+'</div>',
        issueHTML,
        '<div class="gi-expand-btn" data-open="0">▶ detalhes ('+pc+' parâmetros)</div>',
        '<div class="gi-params">',
          '<div class="gi-ev-tabs">',
            '<button class="gi-ev-tab on" data-s="evinfo">Evento</button>',
            '<button class="gi-ev-tab" data-s="params">Parâmetros ('+pc+')</button>',
            '<button class="gi-ev-tab" data-s="user">Usuário</button>',
            '<button class="gi-ev-tab" data-s="session">Sessão</button>',
            '<button class="gi-ev-tab" data-s="settings">Settings</button>',
          '</div>',
          buildEventInfoSection(ev),
          buildParamSection(ev),
          buildObjSection(ev.user,      'user',     ['client_id','user_id','consent_status','consent_default','dma','ecid','pscdl']),
          buildObjSection(ev.session,   'session',  ['session_id','session_count','session_engaged','engagement_time','hit_counter']),
          buildObjSection(ev.settings,  'settings', ['measurement_id','gtm_hash','protocol','event_usage','random_page_hash','user_language','screen_res','viewport','debug_mode','are','frm','npa','tag_exp','tfd','tcfd']),
        '</div>',
      ].join('');

      var btn=div.querySelector('.gi-expand-btn');
      var params=div.querySelector('.gi-params');
      btn.addEventListener('click',function(){
        var open=btn.getAttribute('data-open')==='1';
        params.classList.toggle('open',!open);
        btn.setAttribute('data-open',open?'0':'1');
        btn.textContent=open?'▶ detalhes ('+pc+' parâmetros)':'▼ ocultar detalhes';
      });
      params.querySelectorAll('.gi-ev-tab').forEach(function(t){
        t.addEventListener('click',function(){
          params.querySelectorAll('.gi-ev-tab').forEach(function(x){x.classList.remove('on');});
          params.querySelectorAll('.gi-ev-section').forEach(function(x){x.classList.remove('on');});
          t.classList.add('on');
          var sec=params.querySelector('.gi-ev-section[data-s="'+t.dataset.s+'"]');
          if(sec) sec.classList.add('on');
        });
      });
      frag.appendChild(div);
    });
    feed.appendChild(frag);
  }

  // Aba Evento
  function buildEventInfoSection(ev) {
    var ei = ev.eventInfo;
    var loc = ei.doc_location || ei.page_full || '—';
    var title = ei.doc_title || '—';
    var rows = [
      '<tr><td>Nome</td><td><strong>'+esc(ev.name)+'</strong></td></tr>',
      '<tr><td>Tipo</td><td>'+typeTag(ev.type)+'</td></tr>',
      '<tr><td>Status</td><td>'+statusTag(ev.status)+'</td></tr>',
      '<tr><td>Gatilho</td><td>'+esc(ev.trigger)+'</td></tr>',
      '<tr><td>Document Location</td><td><a class="gi-loc-val" href="'+esc(loc)+'" target="_blank" title="'+esc(loc)+'">'+esc(loc.length>55?loc.substring(0,55)+'…':loc)+'</a></td></tr>',
      '<tr><td>Document Title</td><td>'+esc(title.length>60?title.substring(0,60)+'…':title)+'</td></tr>',
      ev.issues.length ? '<tr><td>Issues</td><td style="color:#b91c1c">'+ev.issues.map(esc).join('<br>')+'</td></tr>' : '',
    ].join('');
    return '<div class="gi-ev-section on" data-s="evinfo"><table class="gi-ev-info-table">'+rows+'</table></div>';
  }

  // Aba Parâmetros
  function buildParamSection(ev) {
    var missing=ev.issues.filter(function(i){return i.indexOf('ausente:')!==-1;}).map(function(i){return i.split(': ')[1];});
    var rows=Object.keys(ev.params).map(function(k){
      var v=String(ev.params[k]);
      var cls=missing.indexOf(k)!==-1?' class="missing"':'';
      return '<tr'+cls+'><td>'+esc(k)+'</td><td>'+esc(v.length>200?v.substring(0,200)+'…':v)+'</td></tr>';
    }).join('');
    if(!rows) rows='<tr class="empty-row"><td colspan="2">Sem parâmetros de evento</td></tr>';
    return '<div class="gi-ev-section" data-s="params"><table class="gi-ptable">'+rows+'</table></div>';
  }

  // Abas Usuário / Sessão / Settings
  function buildObjSection(obj, sid, order) {
    var rows = (order||Object.keys(obj)).map(function(k){
      var v = String(obj[k]||'—');
      var dim = v==='—'?' class="dim"':'';
      return '<tr'+dim+'><td>'+esc(k)+'</td><td>'+esc(v.length>200?v.substring(0,200)+'…':v)+'</td></tr>';
    }).join('');
    return '<div class="gi-ev-section" data-s="'+sid+'"><table class="gi-ptable">'+rows+'</table></div>';
  }

  // ── AUDITORIA ─────────────────────────────────────────────────────────────
  function renderAudit(){
    var c=document.getElementById('gp-audit');
    var audit=runAudit();
    var fired=Object.keys(state.counts);
    var html='<div class="gi-inner">';
    html+='<div class="gi-info-card"><h3>Implementação detectada</h3>';
    html+=iRow('Measurement IDs',audit.mids.length?'<span class="c-ok">'+esc(audit.mids.join(', '))+'</span>':'<span class="c-warn">não encontrado</span>');
    html+=iRow('GTM Containers',audit.gtmIds.length?'<span class="c-ok">'+esc(audit.gtmIds.join(', '))+'</span>':'<span class="c-warn">não encontrado</span>');
    html+=iRow('gtag()',typeof window.gtag==='function'?'<span class="c-ok">✓ ativo</span>':'<span class="c-warn">não</span>');
    html+=iRow('dataLayer',Array.isArray(window.dataLayer)?'<span class="c-ok">✓ '+window.dataLayer.length+' itens</span>':'<span class="c-err">ausente</span>');
    html+=iRow('Interceptação','<span class="c-ok">✓ XHR + fetch + sendBeacon</span>');
    html+='</div>';
    var names=Object.keys(audit.events);
    html+='<div class="gi-sec-hd">eventos no código ('+names.length+')</div>';
    if(!names.length){html+='<div class="gi-empty" style="padding:20px">Nenhum evento encontrado.</div>';}
    else{names.sort().forEach(function(name){
      var isFired=fired.indexOf(name)!==-1;
      html+='<div class="gi-audit-item '+(isFired?'fired':'pending')+'-item">'+typeTag(guessType(name))+' <span class="gi-audit-name">'+esc(name)+'</span>'+(isFired?statusTag('fired'):mkTag('PENDENTE','#6b7280','#f3f4f6'))+'<span class="gi-audit-src">'+esc(audit.events[name].sources.join(', '))+'</span></div>';
    });}
    html+='</div>';
    c.innerHTML=html;
  }

  // ── RESUMO ────────────────────────────────────────────────────────────────
  function renderSummary(){
    var c=document.getElementById('gp-sum');
    var total=state.events.length;
    var ok=state.events.filter(function(e){return e.status==='fired';}).length;
    var bad=state.events.filter(function(e){return e.status!=='fired';}).length;
    var types=Object.keys(state.counts).length;
    var html='<div class="gi-inner"><div class="gi-stat-grid">'+statBox(total,'Total','#1d4ed8')+statBox(types,'Tipos','#5b21b6')+statBox(ok,'OK','#166534')+statBox(bad,'Problemas','#991b1b')+'</div><div class="gi-sec-hd">ranking de eventos</div>';
    var sorted=Object.entries(state.counts).sort(function(a,b){return b[1]-a[1];});
    var max=sorted.length?sorted[0][1]:1;
    sorted.forEach(function(item,i){
      var name=item[0],count=item[1],pct=total?Math.round(count/total*100):0;
      html+='<div class="gi-rank-item"><div class="gi-rank-row"><span class="gi-rank-n">'+(i+1)+'</span>'+typeTag(guessType(name))+'<span class="gi-rank-name">'+esc(name)+'</span><span class="gi-rank-count">'+count+'×</span><span class="gi-rank-pct">'+pct+'%</span></div><div class="gi-bar-bg"><div class="gi-bar-fg" style="width:'+Math.round(count/max*100)+'%"></div></div></div>';
    });
    html+='</div>';
    c.innerHTML=html;
  }

  // ── QA ────────────────────────────────────────────────────────────────────
  function renderQA(){
    var c=document.getElementById('gp-qa');
    var errors=state.events.filter(function(e){return e.issues.length>0;});
    var dupes=state.events.filter(function(e){return e.status==='dupe';});
    var ok=state.events.filter(function(e){return e.status==='fired'&&!e.issues.length;});
    var html='<div class="gi-inner"><div class="gi-qa-grid">'+statBox(ok.length,'OK','#166534')+statBox(errors.length,'Erros','#991b1b')+statBox(dupes.length,'Duplicatas','#92400e')+'</div>';
    var issues=errors.concat(dupes.filter(function(d){return errors.indexOf(d)===-1;}));
    if(!issues.length){html+='<div class="gi-empty" style="padding:24px"><span class="gi-empty-icon">✅</span>Nenhum problema detectado.</div>';}
    else{issues.forEach(function(ev){
      html+='<div class="gi-issue-card"><div class="gi-issue-hd">'+typeTag(ev.type)+'<span class="gi-issue-name">'+esc(ev.name)+'</span>'+statusTag(ev.status)+'</div>';
      html+='<div class="gi-issue-body" style="margin-bottom:4px;color:#6b7280;font-size:10px">'+esc(ev.eventInfo.doc_location.substring(0,70))+'</div>';
      html+='<div class="gi-issue-body">'+(ev.status==='dupe'?'⚠ Disparou '+state.counts[ev.name]+'× nesta sessão — possível disparo duplo.':ev.issues.map(function(i){return '• '+esc(i);}).join('<br>'))+'</div></div>';
    });}
    html+='</div>';
    c.innerHTML=html;
  }

  // ── TIMELINE ──────────────────────────────────────────────────────────────
  function renderTimeline(){
    var c=document.getElementById('gp-tl');
    if(!state.events.length){c.innerHTML='<div class="gi-empty"><span class="gi-empty-icon">⏱</span>Nenhum evento ainda.</div>';return;}
    var html='<div class="gi-inner"><div class="gi-tl-track"><div class="gi-tl-spine"></div>';
    state.events.forEach(function(ev){
      var nc=STATUS_COLORS[ev.status]||'#166534';
      var elapsed='+'+((ev.ms-state.pageStart)/1000).toFixed(1)+'s';
      var loc=ev.eventInfo?ev.eventInfo.doc_location:'';
      html+='<div class="gi-tl-row"><div class="gi-tl-node" style="background:'+nc+'"></div><div class="gi-tl-content">';
      html+='<div style="display:flex;align-items:center;gap:6px"><span class="gi-tl-name">'+esc(ev.name)+'</span>'+typeTag(ev.type)+'</div>';
      html+='<div class="gi-tl-meta">'+ev.time+' · '+elapsed+' · '+esc(ev.trigger)+'</div>';
      if(loc&&loc!==location.href) html+='<div class="gi-tl-page">📄 '+esc(loc.length>70?loc.substring(0,70)+'…':loc)+'</div>';
      if(ev.issues.length) html+='<div class="gi-tl-err">⚠ '+ev.issues.map(esc).join(' · ')+'</div>';
      html+='</div></div>';
    });
    html+='</div></div>';
    c.innerHTML=html;
  }

  // ── PÁGINA ────────────────────────────────────────────────────────────────
  function renderPage(){
    var c=document.getElementById('gp-page');
    var hasGtag=typeof window.gtag==='function';
    var hasDL=Array.isArray(window.dataLayer);
    var mids=[],gtmId='';
    try{
      document.querySelectorAll('script[src]').forEach(function(s){var m=s.src.match(/id=(G-[A-Z0-9]+)/);if(m&&mids.indexOf(m[1])===-1)mids.push(m[1]);});
      if(hasDL)window.dataLayer.forEach(function(item){if(!item)return;Object.values(item).forEach(function(v){if(typeof v==='string'&&/^G-[A-Z0-9]+$/.test(v)&&mids.indexOf(v)===-1)mids.push(v);});});
      document.querySelectorAll('script').forEach(function(s){var m=s.textContent.match(/GTM-[A-Z0-9]+/);if(m)gtmId=m[0];});
    }catch(e){}
    var score=[hasGtag,hasDL,mids.length>0].filter(Boolean).length;
    var sl=score===3?'Completa':score>=2?'Parcial':'Problemas';
    var sc=score===3?'c-ok':score>=2?'c-warn':'c-err';
    var sd=state.sessionData;
    var html='<div class="gi-inner">';
    html+='<div class="gi-info-card"><h3>Diagnóstico GA4</h3>';
    html+=iRow('Status','<span class="'+sc+'">'+sl+' ('+score+'/3)</span>');
    html+=iRow('gtag()',hasGtag?'<span class="c-ok">✓ ativo</span>':'<span class="c-err">✗ ausente</span>');
    html+=iRow('dataLayer',hasDL?'<span class="c-ok">✓ '+window.dataLayer.length+' itens</span>':'<span class="c-err">✗ ausente</span>');
    html+=iRow('Measurement ID',mids.length?'<span class="c-ok">'+esc(mids.join(', '))+'</span>':'<span class="c-warn">—</span>');
    html+=iRow('GTM Container',gtmId?'<span class="c-ok">'+gtmId+'</span>':'<span class="c-warn">—</span>');
    html+=iRow('Interceptação','<span class="c-ok">✓ XHR + fetch + sendBeacon</span>');
    html+='</div>';
    if(sd&&sd.user){
      html+='<div class="gi-info-card"><h3>Último hit — Usuário</h3>'+iRow('Client ID',esc(sd.user.client_id))+iRow('User ID',esc(sd.user.user_id))+iRow('Consent Status',esc(sd.user.consent_status))+iRow('Consent Default',esc(sd.user.consent_default))+iRow('DMA',esc(sd.user.dma))+iRow('ecid',esc(sd.user.ecid))+iRow('pscdl',esc(sd.user.pscdl))+'</div>';
      html+='<div class="gi-info-card"><h3>Último hit — Sessão</h3>'+iRow('Session ID',esc(sd.session.session_id))+iRow('Session Count',esc(sd.session.session_count))+iRow('Session Engaged',esc(sd.session.session_engaged))+iRow('Engagement Time',esc(sd.session.engagement_time)+'ms')+iRow('Hit Counter',esc(sd.session.hit_counter))+'</div>';
      html+='<div class="gi-info-card"><h3>Último hit — Settings</h3>'+iRow('Measurement ID',esc(sd.settings.measurement_id))+iRow('GTM Hash',esc(sd.settings.gtm_hash))+iRow('Protocol',esc(sd.settings.protocol))+iRow('Event Usage',esc(sd.settings.event_usage))+iRow('Random Page Hash',esc(sd.settings.random_page_hash))+iRow('User Language',esc(sd.settings.user_language))+iRow('Screen Res',esc(sd.settings.screen_res))+iRow('Debug Mode',esc(sd.settings.debug_mode))+'</div>';
    }
    html+='<div class="gi-info-card"><h3>Página atual</h3>'+iRow('URL',esc(location.href.substring(0,55))+(location.href.length>55?'…':''))+iRow('Título',esc(document.title.substring(0,50)))+iRow('Referrer',esc(document.referrer||'(direto)'))+iRow('Canonical',esc((document.querySelector('link[rel=canonical]')||{}).href||'—'))+'</div>';
    html+='<div class="gi-info-card"><h3>Ambiente</h3>'+iRow('Viewport',window.innerWidth+'×'+window.innerHeight)+iRow('Tela',screen.width+'×'+screen.height)+iRow('Idioma',navigator.language)+iRow('Conexão',((navigator.connection||{}).effectiveType||'—'))+iRow('Cookies',navigator.cookieEnabled?'<span class="c-ok">habilitados</span>':'<span class="c-err">bloqueados</span>')+'</div>';
    html+='</div>';
    c.innerHTML=html;
  }

  renderFeed();
  renderPage();

})();
