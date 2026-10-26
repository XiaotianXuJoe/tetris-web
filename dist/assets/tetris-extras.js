/* 俄羅斯方塊（對照組）· 外掛增強腳本（無需 React 源碼）
 *
 * 提供兩件事（bundle 補丁器 patch_bundle.py 負責在遊戲主循環裡調 window.TSFX）：
 *  1) TSFX 音效引擎（Web Audio 實時合成，零素材）：
 *     fall() 下落每跨一行「啾」（90ms 節流）/ lock() 落定「噠啦」 / clear() 消行「叮」
 *  2) 首輪教程：攔截首頁「開始遊戲 / 從第一階段開始」點擊（document 捕獲階段，
 *     先於 React 根節點收到事件），彈出文字+語音教程（minimax 預生成 MP3），
 *     聽完/點「開始玩」後才放行原按鈕——點擊手勢同時完成音頻解鎖。
 *
 * 「繼續遊戲」（恢復中斷會話）不彈教程。
 */
(function () {
  'use strict'

  /* ================= TSFX 音效 ================= */
  var AC = null
  var lastFall = 0

  function ctx() {
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return null
      try { AC = new Ctor() } catch (e) { return null }
    }
    if (AC.state === 'suspended') { try { AC.resume() } catch (e) { } }
    return AC
  }

  function tone(freq, startAt, dur, vol, sweepTo, type) {
    var c = ctx()
    if (!c || c.state !== 'running') return
    var t = c.currentTime + startAt
    var o = c.createOscillator()
    var g = c.createGain()
    o.type = type || 'sine'
    o.frequency.setValueAtTime(freq, t)
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(c.destination)
    o.start(t); o.stop(t + dur + 0.05)
  }

  window.TSFX = {
    unlock: function () { ctx() },
    fall: function () {  // 「啾」：短促上揚，每跨一行一次（含按住加速）
      var now = performance.now()
      if (now - lastFall < 90) return
      lastFall = now
      tone(950, 0, 0.07, 0.055, 1500, 'triangle')
    },
    lock: function () {  // 「噠啦」：落定兩音
      tone(660, 0, 0.09, 0.14, null, 'sine')
      tone(520, 0.08, 0.14, 0.14, null, 'sine')
    },
    clear: function () { // 「叮」：消行小鍾
      tone(880, 0, 0.3, 0.16, null, 'sine')
      tone(1318.5, 0.09, 0.35, 0.12, null, 'sine')
    },
  }

  /* ================= 首輪教程（文字 + 語音） ================= */
  var TUT_LINES = [
    '歡迎來到俄羅斯方塊小遊戲！等一會兒，會有小方塊從上面慢慢落下來。',
    '方塊下面的虛線，是它的推薦位置。你可以輕點螢幕左邊或右邊，幫方塊選位置。不點也沒關係，它會自己找地方落下來。',
    '如果一整行都填滿了，那一行就會消失。如果不小心堆滿了也沒關係，面板會清空，重新再來。',
    '一共要玩三輪，每一輪六分鐘，中間可以休息一分鐘。準備好了嗎？點下面的按鈕開始吧！',
  ]
  var TUT_AUDIO = TUT_LINES.map(function (_, i) { return './assets/tut/tut-' + (i + 1) + '.mp3' })
  var TUT_KEY = 'tetrisTutorialSeen' // 本次頁面會話內只彈一次（sessionStorage 不跨標籤頁）

  var SHARED = null // 共享 Audio 元素：教程點擊手勢裡解鎖，之後全程復用
  var SEQ = 0

  function sharedAudio() {
    if (!SHARED && typeof Audio !== 'undefined') { SHARED = new Audio(); SHARED.preload = 'auto' }
    return SHARED
  }

  /* 順序播放教程配音；某段加載失敗就跳過那段（文字照常顯示），絕不卡住教程 */
  function playChain(onLine) {
    var a = sharedAudio()
    if (!a) return
    var mySeq = ++SEQ
    var i = 0
    function next() {
      if (mySeq !== SEQ) return
      if (i >= TUT_AUDIO.length) return
      var idx = i++
      onLine(idx)
      a.onended = function () { next() }
      a.onerror = function () { next() }
      a.src = TUT_AUDIO[idx]
      var p = null
      try { p = a.play() } catch (e) { p = null }
      if (p && p.catch) p.catch(function () { next() })
    }
    next()
  }

  function showTutorial(resume) {
    if (document.getElementById('tt-tut-layer')) return
    var style = document.createElement('style')
    style.textContent =
      '#tt-tut-layer{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(20,16,10,.72);backdrop-filter:blur(3px);padding:20px}' +
      '#tt-tut-card{background:#fdf9ef;border-radius:22px;max-width:560px;width:100%;padding:26px 24px;box-shadow:0 18px 50px rgba(0,0,0,.35);text-align:center;font-family:inherit}' +
      '#tt-tut-card h1{margin:0 0 14px;font-size:20px;color:#5a4a2e}' +
      '#tt-tut-lines{min-height:150px;text-align:left;margin-bottom:14px}' +
      '#tt-tut-lines p{margin:0 0 10px;font-size:15px;line-height:1.75;color:#6b5c42;opacity:.35;transition:opacity .3s}' +
      '#tt-tut-lines p.on{opacity:1;font-weight:600}' +
      '#tt-tut-lines p.now{color:#b8860b}' +
      '#tt-tut-go{padding:13px 44px;font-size:17px;font-weight:700;letter-spacing:2px;color:#fff;background:linear-gradient(135deg,#e0a458,#c07a2e);border:none;border-radius:999px;cursor:pointer;box-shadow:0 6px 16px rgba(192,122,46,.35)}' +
      '#tt-tut-go:active{transform:scale(.96)}' +
      '#tt-tut-skip{margin-top:10px;font-size:12px;color:#a08d68;cursor:pointer;text-decoration:underline}'
    document.head.appendChild(style)

    var layer = document.createElement('div')
    layer.id = 'tt-tut-layer'
    layer.innerHTML =
      '<div id="tt-tut-card">' +
      '<h1>怎麼玩？</h1>' +
      '<div id="tt-tut-lines">' +
      TUT_LINES.map(function (l) { return '<p>' + l + '</p>' }).join('') +
      '</div>' +
      '<button id="tt-tut-go" type="button">開始玩 ▶</button>' +
      '<div id="tt-tut-skip">跳過講解</div>' +
      '</div>'
    document.body.appendChild(layer)

    var lines = layer.querySelectorAll('#tt-tut-lines p')
    function markLine(idx) {
      lines.forEach(function (p, i) {
        p.classList.toggle('on', i <= idx)
        p.classList.toggle('now', i === idx)
      })
    }

    if (window.TSFX) window.TSFX.unlock()
    playChain(markLine) // 打開即開始朗讀（本次打開來自真實點擊手勢）

    function finish() {
      SEQ++ // 掐斷還在播的配音
      try { if (SHARED) SHARED.pause() } catch (e) { }
      layer.remove()
      style.remove()
      try { sessionStorage.setItem(TUT_KEY, '1') } catch (e) { }
      resume()
    }
    layer.querySelector('#tt-tut-go').addEventListener('click', finish)
    layer.querySelector('#tt-tut-skip').addEventListener('click', finish)
  }

  /* 捕獲階段攔截：先於 React 根節點收到事件；攔截則阻止冒泡，原按鈕 handler 不觸發 */
  document.addEventListener('click', function (e) {
    var seen = false
    try { seen = sessionStorage.getItem(TUT_KEY) === '1' } catch (err) { }
    if (seen) return
    var btn = e.target && e.target.closest ? e.target.closest('.mode-play') : null
    if (!btn) return
    var label = btn.textContent || ''
    // 「繼續遊戲」恢復中斷會話 → 不彈教程；開始/重來 → 彈
    if (/繼續|繼續/.test(label)) return
    if (!/始/.test(label)) return
    e.preventDefault()
    e.stopPropagation()
    showTutorial(function () { btn.click() })
  }, true)
})()
