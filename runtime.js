/* PathFinder prototype runtime.
 * Renders the design screens in design/ (bundled into screens.js) with Preact:
 * {{holes}}, <sc-for>, <sc-if>, event handlers, per-screen state and
 * navigation between screens through links to "Name.dc.html".
 */
(function () {
  "use strict";
  var P = window.preact;
  var h = P.h, Fragment = P.Fragment, Component = P.Component;
  var SCREENS = window.PF_SCREENS, ORDER = window.PF_ORDER, START = window.PF_START;

  /* ---------- template values ---------- */
  var WHOLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;

  function lookup(expr, scope) {
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split(".");
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interp(str, scope) {
    var m = str.match(WHOLE);
    if (m) return lookup(m[1], scope);
    if (str.indexOf("{{") < 0) return str;
    return str.replace(HOLE, function (_, e) {
      var v = lookup(e, scope);
      return v == null ? "" : String(v);
    });
  }

  /* ---------- compile markup once into a light tree ---------- */
  function compile(node) {
    if (node.nodeType === 3) return { t: "x", v: node.nodeValue };
    if (node.nodeType !== 1) return null;
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      attrs.push([node.attributes[i].name, node.attributes[i].value]);
    }
    var kids = [];
    node.childNodes.forEach(function (c) {
      var k = compile(c);
      if (k) kids.push(k);
    });
    return { t: "e", tag: node.localName, attrs: attrs, kids: kids };
  }

  function propName(name, tag) {
    if (name.indexOf("on") === 0 && name.length > 2) {
      var ev = name.slice(2).toLowerCase();
      if (ev === "change" && (tag === "input" || tag === "textarea")) return "onInput";
      return "on" + ev;
    }
    return name;
  }

  function attr(n, name) {
    for (var i = 0; i < n.attrs.length; i++) if (n.attrs[i][0] === name) return n.attrs[i][1];
    return null;
  }

  function renderKids(kids, scope) {
    var out = [];
    for (var i = 0; i < kids.length; i++) {
      var r = renderNode(kids[i], scope);
      if (r == null) continue;
      if (Array.isArray(r)) out.push.apply(out, r);
      else out.push(r);
    }
    return out;
  }

  function renderNode(n, scope) {
    if (n.t === "x") {
      var v = interp(n.v, scope);
      return v == null ? null : String(v);
    }
    if (n.tag === "helmet") return null;
    if (n.tag === "sc-for") {
      var list = interp(attr(n, "list") || "", scope) || [];
      var as = attr(n, "as") || "item";
      var out = [];
      list.forEach(function (item, i) {
        var s = Object.create(scope);
        s[as] = item;
        s.$index = i;
        out.push.apply(out, renderKids(n.kids, s));
      });
      return out;
    }
    if (n.tag === "sc-if") {
      return interp(attr(n, "value") || "", scope) ? renderKids(n.kids, scope) : null;
    }
    var props = {};
    for (var i = 0; i < n.attrs.length; i++) {
      var name = n.attrs[i][0];
      if (name.indexOf("hint-") === 0) continue;
      var val = interp(n.attrs[i][1], scope);
      if (val === undefined) continue;
      props[propName(name, n.tag)] = val;
    }
    var kids = (n.tag === "textarea" && "value" in props) ? [] : renderKids(n.kids, scope);
    return h.apply(null, [n.tag, props].concat(kids));
  }

  /* ---------- the logic base class screens extend ---------- */
  class DCLogic extends Component {
    render() {
      var vals = this.renderVals ? this.renderVals() : {};
      var scope = Object.assign(Object.create(null), vals);
      return h.apply(null, [Fragment, null].concat(renderKids(this.constructor.__tpl, scope)));
    }
  }
  window.DCLogic = DCLogic;

  /* ---------- screens ---------- */
  var cache = {};
  function getScreen(name) {
    if (cache[name]) return cache[name];
    var s = SCREENS[name];
    var t = document.createElement("template");
    t.innerHTML = s.template;
    var tree = [];
    t.content.childNodes.forEach(function (c) {
      var k = compile(c);
      if (k) tree.push(k);
    });
    var Comp = new Function("DCLogic", s.script + "\n;return Component;")(DCLogic);
    Comp.__tpl = tree;
    var hEl = document.createElement("template");
    hEl.innerHTML = s.helmet;
    var links = Array.prototype.map.call(hEl.content.querySelectorAll("link[rel=stylesheet]"), function (l) {
      return l.getAttribute("href");
    });
    var css = Array.prototype.map.call(hEl.content.querySelectorAll("style"), function (x) {
      return x.textContent;
    }).join("\n");
    return (cache[name] = { Comp: Comp, links: links, css: css, title: s.title });
  }

  function applyHelmet(sc) {
    var style = document.getElementById("pf-screen-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "pf-screen-style";
      document.head.appendChild(style);
    }
    style.textContent = sc.css;
    sc.links.forEach(function (href) {
      var exists = Array.prototype.some.call(document.querySelectorAll("link[rel=stylesheet]"), function (l) {
        return l.getAttribute("href") === href;
      });
      if (!exists) {
        var l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = href;
        document.head.appendChild(l);
      }
    });
  }

  /* ---------- navigation ---------- */
  function current() {
    var m = location.hash.match(/^#\/?([A-Za-z0-9_-]+)/);
    return m && SCREENS[m[1]] ? m[1] : START;
  }

  var app = null;
  class App extends Component {
    constructor() {
      super();
      this.state = { name: current(), visit: 0 };
      app = this;
    }
    componentDidMount() {
      var self = this;
      window.addEventListener("hashchange", function () {
        self.setState({ name: current(), visit: self.state.visit + 1 });
      });
      this.sync();
    }
    componentDidUpdate() {
      this.sync();
    }
    sync() {
      var name = this.state.name;
      document.title = "PathFinder · " + getScreen(name).title.replace(/^[0-9a-z]+\s+/, "");
      document.querySelectorAll("[data-screen-link]").forEach(function (a) {
        if (a.getAttribute("data-screen-link") === name) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
    }
    render() {
      var sc = getScreen(this.state.name);
      applyHelmet(sc);
      return h(sc.Comp, { key: this.state.name + ":" + this.state.visit });
    }
  }

  function go(name) {
    if (!SCREENS[name]) return;
    if (current() === name && app) app.setState({ visit: app.state.visit + 1 });
    else location.hash = "#/" + name;
  }
  window.PF_GO = go;

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var m = (a.getAttribute("href") || "").match(/^(?:\.\/|\/)?([A-Za-z0-9_-]+)\.dc\.html$/);
    if (!m) return;
    e.preventDefault();
    go(m[1]);
  });

  /* ---------- screen list (desktop sidebar) ---------- */
  var nav = document.getElementById("screen-list");
  if (nav) {
    ORDER.forEach(function (name) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#/" + name;
      a.setAttribute("data-screen-link", name);
      a.textContent = SCREENS[name].title;
      li.appendChild(a);
      nav.appendChild(li);
    });
  }

  /* ---------- fit the 390 x 844 phone to the window ---------- */
  function fit() {
    var device = document.getElementById("device");
    var holder = document.getElementById("device-holder");
    if (!device || !holder) return;
    var mobile = window.innerWidth <= 560;
    document.body.classList.toggle("is-mobile", mobile);
    var frame = mobile ? 0 : 12;
    var w = 390 + frame * 2, hgt = 844 + frame * 2;
    var nav = document.querySelector(".nav");
    var navW = nav && nav.offsetWidth ? nav.offsetWidth + 56 : 0;
    var availW = mobile ? window.innerWidth : window.innerWidth - navW - 48;
    var availH = mobile ? window.innerHeight : window.innerHeight - 48;
    var s = Math.min(availW / w, availH / hgt, mobile ? 1.25 : 1);
    if (!(s > 0.2)) s = 0.2;
    device.style.transform = "scale(" + s + ")";
    holder.style.width = w * s + "px";
    holder.style.height = hgt * s + "px";
  }
  window.addEventListener("resize", fit);

  P.render(h(App), document.getElementById("screen"));
  fit();
})();
