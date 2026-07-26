/**
 * Runs inside the page (Chromium or the studio iframe) and slices the flow
 * region into real `.page` elements.
 *
 * Doing pagination ourselves rather than leaning on Chromium's automatic page
 * breaks buys three things the template model needs: an exact page count for
 * `{page} / {pages}`, per-page absolute overlays, and a studio preview that is
 * the same DOM the PDF is printed from.
 *
 * Authored as a string because it must ship to both a Node-driven browser and
 * a bundled web app without a build step in between.
 */
export const PAGINATOR_SOURCE = String.raw`
(function () {
  var flow = document.getElementById('flow');
  var pagesEl = document.getElementById('pages');
  var layersTpl = document.getElementById('layers');
  var EPS = 0.5; // px slack: sub-pixel rounding must not force a page break

  function newPage() {
    var page = document.createElement('section');
    page.className = 'page';
    var content = document.createElement('div');
    content.className = 'page-content';
    var layer = document.createElement('div');
    layer.className = 'page-layer';
    page.appendChild(content);
    page.appendChild(layer); // after content so overlays paint on top
    pagesEl.appendChild(page);
    return { page: page, content: content, layer: layer };
  }

  var cur = newPage();

  function overflows() {
    return cur.content.scrollHeight > cur.content.clientHeight + EPS;
  }

  function splitTable(table) {
    var tbody = table.tBodies[0];
    if (!tbody || tbody.rows.length === 0) return;
    var tfoot = table.tFoot;
    if (tfoot) tfoot.remove(); // the foot belongs on the last slice only

    var carry = [];
    while (overflows() && tbody.rows.length > 1) {
      var row = tbody.rows[tbody.rows.length - 1];
      carry.unshift(row);
      row.remove();
    }

    if (carry.length === 0) {
      if (tfoot) table.appendChild(tfoot);
      return;
    }

    cur = newPage();
    var next = table.cloneNode(false);
    var colgroup = table.querySelector('colgroup');
    if (colgroup) next.appendChild(colgroup.cloneNode(true));
    if (table.tHead) next.appendChild(table.tHead.cloneNode(true));
    var body = document.createElement('tbody');
    for (var i = 0; i < carry.length; i++) body.appendChild(carry[i]);
    next.appendChild(body);
    if (tfoot) next.appendChild(tfoot);
    cur.content.appendChild(next);

    if (overflows()) splitTable(next);
  }

  function placeFlow() {
    if (!flow) return;
    while (flow.firstElementChild) {
      var node = flow.firstElementChild;
      cur.content.appendChild(node);
      if (!overflows()) continue;

      if (node.tagName === 'TABLE') {
        splitTable(node);
        continue;
      }
      // A block that does not fit moves to a fresh page, unless it is already
      // alone — then it is simply taller than a page and gets clipped.
      if (cur.content.children.length > 1) {
        node.remove();
        cur = newPage();
        cur.content.appendChild(node);
      }
    }
    if (flow.parentNode) flow.parentNode.removeChild(flow);
  }

  function showsOn(on, index, total) {
    if (!on || on === 'all') return true;
    if (on === 'first') return index === 1;
    if (on === 'last') return index === total;
    if (on === 'exceptFirst') return index > 1;
    return on.split(',').map(Number).indexOf(index) !== -1;
  }

  function stampLayers() {
    if (!layersTpl) return;
    var pages = Array.prototype.slice.call(pagesEl.children);
    var total = pages.length;
    pages.forEach(function (page, i) {
      var index = i + 1;
      var frag = layersTpl.content.cloneNode(true);
      Array.prototype.forEach.call(frag.querySelectorAll('.placed'), function (el) {
        if (!showsOn(el.getAttribute('data-on'), index, total)) el.remove();
      });
      Array.prototype.forEach.call(frag.querySelectorAll('.page-number'), function (el) {
        var fmt = el.getAttribute('data-format') || '{page} / {pages}';
        el.textContent = fmt.replace(/\{page\}/g, String(index)).replace(/\{pages\}/g, String(total));
      });
      page.querySelector('.page-layer').appendChild(frag);
    });
    document.documentElement.setAttribute('data-pdftc-pages', String(total));
  }

  /** Step the font size down until the text stops overflowing its frame. */
  function shrinkToFit() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-shrink="1"]'), function (el) {
      var box = el.parentElement;
      if (!box) return;
      var size = parseFloat(getComputedStyle(el).fontSize);
      var guard = 0;
      while (
        guard++ < 40 &&
        size > 3 &&
        (el.scrollHeight > box.clientHeight + EPS || el.scrollWidth > box.clientWidth + EPS)
      ) {
        size -= size > 12 ? 0.5 : 0.25;
        el.style.fontSize = size + 'px';
      }
    });
  }

  function run() {
    try {
      shrinkToFit();
      placeFlow();
      stampLayers();
    } finally {
      document.documentElement.setAttribute('data-pdftc-ready', '1');
    }
  }

  function whenImagesSettled(next) {
    var images = Array.prototype.slice.call(document.images);
    var pending = images.filter(function (img) { return !img.complete; });
    if (pending.length === 0) return next();
    var left = pending.length;
    var done = function () { if (--left === 0) next(); };
    pending.forEach(function (img) {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
    // Never block the render on an image that will not resolve.
    setTimeout(function () { if (left > 0) { left = 0; next(); } }, 5000);
  }

  var start = function () { whenImagesSettled(run); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start);
  else start();

  window.__PDFTC_REPAGINATE__ = run;
})();
`;
