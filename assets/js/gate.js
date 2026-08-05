/* =========================================================================
   gate.js — the playable compliance gate
   A small deterministic rule stack, running locally. It is a teaching model
   of the decision path, not the production policy set: those rules live in a
   Python service and are internal. Every input lands on a defined outcome.
   ========================================================================= */
(function () {
  'use strict';

  var input = document.getElementById('gate-input');
  var box = document.getElementById('verdict');
  if (!input || !box) return;

  var labelEl = document.getElementById('verdict-label');
  var metaEl = document.getElementById('verdict-meta');
  var rulesEl = document.getElementById('verdict-rules');
  var traceEl = document.getElementById('verdict-trace');
  var samples = document.getElementById('gate-samples');

  /* ---------------- the rule stack ----------------
     severity: 'block' stops the campaign, 'hold' sends it to a human,
     'note' is informational and does not change the verdict.          */
  var RULES = [
    {
      id: 'R-07', sev: 'block', name: 'unsupported health claim',
      why: 'claims to cure or reverse a named condition',
      re: /\b(cure[sd]?|reverse[sd]?|heal[sd]?|eliminate[sd]?)\b[^.!?]{0,40}\b(diabetes|cancer|arthritis|blood ?pressure|hiv|asthma|obesity)\b/i
    },
    {
      id: 'R-11', sev: 'block', name: 'guaranteed outcome',
      why: 'promises a result the advertiser cannot guarantee',
      re: /\b(guarantee[ds]?|100% ?(effective|results|success)|risk[- ]free|no ?risk)\b/i
    },
    {
      id: 'R-14', sev: 'block', name: 'official impersonation',
      why: 'implies endorsement by a government or regulator',
      re: /\b(government|govt|ministry|rbi|sebi|irs|federal)\b[^.!?]{0,24}\b(approved|backed|scheme|authorised|authorized|grant|subsidy)\b/i
    },
    {
      id: 'R-19', sev: 'block', name: 'implausible earnings',
      why: 'income figure tied to no skill or effort requirement',
      re: /(₹|rs\.?|\$|€)\s?[\d,]+\s?(k|lakh|crore)?\s*(a|per|\/)?\s*(day|week|month)/i,
      also: /\b(from home|work from home|no experience|no skills|part[- ]time)\b/i
    },
    {
      id: 'R-22', sev: 'hold', name: 'rapid weight loss',
      why: 'weight-loss rate needs a human to check the landing page',
      re: /\b(lost|lose|drop(ped)?|shed)\b[^.!?]{0,20}\d+\s?(kg|kgs|kilos|pounds|lbs)\b/i
    },
    {
      id: 'R-03', sev: 'hold', name: 'curiosity-gap clickbait',
      why: 'withholds the subject of the claim from the headline',
      re: /\b(you won'?t believe|what happened next|one weird trick|doctors? hate|this is why|shocking truth)\b/i
    },
    {
      id: 'R-05', sev: 'hold', name: 'artificial urgency',
      why: 'pressure language without a real deadline on the page',
      re: /(\bact now\b|\bhurry\b|\blimited time\b|\bexpires (today|tonight)\b|!{2,})/i
    },
    {
      id: 'R-09', sev: 'note', name: 'sensitive vertical',
      why: 'routes to the finance or health rule set, allowed with disclosure',
      re: /\b(mutual fund[s]?|investment[s]?|invest(ing)?|stock[s]?|crypto|loan[s]?|insurance|medicine|treatment)\b/i
    },
    {
      id: 'R-02', sev: 'note', name: 'ranking claim',
      why: 'the ranking has to actually exist on the landing page',
      re: /\b(best|top|#\s?\d+|number one|cheapest|fastest)\b/i
    }
  ];

  var ORDER = { block: 0, hold: 1, note: 2 };
  var COPY = {
    block: { label: 'blocked', meta: 'campaign never reaches the network' },
    hold: { label: 'held for review', meta: 'queued for a human in the review API' },
    pass: { label: 'approved', meta: 'cleared, and watched for creative changes' }
  };

  /* a stable short id, so the trace looks like a real request without
     inventing anything secret-shaped */
  function shortId(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(36).slice(0, 6).padStart(6, '0');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function evaluate(text) {
    var hits = [];
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      var m = text.match(r.re);
      if (!m) continue;
      if (r.also && !r.also.test(text)) continue;
      hits.push({ rule: r, match: m[0].trim() });
    }
    hits.sort(function (a, b) { return ORDER[a.rule.sev] - ORDER[b.rule.sev]; });

    var verdict = 'pass';
    for (var j = 0; j < hits.length; j++) {
      if (hits[j].rule.sev === 'block') { verdict = 'block'; break; }
      if (hits[j].rule.sev === 'hold') verdict = 'hold';
    }
    return { verdict: verdict, hits: hits };
  }

  function render(text) {
    var res = evaluate(text);
    var v = res.verdict;
    var hits = res.hits;

    box.setAttribute('data-verdict', v);
    labelEl.textContent = COPY[v].label;

    var deciding = hits.filter(function (h) { return h.rule.sev !== 'note'; }).length;
    var notes = hits.length - deciding;
    var count;
    if (deciding === 0 && notes === 0) count = 'nothing matched';
    else if (deciding === 0) count = notes + (notes === 1 ? ' note, no deciding rule' : ' notes, no deciding rule');
    else count = deciding + (deciding === 1 ? ' rule fired' : ' rules fired');
    metaEl.textContent = count + ' · ' + COPY[v].meta;

    var html = '';
    if (!hits.length) {
      html += '<div class="verdict__rule" data-hit="pass">' +
              '<b>—</b><span>nothing in the stack matched</span></div>';
    }
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      html += '<div class="verdict__rule" data-hit="' + h.rule.sev + '">' +
              '<b>' + h.rule.id + '</b>' +
              '<span>' + esc(h.rule.name) + ' · ' + esc(h.rule.why) +
              '<br>matched “' + esc(h.match) + '”</span></div>';
    }

    /* the layer that is a model call in production */
    var llm = v === 'hold'
      ? 'would run: the model decides whether to auto-clear this hold'
      : (v === 'block' ? 'skipped: a blocking rule already fired' : 'skipped: nothing to clear');
    html += '<div class="verdict__rule" data-hit="note">' +
            '<b>LLM</b><span>auto-approval layer · ' + llm +
            '<br>not run in this page, this is where the production service calls a model</span></div>';

    rulesEl.innerHTML = html;

    var ids = hits.filter(function (h) { return h.rule.sev !== 'note'; })
                  .map(function (h) { return h.rule.id; });
    traceEl.innerHTML = [
      '<span><b>POST</b> /v1/campaign/validate</span>',
      '<span>campaign_key    cmp_demo_' + shortId(text) + '</span>',
      '<span>signature       hmac-sha256(body ‖ timestamp, per-source secret)</span>',
      '<span>verdict         ' + v + '</span>',
      '<span>rules_fired     ' + (ids.length ? ids.join(', ') : 'none') + '</span>',
      '<span>redis_state     approval:' + (v === 'pass' ? 'approved' : v === 'hold' ? 'pending' : 'rejected') + '</span>',
      '<span>poller          ' + (v === 'pass' ? 'watching for creative changes' : 'not registered') + '</span>'
    ].join('');
  }

  /* ---------------- wiring ---------------- */
  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { render(input.value); }, 140);
  }
  input.addEventListener('input', schedule);

  if (samples) {
    samples.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sample]');
      if (!btn) return;
      input.value = btn.getAttribute('data-sample');
      render(input.value);
      input.focus();
    });
  }

  render(input.value);
})();
