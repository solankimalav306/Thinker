// Runs INSIDE the sealed frame for a full web page that an AI wrote. This shell only waits for the page, builds
// it with a small helper in front, and gets out of the way. The page itself can run scripts; what it cannot do
// is reach anything: the frame has no network, no same-origin access to the app, and cannot navigate away.
(function () {
  "use strict";

  // Put in front of the page. It is the only thing the page is given: tk.state, tk.save, and a few messages back.
  function helper(config) {
    return '<script>(function(){"use strict";var P=window.parent,C=' + JSON.stringify(config).replace(/</g, "\\u003c") + ";" +
      'function post(m){P.postMessage(m,"*")}' +
      'var saveTimer=null;window.tk={state:C.state||{},save:function(v){try{var t=JSON.stringify(v);if(t.length>200000)return;this.state=JSON.parse(t)}catch(e){return}' +
      'clearTimeout(saveTimer);saveTimer=setTimeout(function(){post({type:"state",value:window.tk.state})},400)},' +
      'copy:function(t){post({type:"action",action:"copy",text:String(t).slice(0,5000)})}};' +
      'var tokens=C.tokens||{};function apply(t){Object.keys(t||{}).forEach(function(k){var v=t[k];if(/^--tk-[a-z0-9-]+$/.test(k)&&typeof v==="string"&&v.length<80&&!/[;{}]/.test(v))document.documentElement.style.setProperty(k,v)});if(t&&(t["--tk-scheme"]==="dark"||t["--tk-scheme"]==="light"))document.documentElement.style.colorScheme=t["--tk-scheme"]}' +
      "apply(tokens);" +
      'window.addEventListener("message",function(e){if(e.source!==P)return;var d=e.data||{};if(d.type==="theme")apply(d.tokens)});' +
      // the app removes a page that stops answering, so a runaway loop cannot freeze the window
      'setInterval(function(){post({type:"beat"})},2000);post({type:"beat"});' +
      'function measure(){post({type:"height",value:Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0))})}' +
      'if(typeof ResizeObserver==="function")new ResizeObserver(measure).observe(document.documentElement);' +
      'function cites(){document.querySelectorAll("[data-cite]").forEach(function(n){var c=n.getAttribute("data-cite")||"";if(n.textContent.indexOf("|")>=0)n.textContent="Page "+c.slice(c.lastIndexOf("|")+1);if((C.bad||[]).indexOf(c)>=0){n.style.textDecoration="underline dashed";n.title="Could not be checked against the sources";n.removeAttribute("data-cite")}})}document.addEventListener("DOMContentLoaded",cites);' +
      'window.addEventListener("load",function(){cites();try{if(window.TKComponents&&document.body)window.TKComponents.mathify(document.body)}catch(e){}measure()});' +
      // a link never takes the frame anywhere; a citation chip asks the app to open the page
      'document.addEventListener("click",function(e){var n=e.target&&e.target.closest?e.target.closest("[data-cite]"):null;var a=e.target&&e.target.closest?e.target.closest("a"):null;if(a)e.preventDefault();if(!n)return;e.preventDefault();post({type:"action",cite:n.getAttribute("data-cite")})},true);' +
      'window.addEventListener("error",function(){post({type:"error",reason:"script"})});' +
      "})();<\/script>" +
      '<script src="katex.min.js"><\/script><script src="artifact-components.js"><\/script>' +
      (config.css ? "<style>" + String(config.css).replace(/<\/style/gi, "") + "</style>" : "");
  }

  function build(html, config) {
    var front = helper(config);
    var head = /<head[^>]*>/i.exec(html);
    if (head) return html.slice(0, head.index + head[0].length) + front + html.slice(head.index + head[0].length);
    var root = /<html[^>]*>/i.exec(html);
    if (root) return html.slice(0, root.index + root[0].length) + "<head>" + front + "</head>" + html.slice(root.index + root[0].length);
    return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" + front +
      "<style>body{margin:0;background:var(--tk-bg);color:var(--tk-text);font-family:system-ui,sans-serif}</style></head><body>" + html + "</body></html>";
  }

  var started = false;
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || started) return;
    var data = event.data || {};
    if (data.type !== "run" || typeof data.html !== "string") return;
    started = true;
    var page = build(data.html.slice(0, 200000), { state: data.state, tokens: data.tokens, css: data.css, bad: Array.isArray(data.bad) ? data.bad.slice(0, 500) : [] });
    document.open();
    document.write(page);
    document.close();
  });
  window.parent.postMessage({ type: "ready" }, "*");
})();
