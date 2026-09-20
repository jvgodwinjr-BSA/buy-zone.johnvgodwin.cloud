// Stored timestamps are UTC (ISO 8601); show them in the viewer's local timezone.
function localTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
document.querySelectorAll('time[datetime]').forEach(t => { t.textContent = localTime(t.getAttribute('datetime')); });

// Zone-banded score line (Investing detail page). data = { labels, scores, zones: [{min, color, zone}] }
function scoreChart(el, data) {
  if (!window.Chart) return;
  const zones = data.zones.slice().sort((a, b) => a.min - b.min);
  const colorFor = v => { let c = zones[0].color; for (const z of zones) if (v >= z.min) c = z.color; return c; };
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
    },
  };
  new Chart(el, {
    type: 'line',
    data: { labels: data.labels, datasets: [{ data: data.scores, borderWidth: 2, pointRadius: 3, tension: 0.25, spanGaps: true,
      pointBackgroundColor: ctx => colorFor(ctx.parsed.y), pointBorderColor: ctx => colorFor(ctx.parsed.y),
      segment: { borderColor: ctx => colorFor(ctx.p1.parsed.y) } }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `score ${c.parsed.y}` } } },
      scales: { y: { min: 0, max: 100, ticks: { color: '#9aa0a6', stepSize: 20 }, grid: { color: '#2a2f36' } },
                x: { ticks: { color: '#9aa0a6', maxTicksLimit: 8 }, grid: { display: false } } } },
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
