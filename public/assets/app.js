// Stored timestamps are UTC (ISO 8601); show them in the viewer's local timezone.
function localTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
document.querySelectorAll('time[datetime]').forEach(t => { t.textContent = localTime(t.getAttribute('datetime')); });

// Zone-banded score line + the inputs behind it (Investing detail page), all on one 0-100 axis.
// data = { labels, scores, zones: [{min, color, zone}], fng|null, fng_label, fng_trigger|null, stoch }
// Validated with the dataviz palette checker on the page surface (#0e1116) against each other and the zone colours.
const INPUT_COLORS = { fng: '#3987e5', stoch: '#c94fb0' };
function scoreChart(el, data) {
  if (!window.Chart) return;
  const zones = data.zones.slice().sort((a, b) => a.min - b.min);
  const colorFor = v => { let c = zones[0].color; for (const z of zones) if (v >= z.min) c = z.color; return c; };
  const dense = data.scores.length > 90;
  const thin = (label, values, color, hidden) => ({ label, data: values, borderColor: color, backgroundColor: color, borderWidth: 1.5, pointRadius: 0,
    pointHitRadius: 8, tension: 0.2, spanGaps: true, hidden: !!hidden });
  const datasets = [{ label: 'Score', data: data.scores, borderColor: '#e8eaed', backgroundColor: '#e8eaed', borderWidth: 2.5, pointRadius: dense ? 0 : 3,
    pointHitRadius: 8, tension: 0.25, spanGaps: true,
    pointBackgroundColor: ctx => colorFor(ctx.parsed.y), pointBorderColor: ctx => colorFor(ctx.parsed.y),
    segment: { borderColor: ctx => colorFor(ctx.p1.parsed.y) } }];
  const fngIdx = data.fng ? datasets.push(thin(data.fng_label || 'Fear & Greed', data.fng, INPUT_COLORS.fng)) - 1 : -1;
  if (data.stoch) datasets.push(thin('2W Stoch RSI', data.stoch, INPUT_COLORS.stoch));
  const bands = {
    id: 'bands',
    beforeDraw(chart) {
      const { ctx, chartArea: a, scales: { y } } = chart;
      if (!a) return;
      zones.forEach((z, i) => {
        const top = y.getPixelForValue(i + 1 < zones.length ? zones[i + 1].min : 100);
        const bottom = y.getPixelForValue(z.min);
        ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = z.color; ctx.fillRect(a.left, top, a.right - a.left, bottom - top); ctx.restore();
      });
      if (data.fng_trigger != null && fngIdx >= 0 && chart.isDatasetVisible(fngIdx)) {   // the F&G <= 10 deploy trigger
        const yy = y.getPixelForValue(data.fng_trigger);
        ctx.save(); ctx.strokeStyle = INPUT_COLORS.fng; ctx.fillStyle = INPUT_COLORS.fng; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a.left, yy); ctx.lineTo(a.right, yy); ctx.stroke();
        ctx.setLineDash([]); ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textAlign = 'left';
        const label = 'F&G \u2264 ' + data.fng_trigger + ' deploy trigger', tw = ctx.measureText(label).width;
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#0e1116'; ctx.fillRect(a.left + 2, yy - 16, tw + 8, 14);   // keep the label readable over the lines
        ctx.globalAlpha = 1; ctx.fillStyle = INPUT_COLORS.fng; ctx.fillText(label, a.left + 6, yy - 5);
        ctx.restore();
      }
    },
  };
  new Chart(el, {
    type: 'line',
    data: { labels: data.labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { color: '#9aa0a6', boxWidth: 18, boxHeight: 2, usePointStyle: false, padding: 14 } },
                 tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y == null ? '\u2014' : Math.round(c.parsed.y * 10) / 10}` } } },
      scales: { y: { min: 0, max: 100, ticks: { color: '#9aa0a6', stepSize: 20 }, grid: { color: '#2a2f36' } },
                x: { ticks: { color: '#9aa0a6', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } } } },
    plugins: [bands],
  });
}

// Swing strip: 48 closed candles colored by badge state, with % distance from the 21 EMA as the line.
function swingChart(el, data) {
  if (!window.Chart) return;
  const colors = { setup: '#2ecc71', wait: '#f1c40f', below: '#e74c3c', none: '#5f6368' };
  new Chart(el, {
    data: { labels: (data.times || data.labels || []).map(localTime), datasets: [
      { type: 'line', data: data.dist, yAxisID: 'y', borderColor: '#e8eaed', borderWidth: 1.5, pointRadius: 2.5, tension: 0.2, spanGaps: true,
        pointBackgroundColor: data.states.map(s => colors[s] || colors.none), pointBorderColor: data.states.map(s => colors[s] || colors.none) },
      { type: 'bar', data: data.states.map(() => 1), yAxisID: 'y2', backgroundColor: data.states.map(s => colors[s] || colors.none),
        barPercentage: 1, categoryPercentage: 1, borderWidth: 0 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.dataset.type === 'line' ? `dist from 21 EMA ${c.parsed.y.toFixed(2)}%` : `state: ${data.states[c.dataIndex]}` } } },
      scales: { y: { ticks: { color: '#9aa0a6', callback: v => v + '%' }, grid: { color: '#2a2f36' } },
                y2: { display: false, min: 0, max: 12 },
                x: { ticks: { color: '#9aa0a6', maxTicksLimit: 8 }, grid: { display: false } } } },
  });
}

document.querySelectorAll('canvas[data-chart]').forEach(c => {
  const data = JSON.parse(c.getAttribute('data-chart'));
  if (c.dataset.kind === 'score') scoreChart(c, data); else swingChart(c, data);
});
