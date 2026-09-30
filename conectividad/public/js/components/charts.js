/**
 * ELETEK — Gráficos de consumo (Chart.js)
 * Usa los mismos tokens de color que el resto del panel (--accent, etc.)
 * para que los gráficos no se sientan como un componente pegado aparte.
 */

const Charts = {
  _instances: {},

  _tokens() {
    const style = getComputedStyle(document.documentElement);
    return {
      accent: style.getPropertyValue('--accent').trim() || '#205081',
      accentHover: style.getPropertyValue('--accent-hover').trim() || '#163a5f',
      accentSoft: style.getPropertyValue('--accent-soft').trim() || '#e8eef5',
      textSecondary: style.getPropertyValue('--text-secondary').trim() || '#55606c',
      textMuted: style.getPropertyValue('--text-muted').trim() || '#8993a0',
      border: style.getPropertyValue('--border').trim() || '#dfe3e8',
      bgPrimary: style.getPropertyValue('--bg-primary').trim() || '#ffffff',
    };
  },

  _destroy(canvasId) {
    if (this._instances[canvasId]) {
      this._instances[canvasId].destroy();
      delete this._instances[canvasId];
    }
  },

  _tooltipBase(t) {
    return {
      enabled: true,
      backgroundColor: t.accentHover,
      titleColor: 'rgba(255,255,255,0.75)',
      titleFont: { size: 11, weight: '500' },
      bodyColor: '#ffffff',
      bodyFont: { size: 13, weight: '600' },
      padding: 10,
      cornerRadius: 6,
      displayColors: false,
      caretSize: 6,
    };
  },

  /**
   * Área/línea: consumo total del barco a lo largo del tiempo (tendencia).
   * Cada punto es clickeable: dispara `onSelect(index)` para que el gráfico
   * "por usuario" muestre el detalle de ese bucket puntual.
   * @param {string} canvasId
   * @param {{key: string, label: string}[]} buckets
   * @param {number[]} values - bytes por bucket
   * @param {number} selectedIndex - bucket actualmente resaltado
   * @param {(index: number) => void} onSelect
   */
  renderTrendChart(canvasId, buckets, values, selectedIndex, onSelect) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const t = this._tokens();

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 260);
    gradient.addColorStop(0, this._withAlpha(t.accent, 0.28));
    gradient.addColorStop(1, this._withAlpha(t.accent, 0.02));

    const hasData = values.some((v) => v > 0);
    const pointRadius = values.map((v, i) => (i === selectedIndex ? 6 : 3));
    const pointColor = values.map((v, i) => (i === selectedIndex ? t.accentHover : t.accent));

    this._instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [{
          data: values,
          borderColor: t.accent,
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius,
          pointHoverRadius: 7,
          pointBackgroundColor: pointColor,
          pointBorderColor: t.bgPrimary,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (evt, _elements, chart) => {
          if (!onSelect) return;
          const points = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
          if (points.length) onSelect(points[0].index);
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...this._tooltipBase(t),
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => App.utils.formatBytes(item.raw),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: t.textMuted, font: { size: 11 }, maxRotation: 0, autoSkip: true },
          },
          y: {
            beginAtZero: true,
            grid: { color: t.border, drawTicks: false },
            border: { display: false },
            ticks: {
              color: t.textMuted,
              font: { size: 11 },
              maxTicksLimit: 5,
              callback: (v) => (v === 0 ? '0' : App.utils.formatBytes(v)),
            },
          },
        },
      },
      plugins: hasData ? [] : [this._emptyStatePlugin('Sin consumo registrado todavía en este período', t)],
    });
  },

  /**
   * Barras horizontales: consumo por usuario en un mes.
   * @param {string} canvasId
   * @param {{name: string, bytes: number}[]} users
   */
  renderByUserChart(canvasId, users) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const t = this._tokens();

    const sorted = [...users].sort((a, b) => b.bytes - a.bytes);
    const maxBytes = Math.max(1, ...sorted.map((u) => u.bytes));

    // Codificación secuencial: un solo hue, más consumo = más oscuro.
    // Nada de arcoíris por usuario (con muchos usuarios se vuelve ilegible
    // y no aporta nada que la etiqueta del eje Y no diga ya).
    const colors = sorted.map((u) => {
      const t2 = 0.18 + 0.82 * (u.bytes / maxBytes);
      return this._shade(t.accentSoft, t.accentHover, u.bytes > 0 ? t2 : 0);
    });

    // Alto dinámico: barras cómodas sin importar cuántos usuarios haya.
    canvas.parentElement.style.height = `${Math.max(160, sorted.length * 34 + 40)}px`;
    canvas.style.height = '100%';

    this._instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map((u) => u.name),
        datasets: [{
          data: sorted.map((u) => u.bytes),
          backgroundColor: colors,
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...this._tooltipBase(t),
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => App.utils.formatBytes(item.raw),
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: maxBytes * 1.15,
            grid: { color: t.border, drawTicks: false },
            border: { display: false },
            ticks: {
              color: t.textMuted,
              font: { size: 11 },
              maxTicksLimit: 5,
              callback: (v) => (v === 0 ? '0' : App.utils.formatBytes(v)),
            },
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: t.textSecondary, font: { size: 12, weight: '500' } },
          },
        },
      },
      plugins: sorted.length ? [] : [this._emptyStatePlugin('No hay usuarios registrados para este barco', t)],
    });
  },

  /**
   * Interpola linealmente entre dos hex por canal RGB (rampa secuencial de un solo hue).
   * @param {string} hexLight
   * @param {string} hexDark
   * @param {number} t - 0 (hexLight) a 1 (hexDark)
   */
  _shade(hexLight, hexDark, t) {
    const clamp = Math.max(0, Math.min(1, t));
    const a = hexLight.replace('#', '');
    const b = hexDark.replace('#', '');
    const mix = (i) => {
      const from = parseInt(a.substring(i, i + 2), 16);
      const to = parseInt(b.substring(i, i + 2), 16);
      return Math.round(from + (to - from) * clamp);
    };
    const r = mix(0);
    const g = mix(2);
    const bch = mix(4);
    return `rgb(${r}, ${g}, ${bch})`;
  },

  _withAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },

  _emptyStatePlugin(message, t) {
    return {
      id: 'emptyState',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = t.textMuted;
        ctx.fillText(
          message,
          (chartArea.left + chartArea.right) / 2,
          (chartArea.top + chartArea.bottom) / 2
        );
        ctx.restore();
      },
    };
  },
};
